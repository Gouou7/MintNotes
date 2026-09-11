import { describe, expect, it } from "vitest";

import { parse } from "./parser";
import { SourcePositionMap } from "./source-position-map";
import { SOURCE_FIDELITY_LINE_ENDING_STRINGS } from "./source-fidelity-fixtures";

describe("canonical source position map", () => {
  it.each(SOURCE_FIDELITY_LINE_ENDING_STRINGS)(
    "maps every represented boundary exactly for %j",
    (source) => {
      const doc = parse(source);
      const map = SourcePositionMap.fromDocument(doc, source);
      for (let offset = 0; offset <= source.length; offset += 1) {
        const position = map.sourceToDocument(offset);
        expect(map.documentToSource(position)).toBe(offset);
      }
    },
  );

  it.each(["- first\n    ---", "> title\n> ==="])(
    "retains nested Setext content and every underline boundary for %j",
    (source) => {
      const doc = parse(source);
      const map = SourcePositionMap.fromDocument(doc, source);
      expect(doc.textContent).toBe(source);
      for (let offset = 0; offset <= source.length; offset++) {
        expect(map.hasExactSourceBoundary(offset)).toBe(true);
        expect(map.documentToSource(map.sourceToDocument(offset))).toBe(offset);
      }
    },
  );

  it.each([
    "- first\n    - ",
    "- first\n    - \t",
    "- first\n    continued\n    - ",
    "- first\n    - second\n        - ",
    "1. first\n    2. ",
    "> - first\n>     - ",
    "- first\r\n    - ",
  ])("projects an empty nested item without turning its parent into a heading for %j", (source) => {
    const doc = parse(source);
    const headings: string[] = [];
    const items: string[] = [];
    doc.descendants((node) => {
      if (node.type.name === "heading") headings.push(node.textContent);
      if (node.type.name === "list_item") items.push(node.textContent);
    });
    expect(headings).toEqual([]);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.at(-1)).toBe(source.split(/\r?\n/).at(-1));
    const map = SourcePositionMap.fromDocument(doc, source);
    const lastLineFrom = source.lastIndexOf("\n") + 1;
    for (let offset = lastLineFrom; offset <= source.length; offset++) {
      expect(map.hasExactSourceBoundary(offset)).toBe(true);
      expect(map.documentToSource(map.sourceToDocument(offset))).toBe(offset);
    }
  });

  it.each(["title\n- ", "- title\n    -- ", "- title\n    ===\n    - "])(
    "retains genuine Setext headings for %j",
    (source) => {
      const headings: string[] = [];
      parse(source).descendants((node) => {
        if (node.type.name === "heading") headings.push(node.textContent);
      });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toContain("title");
    },
  );

  it("owns every heading delimiter boundary in both directions", () => {
    const source = "## heading ##";
    const map = SourcePositionMap.fromDocument(parse(source), source);
    for (let offset = 0; offset <= source.length; offset++) {
      expect(map.documentToSource(map.sourceToDocument(offset, "left"))).toBe(offset);
      expect(map.documentToSource(map.sourceToDocument(offset, "right"))).toBe(offset);
    }
  });

  it("gives blank rows between a list, Quote, and Callout an authored DOM position", () => {
    const source = [
      "1. 的",
      "2. 有序列表",
      "",
      ">quote",
      "",
      "> [!note]",
      "> callout",
    ].join("\n");
    const doc = parse(source);
    const map = SourcePositionMap.fromDocument(doc, source);
    const blankOffsets = [
      source.indexOf("\n\n>quote") + 1,
      source.indexOf("\n\n> [!note]") + 1,
    ];
    const visibleRowPositions: number[] = [];

    doc.forEach((node, position) => {
      if (node.type.name !== "source_gap") return;
      node.forEach((child, relativePosition) => {
        if (child.type.name === "source_gap_eol" && child.attrs.visible === true) {
          visibleRowPositions.push(position + 1 + relativePosition);
        }
      });
    });

    expect(visibleRowPositions).toHaveLength(2);
    expect(visibleRowPositions.map((position) => map.documentToSource(position)))
      .toEqual(blankOffsets);
  });
});
