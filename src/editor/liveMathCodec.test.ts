import { describe, expect, it } from "vitest";
import {
  canonicalizeMathBlocksFromLive,
  materializeMathBlocksForLive,
  materializeSingleLineDisplayMathForReading
} from "./liveMathCodec";

describe("live math codec", () => {
  it("materializes multiline display math as a reversible private code block", () => {
    const markdown = [
      "Before",
      "",
      "$$",
      "\\int_0^1 x^2\\,dx",
      "$$",
      "",
      "After"
    ].join("\n");
    const live = materializeMathBlocksForLive(markdown);

    expect(live).toContain("```mint-math\n\\int_0^1 x^2\\,dx\n```");
    expect(canonicalizeMathBlocksFromLive(live)).toBe(markdown);
  });

  it("handles display math nested in a blockquote and ignores authored fences", () => {
    const markdown = [
      "> [!NOTE]",
      "> $$",
      "> E = mc^2",
      "> $$",
      "",
      "```md",
      "$$",
      "not math",
      "$$",
      "```"
    ].join("\n");
    const live = materializeMathBlocksForLive(markdown);

    expect(live).toContain("> ```mint-math\n> E = mc^2\n> ```");
    expect(live).toContain("```md\n$$\nnot math\n$$\n```");
    expect(canonicalizeMathBlocksFromLive(live)).toBe(markdown);
  });

  it("expands single-line display math for the read-only parser without touching code fences", () => {
    const markdown = "$$E = mc^2$$\n\n```md\n$$not math$$\n```";
    expect(materializeSingleLineDisplayMathForReading(markdown)).toBe(
      "$$\nE = mc^2\n$$\n\n```md\n$$not math$$\n```"
    );
  });

  it("chooses a fence that cannot collide with display-math content", () => {
    const markdown = "$$\n\\text{```}\n$$";
    const live = materializeMathBlocksForLive(markdown);

    expect(live).toBe("````mint-math\n\\text{```}\n````");
    expect(canonicalizeMathBlocksFromLive(live)).toBe(markdown);
  });
});
