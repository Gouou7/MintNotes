import { describe, expect, it } from "vitest";

import { CanonicalSource, replaceSourceRange } from "./source";
import {
  onlyChangedRange,
  SOURCE_FIDELITY_LINE_ENDING_STRINGS,
  withLineEndingVariants,
} from "./source-fidelity-fixtures";

describe("canonical source transactions", () => {
  it.each(SOURCE_FIDELITY_LINE_ENDING_STRINGS)("retains exact source bytes for %j", (source) => {
    const result = new CanonicalSource(source).apply({
      edits: [],
      selection: { anchor: source.length, head: source.length },
      origin: "external",
    });
    expect(result.source.value).toBe(source);
  });

  it("applies multiple disjoint edits against the same source snapshot", () => {
    const source = new CanonicalSource("first middle last");
    const result = source.apply({
      edits: [
        { from: 0, to: 5, insert: "1st" },
        { from: 13, to: 17, insert: "final" },
      ],
      selection: { anchor: 16, head: 16 },
      origin: "command",
    });
    expect(result.source.value).toBe("1st middle final");
  });

  it("rejects overlapping, reversed, and out-of-bounds edits", () => {
    const source = new CanonicalSource("abcdef");
    expect(() => source.apply({
      edits: [
        { from: 1, to: 4, insert: "" },
        { from: 3, to: 5, insert: "" },
      ],
      selection: { anchor: 0, head: 0 },
      origin: "delete",
    })).toThrow(/must not overlap/);
    expect(() => replaceSourceRange(source.value, { from: 4, to: 2 }, "")).toThrow(/reversed/);
    expect(() => replaceSourceRange(source.value, { from: 0, to: 7 }, "")).toThrow(/\[0, 6\]/);
  });

  it.each(withLineEndingVariants("\n\nrepeated\n\nrepeated\n\n"))(
    "reports one exact changed range without relying on unique anchors for %j",
    (source) => {
      const from = source.lastIndexOf("repeated") + 3;
      const next = source.slice(0, from) + "X" + source.slice(from + 1);
      expect(onlyChangedRange(source, next)).toEqual({ from, to: from + 1, inserted: "X" });
    },
  );
});
