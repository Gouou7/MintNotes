import { describe, expect, it } from "vitest";
import {
  addFrontmatterProperty,
  deleteFrontmatterProperty,
  parseFrontmatter,
  renameFrontmatterProperty,
  replaceFrontmatterBody,
  setFrontmatterProperty
} from "./frontmatter";

describe("frontmatter", () => {
  const markdown = [
    "---",
    "# keep this comment",
    "version:",
    "description: Example",
    "created: 2026-07-25",
    'modified: "{{date}}"',
    "published: false",
    "count: 3",
    "tags:",
    "  - alpha",
    "  - beta",
    "---",
    "# Body",
    "",
    "---",
    "not frontmatter"
  ].join("\n");

  it("recognizes only a leading frontmatter block and preserves body bytes", () => {
    const parsed = parseFrontmatter(markdown);
    expect(parsed.status).toBe("valid");
    if (parsed.status !== "valid") return;
    expect(parsed.body).toBe("# Body\n\n---\nnot frontmatter");
    expect(parsed.properties.map((property) => [property.key, property.kind])).toEqual([
      ["version", "text"],
      ["description", "text"],
      ["created", "date"],
      ["modified", "text"],
      ["published", "boolean"],
      ["count", "number"],
      ["tags", "list"]
    ]);
    expect(replaceFrontmatterBody(parsed, "Changed")).toBe(parsed.prefix + "Changed");
    expect(parseFrontmatter("text\n---\nvalue: 1\n---").status).toBe("absent");
  });

  it("updates simple properties while retaining comments, order, templates, and body", () => {
    let next = setFrontmatterProperty(markdown, "description", "Updated");
    next = setFrontmatterProperty(next, "tags", ["alpha", "gamma"]);
    next = renameFrontmatterProperty(next, "count", "total");
    next = deleteFrontmatterProperty(next, "published");
    next = addFrontmatterProperty(next, "owner");

    expect(next).toContain("# keep this comment");
    expect(next).toContain('modified: "{{date}}"');
    expect(next).toContain("description: Updated");
    expect(next).toContain("total: 3");
    expect(next).toContain("owner:");
    expect(next).not.toContain("published:");
    expect(next.endsWith("# Body\n\n---\nnot frontmatter")).toBe(true);
    expect(next.indexOf("version:")).toBeLessThan(next.indexOf("description:"));
  });

  it("rejects duplicate names and safely degrades complex or invalid YAML", () => {
    expect(renameFrontmatterProperty(markdown, "count", "tags")).toBe(markdown);
    expect(addFrontmatterProperty(markdown, "tags")).toBe(markdown);

    const complex = parseFrontmatter("---\nsimple: yes\nnested:\n  child: value\n---\nbody");
    expect(complex.status).toBe("valid");
    if (complex.status === "valid") {
      expect(complex.properties.find((property) => property.key === "nested")?.kind).toBe("complex");
    }

    const invalidSource = "---\nkey: [\n---\nbody";
    const invalid = parseFrontmatter(invalidSource);
    expect(invalid.status).toBe("invalid");
    expect(setFrontmatterProperty(invalidSource, "key", "value")).toBe(invalidSource);
  });

  it("preserves BOM and CRLF delimiters", () => {
    const source = "\uFEFF---\r\nname: value\r\n---\r\nBody\r\n";
    const next = setFrontmatterProperty(source, "name", "changed");
    expect(next).toBe("\uFEFF---\r\nname: changed\r\n---\r\nBody\r\n");
  });
});
