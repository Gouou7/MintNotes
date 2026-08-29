import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appStyles = readFileSync(resolve("src/styles.css"), "utf8");
const liveThemes = [
  readFileSync(resolve("src/editor/core/styles/theme-typora.css"), "utf8"),
  readFileSync(resolve("src/editor/core/styles/theme-github.css"), "utf8"),
];

describe("emphasis presentation", () => {
  it("allows italic synthesis for CJK text in Live and Reading modes", () => {
    for (const theme of liveThemes) {
      expect(theme).toMatch(/\.ProseMirror em\s*\{[^}]*font-style: italic;[^}]*font-synthesis: style;/s);
    }
    expect(appStyles).toMatch(
      /\.reading-editor em\s*\{[^}]*font-style: italic;[^}]*font-synthesis: style;/s,
    );
  });
});
