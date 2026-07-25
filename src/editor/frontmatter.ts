import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  Scalar,
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

function serialize(parsed: ValidFrontmatter): string {
  let yamlSource = parsed.document.toString({ lineWidth: 0 });
  if (parsed.openingEol === "\r\n") yamlSource = yamlSource.replace(/\n/g, "\r\n");
  return `${parsed.bom}---${parsed.openingEol}${yamlSource}${parsed.closingDelimiter}${parsed.closingEol}${parsed.body}`;
}

function mutate(markdown: string, change: (parsed: ValidFrontmatter, map: YAMLMap) => boolean): string {
  const parsed = parseFrontmatter(markdown);
  if (parsed.status !== "valid") return markdown;
  const map = editableMap(parsed);
  if (!change(parsed, map)) return markdown;
  return serialize(parsed);
}

export function addFrontmatterProperty(markdown: string, key: string): string {
  return mutate(markdown, (parsed, map) => {
    if (!key.trim() || matchingPair(map, key)) return false;
    map.add({ key, value: parsed.document.createNode(null) });
    return true;
  });
}

export function renameFrontmatterProperty(markdown: string, key: string, nextKey: string): string {
  return mutate(markdown, (parsed, map) => {
    const normalized = nextKey.trim();
    const pair = matchingPair(map, key);
    if (!pair || !normalized || normalized === key || matchingPair(map, normalized)) return false;
    pair.key = parsed.document.createNode(normalized);
    return true;
  });
}

export function deleteFrontmatterProperty(markdown: string, key: string): string {
  return mutate(markdown, (_parsed, map) => map.delete(key));
}

export function setFrontmatterProperty(
  markdown: string,
  key: string,
  value: string | number | boolean | string[] | null
): string {
  return mutate(markdown, (parsed, map) => {
    const pair = matchingPair(map, key);
    if (!pair) return false;
    if (isScalar(pair.value) && !Array.isArray(value)) {
      pair.value.value = value;
      if (typeof value === "string" && (
        pair.value.type === Scalar.BLOCK_FOLDED || pair.value.type === Scalar.BLOCK_LITERAL
      )) pair.value.type = Scalar.PLAIN;
    } else {
      pair.value = parsed.document.createNode(value);
    }
    return true;
  });
}

export function replaceFrontmatterBody(parsed: ParsedFrontmatter, body: string): string {
  return parsed.status === "absent" ? body : parsed.prefix + body;
}

export function isIsoDateValue(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value);
}
