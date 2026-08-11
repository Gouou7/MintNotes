import { describe, expect, it } from "vitest";

import { parse } from "./parser";
import { serialize } from "./serializer";
import { SOURCE_FIDELITY_LINE_ENDING_STRINGS } from "./source-fidelity-fixtures";

function gapSource(markdown: string): string {
  const doc = parse(markdown);
  let source = "";
  doc.forEach((node) => {
    if (node.type.name === "source_gap") source += node.textContent;
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
      if (node.type.name === "source_gap") gaps.push(node.textContent);
    });
    expect(gaps).toEqual(["\r\n \r\n", "\r\n\t\r\n\r\n", "\r\n\r\n"]);
  });
});
