import { describe, expect, it } from "vitest";
import { buildOutline } from "./outline";

describe("buildOutline", () => {
  it("extracts heading levels and removes common inline markers", () => {
    expect(buildOutline("# Title\n\n## **Bold** and [link](https://example.com)\n### `Code`"))
      .toEqual([
        { id: "heading-0", level: 1, text: "Title", index: 0 },
        { id: "heading-1", level: 2, text: "Bold and link", index: 1 },
        { id: "heading-2", level: 3, text: "Code", index: 2 }
      ]);
  });

  it("does not treat fenced code as document headings", () => {
    expect(buildOutline("# Visible\n```md\n# Not visible\n```\n## Visible too").map((item) => item.text))
      .toEqual(["Visible", "Visible too"]);
  });
});

