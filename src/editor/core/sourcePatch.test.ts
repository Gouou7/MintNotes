import { describe, expect, it } from "vitest";
import { mapEquivalentOffset, preserveAuthoredSource } from "./sourcePatch";

describe("canonical Markdown source patches", () => {
  it("preserves an authored table entity when editing a later cell", () => {
    const canonical = "| A | B |\n| --- | --- |\n| a &#124; b | old |";
    const rendered = "| A | B |\n| --- | --- |\n| a | b | old |";
    const changed = "| A | B |\n| --- | --- |\n| a | b | new |";
    expect(preserveAuthoredSource(canonical, rendered, changed)).toBe(
      "| A | B |\n| --- | --- |\n| a &#124; b | new |"
    );
  });

  it("preserves authored link-title escapes when editing surrounding prose", () => {
    const canonical = 'before [link](https://example.com "a\\"b") after';
    const rendered = 'before [link](https://example.com "a"b") after';
    const changed = 'before [link](https://example.com "a"b") later';
    expect(preserveAuthoredSource(canonical, rendered, changed)).toBe(
      'before [link](https://example.com "a\\"b") later'
    );
  });

  it("maps positions after a differently spelled source token", () => {
    expect(mapEquivalentOffset("a | b then", "a &#124; b then", 10)).toBe(15);
  });
});
