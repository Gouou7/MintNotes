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
