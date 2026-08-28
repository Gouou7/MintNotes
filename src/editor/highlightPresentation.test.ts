import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appStyles = readFileSync(resolve("src/styles.css"), "utf8");

describe("highlight presentation", () => {
  it("uses explicit foreground and background colors in light and dark themes", () => {
    expect(appStyles).toMatch(
      /:root\s*\{[^}]*--highlight-bg:\s*#fff0a6;[^}]*--highlight-text:\s*#4a3d00;/s,
    );
    expect(appStyles).toMatch(
      /:root\[data-theme="dark"\]\s*\{[^}]*--highlight-bg:\s*#d8bf5a;[^}]*--highlight-text:\s*#211d09;/s,
    );
  });

  it("shares the theme-aware colors between Live and Reading modes", () => {
    expect(appStyles).toMatch(
      /\.markdown-editor-host \.ProseMirror mark, \.readonly-markdown mark\s*\{[^}]*background:\s*var\(--highlight-bg\);[^}]*color:\s*var\(--highlight-text\);/s,
    );
  });
});
