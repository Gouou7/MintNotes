import { describe, expect, it } from "vitest";
import type { OutlineItem } from "../types";
import { buildOutlineTree, type OutlineNode } from "./outlineTree";

const heading = (level: number, index: number, text = `Heading ${index}`): OutlineItem => ({
  id: `heading-${index}`, level, index, text, sourceOffset: index * 30, sourceLine: index * 3
});
const flatten = (nodes: OutlineNode[]): OutlineNode[] => nodes.flatMap(node => [node, ...flatten(node.children)]);

describe("buildOutlineTree", () => {
  it.each([
    [[2, 2], [1, 1]],
    [[2, 4, 2], [1, 2, 1]],
    [[1, 3, 1], [1, 2, 1]],
    [[3, 5, 6, 3], [1, 2, 3, 1]]
  ])("compresses the used heading levels %j into %j", (levels, displayed) => {
    const items = levels.map((level, index) => Object.freeze(heading(level, index)));
    const nodes = flatten(buildOutlineTree(items));

    expect(nodes.map(node => node.level)).toEqual(displayed);
    expect(nodes.map(node => node.item)).toEqual(items);
    expect(nodes.every((node, index) => node.item === items[index])).toBe(true);
    expect(items.map(item => item.level)).toEqual(levels);
  });

  it("attaches headings to their preceding higher-level parent and keeps sibling order", () => {
    const items = [2, 4, 6, 4, 2].map((level, index) => heading(level, index));
    const tree = buildOutlineTree(items);

    expect(tree.map(node => node.item.index)).toEqual([0, 4]);
    expect(tree[0].children.map(node => node.item.index)).toEqual([1, 3]);
    expect(tree[0].children[0].children[0].item).toBe(items[2]);
    expect(tree[0].children[1].children).toEqual([]);
  });

  it("does not invent a parent or reorder an early deeper heading", () => {
    const items = [4, 2, 4].map((level, index) => heading(level, index));
    const tree = buildOutlineTree(items);
    expect(tree.map(node => node.item.index)).toEqual([0, 1]);
    expect(tree[1].children[0].item).toBe(items[2]);
    expect(flatten(tree).map(node => node.item.index)).toEqual([0, 1, 2]);
  });

  it("keeps identities stable when source positions shift and distinguishes repeated titles", () => {
    const items = [heading(2, 0, "Parent"), heading(4, 1, "Repeated"), heading(4, 2, "Repeated")];
    const keys = flatten(buildOutlineTree(items)).map(node => node.key);
    const shifted = [heading(2, 0, "New section"), ...items.map(item => ({ ...item, index: item.index + 1, id: `heading-${item.index + 1}`, sourceOffset: item.sourceOffset + 100 }))];

    expect(new Set(keys).size).toBe(3);
    expect(flatten(buildOutlineTree(shifted)).slice(1).map(node => node.key)).toEqual(keys);
  });

  it("accepts an empty outline", () => expect(buildOutlineTree([])).toEqual([]));
});
