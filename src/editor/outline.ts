import type { OutlineItem } from "../types";
import { documentOutline } from "./engine";

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

export function buildOutline(markdown: string): OutlineItem[] {
  return documentOutline(markdown).map((heading, index) => ({ id: `heading-${index}`, index, level: heading.level, text: heading.text, sourceOffset: heading.offset, sourceLine: heading.line }));
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
