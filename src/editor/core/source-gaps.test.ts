import { describe, expect, it } from "vitest";

import { parse } from "./parser";
import { serialize } from "./serializer";
import { SOURCE_FIDELITY_LINE_ENDING_STRINGS } from "./source-fidelity-fixtures";
import { SOURCE_TEXT_ATTR } from "./source";

function gapSource(markdown: string): string {
  const doc = parse(markdown);
  let source = "";
  doc.forEach((node) => {
    if (node.type.name === "source_gap") source += String(node.attrs[SOURCE_TEXT_ATTR] ?? "");
  });
  return source;
}

describe("source-backed whitespace gaps", () => {
  it.each(SOURCE_FIDELITY_LINE_ENDING_STRINGS)(
    "round-trips exact whitespace and line endings for %j",
    (markdown) => {
      expect(serialize(parse(markdown))).toBe(markdown);
    },
  );

  it.each(SOURCE_FIDELITY_LINE_ENDING_STRINGS)(
    "keeps otherwise unrepresented whitespace addressable for %j",
    (markdown) => {
      const gaps = gapSource(markdown);
      if (markdown.trim().length === 0) {
        expect(gaps).toBe(markdown);
      } else {
        for (const character of gaps) expect(markdown).toContain(character);
      }
    },
  );

  it("retains leading, inter-block, and trailing whitespace in separate gap nodes", () => {
    const markdown = "\r\n \r\nfirst\r\n\t\r\n\r\nsecond\r\n\r\n";
    const doc = parse(markdown);
    const gaps: string[] = [];
    doc.forEach((node) => {
      if (node.type.name === "source_gap") gaps.push(String(node.attrs[SOURCE_TEXT_ATTR] ?? ""));
    });
    expect(gaps).toEqual(["\r\n \r\n", "\r\n\t\r\n\r\n", "\r\n\r\n"]);
  });

  it.each([
    ["a\n\nb", 0],
    ["a\n\n\nb", 1],
    ["\n\nb", 1],
    ["a\n\n", 1],
    ["\n\n", 2],
    ["a\r\n\r\nb", 0],
    ["a\r\n\r\n\r\nb", 1],
  ] as const)("renders only authored blank rows for %j", (markdown, visibleBreaks) => {
    const gap = parse(markdown).content.content.find((node) => node.type.name === "source_gap");
    expect(gap).toBeDefined();
    let renderedBreaks = 0;
    gap!.forEach((node) => {
      if (node.type.name === "source_gap_eol" && node.attrs.visible) renderedBreaks += 1;
    });
    expect(renderedBreaks).toBe(visibleBreaks);
  });
});
