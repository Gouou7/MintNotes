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
export type CalloutColor = "gray" | "blue" | "cyan" | "green" | "purple" | "amber" | "red" | "rose";
export type CalloutIcon = CalloutKind;

export interface CalloutMarker {
  rawType: string;
  kind: CalloutKind;
  title: string;
  fold: CalloutFold;
  color?: CalloutColor;
  icon?: CalloutIcon;
}

interface CalloutDefinition {
  kind: Exclude<CalloutKind, "custom">;
  aliases: string[];
}

const DEFINITIONS: CalloutDefinition[] = [
  { kind: "note", aliases: ["note"] },
  { kind: "abstract", aliases: ["abstract", "summary", "tldr"] },
  { kind: "info", aliases: ["info"] },
  { kind: "todo", aliases: ["todo"] },
  { kind: "tip", aliases: ["tip", "hint", "important"] },
  { kind: "success", aliases: ["success", "check", "done"] },
  { kind: "question", aliases: ["question", "help", "faq"] },
  { kind: "warning", aliases: ["warning", "caution", "attention"] },
  { kind: "failure", aliases: ["failure", "fail", "missing"] },
  { kind: "danger", aliases: ["danger", "error"] },
  { kind: "bug", aliases: ["bug"] },
  { kind: "example", aliases: ["example"] },
  { kind: "quote", aliases: ["quote", "cite"] }
];

const ALIASES = new Map(DEFINITIONS.flatMap((definition) => (
  definition.aliases.map((alias) => [alias, definition] as const)
)));

const MARKER = /^\[!([a-z0-9_-]+)\]([+-]?)(?:[ \t]+([^\r\n]*))?$/i;
// Accepted only to repair notes produced by the removed live-highlight workaround.
const LEGACY_MATERIALIZED_MARKER = /^==`(\[![a-z0-9_-]+\][+-]?(?:[ \t]+[^\r\n]*)?)`=?=?$/i;
const ESCAPED_MARKER = /^\\\[!([a-z0-9_-]+)\\\]([+-]?)(?:[ \t]+([^\r\n]*))?$/i;
const ATTRIBUTE_BLOCK = /(?:^|[ \t]+)\{([^{}\r\n]*)\}[ \t]*$/;
const ATTRIBUTE_ENTRY = /([a-z][a-z0-9_-]*)=([a-z0-9_-]+)/gi;
const CALLOUT_COLORS = new Set<CalloutColor>(["gray", "blue", "cyan", "green", "purple", "amber", "red", "rose"]);
const CALLOUT_ICONS = new Set<CalloutIcon>([
  "note", "abstract", "info", "todo", "tip", "important", "success", "question",
  "warning", "caution", "failure", "danger", "bug", "example", "quote", "custom"
]);

export function calloutDefinition(rawType: string): { kind: CalloutKind; title: string } {
  const normalized = rawType.toLowerCase();
  const definition = ALIASES.get(normalized);
  if (definition) return { kind: definition.kind, title: defaultCalloutTitle(normalized) };
  return {
    kind: "custom",
    title: defaultCalloutTitle(normalized)
  };
}

function defaultCalloutTitle(normalized: string): string {
  if (normalized === "faq") return "FAQ";
  if (normalized === "tldr") return "TLDR";
  return normalized
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Callout";
}

function decodeLegacyTitle(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseCalloutMarker(value: string): CalloutMarker | null {
  const legacyMaterialized = LEGACY_MATERIALIZED_MARKER.exec(value.trim());
  const candidate = legacyMaterialized?.[1] ?? value.trim();
  const match = MARKER.exec(candidate) ?? ESCAPED_MARKER.exec(candidate);
  if (!match) return null;
  const rawType = match[1].toLowerCase();
  const definition = calloutDefinition(rawType);
  const customTitle = match[3]?.trim();
  const decodedTitle = legacyMaterialized && customTitle ? decodeLegacyTitle(customTitle) : customTitle;
  const appearance = parseCalloutAppearance(decodedTitle ?? "");
  return {
    rawType,
    kind: definition.kind,
    title: appearance.title || definition.title,
    fold: (match[2] || "") as CalloutFold,
    color: appearance.color,
    icon: appearance.icon
  };
}

function parseCalloutAppearance(value: string): { title: string; color?: CalloutColor; icon?: CalloutIcon } {
  const block = ATTRIBUTE_BLOCK.exec(value);
  if (!block) return { title: value };
  const attributes = block[1];
  const consumed: string[] = [];
  let color: CalloutColor | undefined;
  let icon: CalloutIcon | undefined;
  let entry: RegExpExecArray | null;
  ATTRIBUTE_ENTRY.lastIndex = 0;
  while ((entry = ATTRIBUTE_ENTRY.exec(attributes))) {
    consumed.push(entry[0]);
    const key = entry[1].toLowerCase();
    const option = entry[2].toLowerCase();
    if (key === "color" && CALLOUT_COLORS.has(option as CalloutColor)) color = option as CalloutColor;
    else if (key === "icon" && CALLOUT_ICONS.has(option as CalloutIcon)) icon = option as CalloutIcon;
    else return { title: value };
  }
  if (!consumed.length || consumed.join(" ") !== attributes.trim().replace(/\s+/g, " ")) return { title: value };
  return { title: value.slice(0, block.index).trimEnd(), color, icon };
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
            "data-callout-fold": parsed.fold,
            ...(parsed.color ? { "data-callout-color": parsed.color } : {}),
            ...(parsed.icon ? { "data-callout-icon": parsed.icon } : {})
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
