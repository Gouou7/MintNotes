import MarkdownIt from "markdown-it";
import type { Node as PMNode } from "prosemirror-model";
import { describe, expect, it } from "vitest";
import { strictListMarkers } from "./list-markers";
import { parse } from "./parser";
import { serialize } from "./serializer";
import { withLineEndingVariants } from "./source-fidelity-fixtures";
import { SourcePositionMap } from "./source-position-map";

const markers = ["-", "+", "*", "1.", "1)", "07.", "123456789)"];
const prefixes = [
  ["", 0], ["> ", 0], ["> > ", 0], [">>", 0], ["  >\t", 0],
  ["- ", 1], ["07) ", 1], ["- > ", 1], ["> - ", 1], ["- + ", 2],
  ["- item\n    ", 1], ["> - item\n>     ", 1],
  ["- item\n", 1], ["> - item\n> ", 1],
] as const;

function countNodes(doc: PMNode, type: string): number {
  let count = 0;
  doc.descendants((node) => { if (node.type.name === type) count++; });
  return count;
}

const incompleteItems = prefixes.flatMap(([prefix, existingItems]) => markers.flatMap((marker) =>
  withLineEndingVariants(`${prefix}${marker}`).map((source) => ({ source, existingItems })),
));

describe("list marker separators", () => {
  it.each(incompleteItems)("keeps an unfinished marker literal in $source", ({ source, existingItems }) => {
    const doc = parse(source);
    expect(countNodes(doc, "list_item")).toBe(existingItems);
    expect(serialize(doc)).toBe(source);
    expect(doc.textContent).toContain(source.split(/\r\n|\r|\n/).at(-1));
    const positions = SourcePositionMap.fromDocument(doc, source);
    for (let offset = 0; offset <= source.length; offset++) {
      expect(positions.hasExactSourceBoundary(offset)).toBe(true);
      expect(positions.documentToSource(positions.sourceToDocument(offset))).toBe(offset);
    }
  });

  it.each(prefixes.flatMap(([prefix, existingItems]) => [" ", "\t"].map((separator) => ({
    source: `${prefix}-${separator}`, existingItems,
  }))))("creates an empty item after an authored separator in $source", ({ source, existingItems }) => {
    const doc = parse(source);
    expect(countNodes(doc, "list_item")).toBe(existingItems + 1);
    expect(serialize(doc)).toBe(source);
  });

  it.each(markers.flatMap((marker) => [" ", "\t"].map((separator) => `> ${marker}${separator}`)))(
    "accepts every complete marker in %j", (source) => {
      expect(countNodes(parse(source), "list_item")).toBe(1);
      expect(serialize(parse(source))).toBe(source);
    },
  );

  it.each(["- - -", "* * *", "---", "***", "___"].flatMap((line) => [line, `> ${line}`, `- > ${line}`]))(
    "preserves the thematic break in %j", (source) => {
      expect(countNodes(parse(source), "horizontal_rule")).toBe(1);
      expect(serialize(parse(source))).toBe(source);
      expect(new MarkdownIt("commonmark").use(strictListMarkers).render(source)).toContain("<hr");
    },
  );

  it.each(["-", "+", "*", "07)"])("preserves %j inside code", (marker) => {
    const md = new MarkdownIt("commonmark").use(strictListMarkers);
    for (const source of [`\`\`\`md\n${marker}\n\`\`\``, `    ${marker}`, `> \`\`\`\n> ${marker}\n> \`\`\``]) {
      expect(md.render(source)).toContain(`${marker}\n</code>`);
      expect(serialize(parse(source))).toBe(source);
    }
  });

  it.each([
    ["[a](\n-\n)", '<p><a href="-">a</a></p>\n'],
    ["![a](\n-\n)", '<p><img src="-" alt="a" /></p>\n'],
    ["[a]:\n-\n\n[a]", '<p><a href="-">a</a></p>\n'],
    ['[a](x\n"\n-\n")', '<p><a href="x" title="\n-\n">a</a></p>\n'],
    ['[a]: x "\n-\n"\n\n[a]', '<p><a href="x" title="\n-\n">a</a></p>\n'],
    ["[\n-\n]: x\n\n[\n-\n]", '<p><a href="x">\n-\n</a></p>\n'],
  ])("preserves link destinations, titles and labels in %j", (source, html) => {
    expect(new MarkdownIt("commonmark").use(strictListMarkers).render(source)).toBe(html);
    expect(serialize(parse(source))).toBe(source);
    expect(JSON.stringify(parse(source, { sourceGaps: false }).toJSON())).not.toMatch(/[\uE001-\uF8FF]|%EE%8[0-9A-F]%[0-9A-F]{2}/i);
  });

  it("preserves authored private-use spellings and UTF-16 offsets", () => {
    const source = "😀 \uE001 &#57346; &#xE003; %ee%80%84\r\n\r\n> -";
    const baseline = new MarkdownIt("commonmark").render(source.split("\r\n\r\n")[0]!);
    const html = new MarkdownIt("commonmark").use(strictListMarkers).render(source);
    expect(html).toContain(baseline.trim());
    expect(html).toContain("<p>-</p>");
    const doc = parse(source);
    expect(serialize(doc)).toBe(source);
    expect(countNodes(doc, "list_item")).toBe(0);
    const positions = SourcePositionMap.fromDocument(doc, source);
    for (let offset = 0; offset <= source.length; offset++) {
      expect(positions.documentToSource(positions.sourceToDocument(offset))).toBe(offset);
    }
  });

  it("keeps an authored encoded link target distinct from parser sentinels", () => {
    const source = "[a](&percnt;EE&#37;80%81)\n\n> -";
    expect(new MarkdownIt("commonmark").use(strictListMarkers).render(source)).toContain('href="%EE%80%81"');
    expect(serialize(parse(source))).toBe(source);
  });
});
