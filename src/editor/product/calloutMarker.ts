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
  titleSource?: { from: number; to: number };
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

export const CALLOUT_TYPES = DEFINITIONS.flatMap(definition => definition.aliases.map(value => ({ value, label: defaultCalloutTitle(value) })));

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
  const titleStart = !legacyMaterialized && customTitle && appearance.title
    ? value.length - value.trimStart().length + match[0].length - match[3].length + match[3].indexOf(customTitle)
    : undefined;
  return {
    rawType,
    kind: definition.kind,
    title: appearance.title || definition.title,
    fold: (match[2] || "") as CalloutFold,
    color: appearance.color,
    icon: appearance.icon,
    titleSource: titleStart === undefined ? undefined : { from: titleStart, to: titleStart + appearance.title.length }
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

/** Change only the marker; the engine keeps its body, nesting and fold token. */
export function editCalloutMarker(value: string, change: { type?: string; title?: string }): string | null {
  const legacy = LEGACY_MATERIALIZED_MARKER.exec(value.trim());
  const candidate = legacy?.[1] ?? value.trim(), match = MARKER.exec(candidate) ?? ESCAPED_MARKER.exec(candidate);
  if (!match) return null;
  if (change.type !== undefined && !CALLOUT_TYPES.some(type => type.value === change.type)) return null;
  if (change.type === match[1].toLowerCase() && change.title === undefined) return value;
  const rawTitle = match[3]?.trim() ?? "", decoded = legacy ? decodeLegacyTitle(rawTitle) : rawTitle;
  const appearance = parseCalloutAppearance(decoded);
  const title = change.title === undefined ? appearance.title : change.title.replace(/[\r\n]+/g, " ").trim();
  // Choosing a new type also chooses its default icon and color. Title edits
  // keep explicit appearance attributes, including their original order.
  const attributes = change.type === undefined && (appearance.color || appearance.icon) ? ATTRIBUTE_BLOCK.exec(decoded)?.[0].trim() ?? "" : "";
  const suffix = [title, attributes].filter(Boolean).join(" ");
  return `[!${change.type ?? match[1]}]${match[2]}${suffix ? ` ${suffix}` : ""}`;
}
