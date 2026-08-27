import { describe, expect, it } from "vitest";
import { materializeSingleLineDisplayMathForReading } from "./liveMathCodec";

describe("reading math codec", () => {
  it("expands single-line display math for the read-only parser without touching code fences", () => {
    const markdown = "$$E = mc^2$$\n\n```md\n$$not math$$\n```";
    expect(materializeSingleLineDisplayMathForReading(markdown)).toBe(
      "$$\nE = mc^2\n$$\n\n```md\n$$not math$$\n```"
    );
  });

  it.each([
    "plain text",
    "$$\nvalue\n$$",
    "$$\r\nvalue\r\n$$\r\n",
    "> $$\r\n> value\n> $$\r\n",
    "````md\n$$\nnot math\n$$\n````",
    "~~~md\r\n$$\r\nnot math\r\n$$\r\n~~~",
  ])("leaves non-single-line source unchanged for %j", (markdown) => {
    expect(materializeSingleLineDisplayMathForReading(markdown)).toBe(markdown);
  });
});
