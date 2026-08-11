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

  it("uses deterministic affinity for delimiters absent from the derived heading content", () => {
    const source = "## heading ##";
    const map = SourcePositionMap.fromDocument(parse(source), source);
    expect(map.sourceToDocument(1, "left")).toBe(map.sourceToDocument(0, "left"));
    expect(map.sourceToDocument(1, "right")).toBe(map.sourceToDocument(3, "right"));
  });
});
