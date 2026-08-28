import MarkdownIt from "markdown-it";
import type { OutlineItem } from "../types";
import { parseFrontmatter } from "./frontmatter";

interface MarkdownLine {
  text: string;
  offset: number;
}

function markdownLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown))) {
    if (match.index === markdown.length && match[0] === "") break;
    lines.push({ text: match[1], offset: match.index });
    if (!match[2]) break;
  }
  return lines;
}

const outlineParser = new MarkdownIt({ html: false });

function headingText(source: string): string {
  return source
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => alias?.trim() || target.trim())
    .replace(/\\([\\`*{}\[\]()#+\-.!_>~|])/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pushHeading(items: OutlineItem[], level: number, source: string, sourceOffset: number, sourceLine: number): void {
  const index = items.length;
  items.push({
    id: `heading-${index}`,
    level,
    text: headingText(source),
    index,
    sourceOffset,
    sourceLine
  });
}

export function buildOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const frontmatter = parseFrontmatter(markdown);
  const sourceOffset = frontmatter.prefix.length;
  const sourceLine = (frontmatter.prefix.match(/\n/g) ?? []).length;
  const lines = markdownLines(frontmatter.body);

  const tokens = outlineParser.parse(frontmatter.body, {});
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    if (token.type !== "heading_open" || token.level !== 0 || !token.map) continue;
    const level = Number(token.tag.slice(1));
    const localLine = token.map[0];
    const line = lines[localLine];
    const inline = tokens[tokenIndex + 1];
    if (!line || !Number.isInteger(level) || inline?.type !== "inline") continue;
    pushHeading(
      items,
      level,
      inline.content,
      sourceOffset + line.offset,
      sourceLine + localLine
    );
  }
  return items;
}

function normalizedHeading(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Wikilinks normally contain plain text. Keep malformed percent escapes
    // literal instead of making an otherwise usable local link fail.
  }
  return headingText(decoded).normalize("NFC").toLocaleLowerCase();
}

export function findOutlineHeading(outline: readonly OutlineItem[], headingPath: string): OutlineItem | null {
  const requested = headingPath
    .split("#")
    .map(normalizedHeading)
    .filter(Boolean);
  if (!requested.length) return null;

  const stack: OutlineItem[] = [];
  for (const item of outline) {
    while (stack.at(-1) && stack.at(-1)!.level >= item.level) stack.pop();
    const path = [...stack, item].map((entry) => normalizedHeading(entry.text));
    stack.push(item);
    if (path.length < requested.length) continue;
    const suffix = path.slice(-requested.length);
    if (suffix.every((part, index) => part === requested[index])) return item;
  }
  return null;
}
