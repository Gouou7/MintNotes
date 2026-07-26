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
const ESCAPED_CALLOUT_LINE = /^([ \t]*)\\>[ \t]+\\\[!([a-z0-9_-]+)\\\]([+-]?)(?:[ \t]+([^\r\n]*))?$/i;
const QUOTE_PREFIX = /^((?:[ \t]*>[ \t]?)+)(.*)$/;
const FENCE = /^(`{3,}|~{3,})/;
const ATTRIBUTE_BLOCK = /(?:^|[ \t]+)\{([^{}\r\n]*)\}[ \t]*$/;
const ATTRIBUTE_ENTRY = /([a-z][a-z0-9_-]*)=([a-z0-9_-]+)/gi;
const CALLOUT_COLORS = new Set<CalloutColor>(["gray", "blue", "cyan", "green", "purple", "amber", "red", "rose"]);
const CALLOUT_ICONS = new Set<CalloutIcon>([
  "note", "abstract", "info", "todo", "tip", "important", "success", "question",
  "warning", "caution", "failure", "danger", "bug", "example", "quote", "custom"
]);
// Live-only text that keeps an otherwise empty body paragraph editable.
const LIVE_EMPTY_BODY = "\u2060";

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

interface QuoteLine {
  prefix: string;
  content: string;
  depth: number;
}

function parseQuoteLine(line: string): QuoteLine | null {
  const quote = QUOTE_PREFIX.exec(line);
  if (!quote) return null;
  return {
    prefix: quote[1],
    content: quote[2],
    depth: [...quote[1]].filter((character) => character === ">").length
  };
}

function blankQuoteLine(prefix: string): string {
  return prefix.trimEnd();
}

function emptyQuoteBody(prefix: string): string {
  return /[ \t]$/.test(prefix) ? prefix : `${prefix} `;
}

function canonicalMarker(match: RegExpExecArray, decodeTitle = false): string {
  const rawTitle = decodeTitle && match[3] ? decodeLegacyTitle(match[3]) : match[3];
  const title = rawTitle ? ` ${rawTitle}` : "";
  return `[!${match[1]}]${match[2] ?? ""}${title}`;
}

function updateFence(content: string, fences: string[]): boolean {
  const fence = FENCE.exec(content.trimStart());
  if (!fence) return false;
  const marker = fence[1][0];
  const top = fences.at(-1);
  if (top === marker) fences.pop();
  else if (!top) fences.push(marker);
  return true;
}

function stripLiveEmptyBody(content: string): string {
  if (content.startsWith(LIVE_EMPTY_BODY)) return content.slice(LIVE_EMPTY_BODY.length);
  if (content.startsWith("\u00a0")) return content.slice(1);
  return content;
}

function materializeCalloutLines(markdown: string): string {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const fences: string[] = [];
  const output: string[] = [];
  let pendingBody: { depth: number; prefix: string } | null = null;

  for (const line of lines) {
    const quote = parseQuoteLine(line);
    if (pendingBody) {
      if (!quote || quote.depth < pendingBody.depth) {
        output.push(`${pendingBody.prefix}${LIVE_EMPTY_BODY}`);
        pendingBody = null;
      } else {
        pendingBody = null;
        if (!quote.content.trim()) {
          output.push(`${quote.prefix}${LIVE_EMPTY_BODY}`);
          continue;
        }
      }
    }

    if (!quote) {
      output.push(line);
      continue;
    }
    if (updateFence(quote.content, fences) || fences.length) {
      output.push(line);
      continue;
    }

    const legacyMaterialized = LEGACY_MATERIALIZED_MARKER.exec(quote.content.trim());
    const marker = MARKER.exec(legacyMaterialized?.[1] ?? quote.content.trim());
    if (!marker) {
      output.push(line);
      continue;
    }

    output.push(`${quote.prefix}${canonicalMarker(marker, Boolean(legacyMaterialized))}`);
    // A quoted blank line makes typora-web parse the marker and body as separate
    // paragraphs, so deleting the body cannot move the selection into the marker.
    output.push(blankQuoteLine(quote.prefix));
    pendingBody = { depth: quote.depth, prefix: quote.prefix };
  }

  if (pendingBody) output.push(`${pendingBody.prefix}${LIVE_EMPTY_BODY}`);
  return output.join(eol);
}

function canonicalizeCalloutLines(markdown: string): string {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const fences: string[] = [];
  const output: string[] = [];
  let pendingBody: { depth: number; prefix: string; separatorRemoved: boolean } | null = null;

  for (const line of lines) {
    let currentLine = line;
    let quote = parseQuoteLine(currentLine);

    if (!quote) {
      const escapedCallout = ESCAPED_CALLOUT_LINE.exec(currentLine);
      if (escapedCallout) {
        const title = escapedCallout[4] ? ` ${escapedCallout[4]}` : "";
        currentLine = `${escapedCallout[1]}> [!${escapedCallout[2]}]${escapedCallout[3] ?? ""}${title}`;
        quote = parseQuoteLine(currentLine);
      }
    }

    if (pendingBody) {
      if (!pendingBody.separatorRemoved) {
        if (quote && quote.depth === pendingBody.depth && !quote.content.trim()) {
          pendingBody.separatorRemoved = true;
          continue;
        }
        if (!quote || quote.depth < pendingBody.depth) {
          output.push(emptyQuoteBody(pendingBody.prefix));
        }
        pendingBody = null;
      } else {
        if (!quote || quote.depth < pendingBody.depth) {
          output.push(emptyQuoteBody(pendingBody.prefix));
        } else {
          currentLine = `${quote.prefix}${stripLiveEmptyBody(quote.content)}`;
          quote = parseQuoteLine(currentLine);
        }
        pendingBody = null;
      }
    }

    if (!quote) {
      output.push(currentLine);
      continue;
    }
    if (updateFence(quote.content, fences) || fences.length) {
      output.push(currentLine);
      continue;
    }

    const legacyMaterialized = LEGACY_MATERIALIZED_MARKER.exec(quote.content.trim());
    const marker = MARKER.exec(legacyMaterialized?.[1] ?? quote.content.trim());
    if (marker) {
      output.push(`${quote.prefix}${canonicalMarker(marker, Boolean(legacyMaterialized))}`);
      pendingBody = { depth: quote.depth, prefix: quote.prefix, separatorRemoved: false };
      continue;
    }

    const escaped = ESCAPED_MARKER.exec(quote.content.trim());
    if (escaped) {
      const title = escaped[3] ? ` ${escaped[3]}` : "";
      output.push(`${quote.prefix}[!${escaped[1]}]${escaped[2] ?? ""}${title}`);
      continue;
    }
    output.push(currentLine);
  }

  if (pendingBody) output.push(emptyQuoteBody(pendingBody.prefix));
  return output.join(eol);
}

export function materializeCalloutsForLive(markdown: string): string {
  return materializeCalloutLines(markdown);
}

export function canonicalizeCalloutsFromLive(markdown: string): string {
  return canonicalizeCalloutLines(markdown);
}

export interface CollapsedEmptyCallout {
  markdown: string;
  offset: number;
}

export function collapseEmptyCalloutBodyForMarkerEdit(
  markdown: string,
  calloutIndex: number
): CollapsedEmptyCallout | null {
  if (calloutIndex < 0) return null;
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const fences: string[] = [];
  let currentCallout = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const quote = parseQuoteLine(lines[lineIndex]);
    if (!quote) continue;
    if (updateFence(quote.content, fences) || fences.length) continue;
    if (!MARKER.test(quote.content.trim())) continue;
    if (currentCallout !== calloutIndex) {
      currentCallout += 1;
      continue;
    }

    // Only collapse the exact separator and placeholder generated by
    // materializeCalloutsForLive. Authored blank lines and body content must
    // remain untouched.
    if (
      lines[lineIndex + 1] !== blankQuoteLine(quote.prefix)
      || lines[lineIndex + 2] !== `${quote.prefix}${LIVE_EMPTY_BODY}`
    ) return null;

    const nextLines = [
      ...lines.slice(0, lineIndex + 1),
      ...lines.slice(lineIndex + 3)
    ];
    const nextMarkdown = nextLines.join(eol);
    const offset = lines.slice(0, lineIndex + 1).join(eol).length;
    return { markdown: nextMarkdown, offset };
  }

  return null;
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
