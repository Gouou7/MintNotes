import type { OutlineItem } from "../types";

export interface OutlineNode {
  item: OutlineItem;
  key: string;
  level: number;
  children: OutlineNode[];
}

/** Compress unused heading levels for display without changing source order or navigation targets. */
export function buildOutlineTree(items: readonly OutlineItem[]): OutlineNode[] {
  const levels = [...new Set(items.map(item => item.level))].sort((left, right) => left - right);
  const displayLevels = new Map(levels.map((level, index) => [level, index + 1]));
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  const occurrences = new Map<string, number>();
  for (const item of items) {
    const identity = JSON.stringify([item.level, item.text]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    const node: OutlineNode = { item, key: `${identity}:${occurrence}`, level: displayLevels.get(item.level)!, children: [] };
    while (stack.at(-1) && stack.at(-1)!.level >= node.level) stack.pop();
    const parent = stack.at(-1);
    (parent?.children ?? roots).push(node);
    stack.push(node);
  }
  return roots;
}
