import type { OutlineItem } from "../types";

export function buildOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = match[2]
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_~`]/g, "")
      .trim();
    const index = items.length;
    items.push({ id: `heading-${index}`, level: match[1].length, text, index });
  }
  return items;
}

