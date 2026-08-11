import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  Scalar,
  stringify,
  type Document,
  type Node,
  type Pair,
  type YAMLMap
} from "yaml";

export type FrontmatterPropertyKind = "text" | "number" | "boolean" | "date" | "list" | "complex";
export type FrontmatterPropertyIcon = "text" | "number" | "boolean" | "date" | "tags" | "complex";

export interface FrontmatterProperty {
  key: string;
  kind: FrontmatterPropertyKind;
  icon: FrontmatterPropertyIcon;
  value: string | number | boolean | string[] | null;
  complexPreview?: string;
}
interface FrontmatterBase {
  markdown: string;
  prefix: string;
  body: string;
  bom: string;
  openingEol: string;
  closingDelimiter: "---" | "...";
  closingEol: string;
  yamlSource: string;
}

export interface ValidFrontmatter extends FrontmatterBase {
  status: "valid";
  document: Document;
  properties: FrontmatterProperty[];
}

export interface InvalidFrontmatter extends FrontmatterBase {
  status: "invalid";
  error: string;
}

export interface AbsentFrontmatter {
  status: "absent";
  markdown: string;
  prefix: "";
  body: string;
}

export type ParsedFrontmatter = ValidFrontmatter | InvalidFrontmatter | AbsentFrontmatter;

