import { describe, expect, it } from "vitest";
import { countText } from "./wordCount";

describe("countText", () => {
  it("counts mixed Chinese and English words without punctuation", () => {
    const result = countText("你好，世界！ Hello, secure notes.");
    expect(result.words).toBeGreaterThanOrEqual(5);
    expect(result.characters).toBeGreaterThan(result.words);
  });

  it("counts emoji and punctuation as characters but not words", () => {
    expect(countText("！🙂")).toEqual({ words: 0, characters: 2 });
  });
});
