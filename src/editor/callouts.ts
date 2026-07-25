export type CalloutKind =
  | "note"
  | "abstract"
  | "info"
  | "todo"
  | "tip"
  | "important"
  | "success"
  | "question"
  | "warning"
  | "caution"
  | "failure"
  | "danger"
  | "bug"
  | "example"
  | "quote"
  | "custom";

export type CalloutFold = "" | "+" | "-";

export interface CalloutMarker {
  rawType: string;
  kind: CalloutKind;
  title: string;
  fold: CalloutFold;
}

interface CalloutDefinition {
  kind: Exclude<CalloutKind, "custom">;
  title: string;
  aliases: string[];
}

const DEFINITIONS: CalloutDefinition[] = [
  { kind: "note", title: "Note", aliases: ["note"] },
  { kind: "abstract", title: "Abstract", aliases: ["abstract", "summary", "tldr"] },
  { kind: "info", title: "Info", aliases: ["info"] },
  { kind: "todo", title: "Todo", aliases: ["todo"] },
  { kind: "tip", title: "Tip", aliases: ["tip", "hint"] },
  { kind: "important", title: "Important", aliases: ["important"] },
  { kind: "success", title: "Success", aliases: ["success", "check", "done"] },
  { kind: "question", title: "Question", aliases: ["question", "help", "faq"] },
  { kind: "warning", title: "Warning", aliases: ["warning", "attention"] },
  { kind: "caution", title: "Caution", aliases: ["caution"] },
  { kind: "failure", title: "Failure", aliases: ["failure", "fail", "missing"] },
  { kind: "danger", title: "Danger", aliases: ["danger", "error"] },
  { kind: "bug", title: "Bug", aliases: ["bug"] },
  { kind: "example", title: "Example", aliases: ["example"] },
  { kind: "quote", title: "Quote", aliases: ["quote", "cite"] }
];

const ALIASES = new Map(DEFINITIONS.flatMap((definition) => (
  definition.aliases.map((alias) => [alias, definition] as const)
)));

const MARKER = /^\[!([a-z0-9_-]+)\]([+-]?)(?:[ \t]+([^\r\n]*))?$/i;
const MATERIALIZED_MARKER = /^==`(\[![a-z0-9_-]+\][+-]?(?:[ \t]+[^\r\n]*)?)`==$/i;
const ESCAPED_MARKER = /^\\\[!([a-z0-9_-]+)\\\]([+-]?)(?:[ \t]+([^\r\n]*))?$/i;
const QUOTE_PREFIX = /^((?:[ \t]*>[ \t]?)+)(.*)$/;
const FENCE = /^(`{3,}|~{3,})/;

export function calloutDefinition(rawType: string): { kind: CalloutKind; title: string } {
  const normalized = rawType.toLowerCase();
  const definition = ALIASES.get(normalized);
  if (definition) return { kind: definition.kind, title: definition.title };
  return {
    kind: "custom",
    title: normalized
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Callout"
  };
}

function decodeMaterializedTitle(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseCalloutMarker(value: string): CalloutMarker | null {
  const materialized = MATERIALIZED_MARKER.exec(value.trim());
  const candidate = materialized?.[1] ?? value.trim();
  const match = MARKER.exec(candidate) ?? ESCAPED_MARKER.exec(candidate);
  if (!match) return null;
  const rawType = match[1].toLowerCase();
  const definition = calloutDefinition(rawType);
  const customTitle = match[3]?.trim();
  const title = materialized && customTitle ? decodeMaterializedTitle(customTitle) : customTitle;
  return {
    rawType,
    kind: definition.kind,
    title: title || definition.title,
    fold: (match[2] || "") as CalloutFold
  };
}

function transformCalloutLines(markdown: string, mode: "materialize" | "canonicalize"): string {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const fences: string[] = [];

  return lines.map((line) => {
    const quote = QUOTE_PREFIX.exec(line);
    if (!quote) return line;
    const prefix = quote[1];
    const content = quote[2];
    const fence = FENCE.exec(content.trimStart());
    if (fence) {
      const marker = fence[1][0];
      const top = fences.at(-1);
      if (top === marker) fences.pop();
      else if (!top) fences.push(marker);
      return line;
    }
    if (fences.length) return line;

    if (mode === "materialize") {
      const marker = MARKER.exec(content.trim());
      if (!marker) return line;
      const title = marker[3] ? ` ${encodeURIComponent(marker[3])}` : "";
      return `${prefix}==\`[!${marker[1]}]${marker[2] ?? ""}${title}\`==`;
    }

    const materialized = MATERIALIZED_MARKER.exec(content.trim());
    if (materialized) {
      const marker = MARKER.exec(materialized[1]);
      if (!marker) return line;
      const title = marker[3] ? ` ${decodeMaterializedTitle(marker[3])}` : "";
      return `${prefix}[!${marker[1]}]${marker[2] ?? ""}${title}`;
    }
    const escaped = ESCAPED_MARKER.exec(content.trim());
    if (escaped) {
      const title = escaped[3] ? ` ${escaped[3]}` : "";
      return `${prefix}[!${escaped[1]}]${escaped[2] ?? ""}${title}`;
    }
    return line;
  }).join(eol);
}

export function materializeCalloutsForLive(markdown: string): string {
  return transformCalloutLines(markdown, "materialize");
}

export function canonicalizeCalloutsFromLive(markdown: string): string {
  return transformCalloutLines(markdown, "canonicalize");
}

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: {
    hProperties?: Record<string, unknown>;
  };
}

const MDAST_MARKER = /^\[!([a-z0-9_-]+)\]([+-]?)(?:[ \t]+([^\r\n]*))?(?:\r?\n|$)/i;

function transformMdast(node: MdNode) {
  if (node.type === "blockquote") {
    const paragraph = node.children?.[0];
    const firstText = paragraph?.type === "paragraph" ? paragraph.children?.[0] : undefined;
    if (firstText?.type === "text" && typeof firstText.value === "string") {
      const marker = MDAST_MARKER.exec(firstText.value);
      if (marker) {
        const parsed = parseCalloutMarker(`[!${marker[1]}]${marker[2] ?? ""}${marker[3] ? ` ${marker[3]}` : ""}`);
        if (parsed) {
          firstText.value = firstText.value.slice(marker[0].length);
          if (!firstText.value) paragraph?.children?.shift();
          if (paragraph?.children?.length === 0) node.children?.shift();
          node.data ??= {};
          node.data.hProperties = {
            ...(node.data.hProperties ?? {}),
            className: `markdown-callout callout-${parsed.kind}`,
            "data-callout-kind": parsed.kind,
            "data-callout-title": parsed.title,
            "data-callout-fold": parsed.fold
          };
        }
      }
    }
  }
  for (const child of node.children ?? []) transformMdast(child);
}

export function remarkCallouts() {
  return (tree: MdNode) => transformMdast(tree);
}