const LIST_KEYS = new Set(["tag", "tags", "alias", "aliases", "cssclass", "cssclasses"]);
const DATE_KEYS = new Set(["created", "modified", "updated", "date", "datetime", "published", "due"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/;

interface Line {
  text: string;
  eol: string;
  end: number;
}

function readLine(source: string, start: number): Line {
  const lf = source.indexOf("\n", start);
  if (lf === -1) return { text: source.slice(start), eol: "", end: source.length };
  const hasCarriageReturn = lf > start && source[lf - 1] === "\r";
  return {
    text: source.slice(start, hasCarriageReturn ? lf - 1 : lf),
    eol: hasCarriageReturn ? "\r\n" : "\n",
    end: lf + 1
  };
}

function frontmatterBounds(markdown: string): Omit<FrontmatterBase, "markdown"> | null {
  const bom = markdown.startsWith("\uFEFF") ? "\uFEFF" : "";
  const first = readLine(markdown, bom.length);
  if (first.text !== "---" || !first.eol) return null;

  const contentStart = first.end;
  let lineStart = contentStart;
  while (lineStart <= markdown.length) {
    const line = readLine(markdown, lineStart);
    if (line.text === "---" || line.text === "...") {
      return {
        prefix: markdown.slice(0, line.end),
        body: markdown.slice(line.end),
        bom,
        openingEol: first.eol,
        closingDelimiter: line.text,
        closingEol: line.eol,
        yamlSource: markdown.slice(contentStart, lineStart)
      };
    }
    if (!line.eol) break;
    lineStart = line.end;
  }
  return null;
}

function propertyIcon(key: string, kind: FrontmatterPropertyKind): FrontmatterPropertyIcon {
  const normalized = key.trim().toLowerCase();
  if (LIST_KEYS.has(normalized)) return "tags";
  if (DATE_KEYS.has(normalized)) return "date";
  if (kind === "number" || kind === "boolean" || kind === "complex") return kind;
  if (kind === "list") return "tags";
  if (kind === "date") return "date";
  return "text";
}

function isSimpleScalar(node: Node | null | undefined): node is Scalar<string | number | boolean | null> {
  if (!isScalar(node) || node.anchor) return false;
  if (node.type === Scalar.BLOCK_FOLDED || node.type === Scalar.BLOCK_LITERAL) return false;
  return node.value === null || ["string", "number", "boolean"].includes(typeof node.value);
}

function previewComplex(node: Node | null | undefined): string {
  if (!node) return "";
  try {
    const value = node.toJSON();
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return "";
  }
}

function propertyFromPair(pair: Pair): FrontmatterProperty {
  const keyNode = pair.key;
  const key = isScalar(keyNode) ? String(keyNode.value ?? "") : previewComplex(keyNode as Node);
  const value = pair.value as Node | null | undefined;
  const normalizedKey = key.trim().toLowerCase();

  if (!isScalar(keyNode) || keyNode.anchor || isAlias(value)) {
    return { key, kind: "complex", icon: "complex", value: null, complexPreview: previewComplex(value) };
  }

  if (isSimpleScalar(value)) {
    if (value.value === null) {
      const kind: FrontmatterPropertyKind = LIST_KEYS.has(normalizedKey)
        ? "list"
        : DATE_KEYS.has(normalizedKey) ? "date" : "text";
      return { key, kind, icon: propertyIcon(key, kind), value: kind === "list" ? [] : null };
    }
    if (typeof value.value === "boolean") {
      return { key, kind: "boolean", icon: propertyIcon(key, "boolean"), value: value.value };
    }
    if (typeof value.value === "number") {
      return { key, kind: "number", icon: propertyIcon(key, "number"), value: value.value };
    }
    const kind = ISO_DATE.test(value.value) || ISO_DATE_TIME.test(value.value) ? "date" : "text";
    return { key, kind, icon: propertyIcon(key, kind), value: value.value };
  }

  if (isSeq(value) && !value.anchor && value.items.every((item) => isSimpleScalar(item as Node))) {
    return {
      key,
      kind: "list",
      icon: propertyIcon(key, "list"),
      value: value.items.map((item) => String((item as Scalar).value ?? ""))
    };
  }

  return { key, kind: "complex", icon: "complex", value: null, complexPreview: previewComplex(value) };
}

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const bounds = frontmatterBounds(markdown);
  if (!bounds) return { status: "absent", markdown, prefix: "", body: markdown };

  const document = parseDocument(bounds.yamlSource, {
    keepSourceTokens: true,
    prettyErrors: false,
    strict: true,
    uniqueKeys: true
  });
  const firstProblem = document.errors[0] ?? document.warnings[0];
  if (firstProblem) {
    return {
      status: "invalid",
      markdown,
      ...bounds,
      error: firstProblem.message
    };
  }

  if (document.contents !== null && !isMap(document.contents)) {
    return {
      status: "invalid",
      markdown,
      ...bounds,
      error: "Frontmatter must contain a top-level mapping."
    };
  }

  const properties = document.contents === null
    ? []
    : document.contents.items.map((pair) => propertyFromPair(pair));
  return { status: "valid", markdown, ...bounds, document, properties };
}

function editableMap(parsed: ValidFrontmatter): YAMLMap {
  if (isMap(parsed.document.contents)) return parsed.document.contents;
  const map = parsed.document.createNode({}) as YAMLMap;
  parsed.document.contents = map;
  return map;
}

function matchingPair(map: YAMLMap, key: string): Pair | undefined {
  return map.items.find((pair) => isScalar(pair.key) && String(pair.key.value ?? "") === key);
}

function withYamlSource(parsed: ValidFrontmatter, yamlSource: string): string {
  return `${parsed.bom}---${parsed.openingEol}${yamlSource}${parsed.closingDelimiter}${parsed.closingEol}${parsed.body}`;
}

function yamlEol(parsed: ValidFrontmatter): string {
  return parsed.openingEol === "\r\n" ? "\r\n" : "\n";
}

function normalizeYamlEol(parsed: ValidFrontmatter, source: string): string {
  return parsed.openingEol === "\r\n" ? source.replace(/\r?\n/g, "\r\n") : source;
}

function replaceYamlRange(
  parsed: ValidFrontmatter,
  from: number,
  to: number,
  insert: string,
): string {
  return withYamlSource(
    parsed,
    parsed.yamlSource.slice(0, from) + normalizeYamlEol(parsed, insert) + parsed.yamlSource.slice(to),
  );
}

function scalarSource(parsed: ValidFrontmatter, scalar: Scalar, value: string | number | boolean | null): string {
  const authored = scalar.range
    ? parsed.yamlSource.slice(scalar.range[0], scalar.range[1]).replace(/(?:\r\n|\n)$/, "")
    : "";
  if (typeof value === "string" && authored.startsWith("'") && authored.endsWith("'")) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (typeof value === "string" && authored.startsWith('"') && authored.endsWith('"')) {
    return JSON.stringify(value);
  }
  scalar.value = value;
  if (typeof value === "string" && (
    scalar.type === Scalar.BLOCK_FOLDED || scalar.type === Scalar.BLOCK_LITERAL
  )) scalar.type = Scalar.PLAIN;
  return normalizeYamlEol(parsed, scalar.toString());
}

function valueSource(parsed: ValidFrontmatter, value: string | number | boolean | string[] | null): string {
  return normalizeYamlEol(
    parsed,
    stringify(value, { collectionStyle: "flow", lineWidth: 0 }).replace(/\n$/, ""),
  );
}

export function addFrontmatterProperty(markdown: string, key: string): string {
  const parsed = parseFrontmatter(markdown);
  if (parsed.status !== "valid") return markdown;
  const normalized = key.trim();
  const map = editableMap(parsed);
  if (!normalized || matchingPair(map, normalized)) return markdown;
  const eol = yamlEol(parsed);
  const separator = parsed.yamlSource.length > 0 && !/\r?\n$/.test(parsed.yamlSource) ? eol : "";
  const keySource = stringify(normalized, { lineWidth: 0 }).replace(/\n$/, "");
  return withYamlSource(parsed, `${parsed.yamlSource}${separator}${keySource}: null${eol}`);
}

export function renameFrontmatterProperty(markdown: string, key: string, nextKey: string): string {
  const parsed = parseFrontmatter(markdown);
  if (parsed.status !== "valid") return markdown;
  const map = editableMap(parsed);
  const normalized = nextKey.trim();
  const pair = matchingPair(map, key);
  const range = isScalar(pair?.key) ? pair.key.range : undefined;
  if (!pair || !range || !normalized || normalized === key || matchingPair(map, normalized)) return markdown;
  const keySource = stringify(normalized, { lineWidth: 0 }).replace(/\n$/, "");
  return replaceYamlRange(parsed, range[0], range[1], keySource);
}

export function deleteFrontmatterProperty(markdown: string, key: string): string {
  const parsed = parseFrontmatter(markdown);
  if (parsed.status !== "valid") return markdown;
  const pair = matchingPair(editableMap(parsed), key);
  const keyRange = isScalar(pair?.key) ? pair.key.range : undefined;
  if (!pair || !keyRange) return markdown;
  const valueRange = (pair.value as Node | null | undefined)?.range;
  const to = valueRange?.[2] ?? keyRange[2];
  return replaceYamlRange(parsed, keyRange[0], to, "");
}

export function setFrontmatterProperty(
  markdown: string,
  key: string,
  value: string | number | boolean | string[] | null
): string {
  const parsed = parseFrontmatter(markdown);
  if (parsed.status !== "valid") return markdown;
  const pair = matchingPair(editableMap(parsed), key);
  const current = pair?.value as Node | null | undefined;
  if (!pair) return markdown;
  if (current?.range) {
    let source = isScalar(current) && !Array.isArray(value)
      ? scalarSource(parsed, current, value)
      : valueSource(parsed, value);
    const ownedSource = parsed.yamlSource.slice(current.range[0], current.range[1]);
    const trailingEol = ownedSource.match(/(?:\r\n|\n)$/)?.[0];
    if (trailingEol && !/(?:\r\n|\n)$/.test(source)) source += trailingEol;
    return replaceYamlRange(parsed, current.range[0], current.range[1], source);
  }

  const keyRange = isScalar(pair.key) ? pair.key.range : undefined;
  if (!keyRange) return markdown;
  return replaceYamlRange(parsed, keyRange[1], keyRange[1], `: ${valueSource(parsed, value)}`);
}

export function replaceFrontmatterBody(parsed: ParsedFrontmatter, body: string): string {
  return parsed.status === "absent" ? body : parsed.prefix + body;
}

export function isIsoDateValue(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value);
}
