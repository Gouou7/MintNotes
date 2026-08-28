import { describe, expect, it } from "vitest";
import { buildOutline, findOutlineHeading } from "./outline";

describe("buildOutline", () => {
  it("extracts heading levels and removes common inline markers", () => {
    expect(buildOutline("# Title\n\n## **Bold** and [link](https://example.com)\n### `Code`"))
      .toEqual([
        { id: "heading-0", level: 1, text: "Title", index: 0, sourceOffset: 0, sourceLine: 0 },
        { id: "heading-1", level: 2, text: "Bold and link", index: 1, sourceOffset: 9, sourceLine: 2 },
        { id: "heading-2", level: 3, text: "Code", index: 2, sourceOffset: 53, sourceLine: 3 }
      ]);
  });

  it("does not treat fenced code as document headings", () => {
    expect(buildOutline("# Visible\n```md\n# Not visible\n```\n## Visible too").map((item) => item.text))
      .toEqual(["Visible", "Visible too"]);
  });

  it("tracks canonical source positions and includes Setext headings outside frontmatter and fences", () => {
    const markdown = "---\n# yaml comment\n---\nTitle\n=====\n~~~md\nHidden\n------\n~~~\n## End";
    expect(buildOutline(markdown)).toEqual([
      { id: "heading-0", level: 1, text: "Title", index: 0, sourceOffset: 23, sourceLine: 3 },
      { id: "heading-1", level: 2, text: "End", index: 1, sourceOffset: 59, sourceLine: 9 }
    ]);
  });

  it("resolves Obsidian-style heading paths without confusing repeated subheadings", () => {
    const outline = buildOutline([
      "# First chapter",
      "## Details",
      "# Second chapter",
      "## Details",
      "### Deep dive"
    ].join("\n"));

    expect(findOutlineHeading(outline, "details")?.index).toBe(1);
    expect(findOutlineHeading(outline, "Second%20chapter#Details")?.index).toBe(3);
    expect(findOutlineHeading(outline, "Second chapter#Details#Deep dive")?.index).toBe(4);
    expect(findOutlineHeading(outline, "First chapter#Deep dive")).toBeNull();
  });
});
