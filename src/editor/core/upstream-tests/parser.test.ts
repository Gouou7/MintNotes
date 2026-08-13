import { describe, expect, test } from "vitest";

import { parse as parseMarkdown } from "../parser";
import { schema } from "../schema";
import { serialize } from "../serializer";

const parse = (markdown: string) => parseMarkdown(markdown, { sourceGaps: false });

describe("parser: block nodes", () => {
  test("paragraph with plain text", () => {
    const doc = parse("hello world");
    expect(doc.childCount).toBe(1);
    const p = doc.child(0);
    expect(p.type).toBe(schema.nodes.paragraph);
    expect(p.textContent).toBe("hello world");
  });

  test("headings 1-6 carry level attr", () => {
    const doc = parse("# h1\n\n## h2\n\n###### h6");
    expect(doc.childCount).toBe(3);
    expect(doc.child(0).type).toBe(schema.nodes.heading);
    expect(doc.child(0).attrs.level).toBe(1);
    expect(doc.child(1).attrs.level).toBe(2);
    expect(doc.child(2).attrs.level).toBe(6);
  });

  test("blockquote keeps its complete authored source", () => {
    const source = "> quoted\n>\n> second";
    const doc = parse(source);
    expect(doc.childCount).toBe(1);
    const bq = doc.child(0);
    expect(bq.type).toBe(schema.nodes.blockquote);
    expect(bq.textContent).toBe(source);
    expect(bq.attrs.sourceEditing).toBe(false);
    expect(serialize(doc)).toBe(source);
  });

  test("blockquote preserves authored prefixes, nesting, blanks, and fenced content", () => {
    for (const source of [
      ">quoted",
      "> quoted",
      " > indented once",
      "  > indented twice",
      "   > indented three times",
      ">>nested",
      "> > nested",
      "> first\n>\n> second",
      "> first\n> \n> second",
      "> ```md\n> [!NOTE]\n> ```",
    ]) {
      const doc = parse(source);
      expect(doc.firstChild?.type).toBe(schema.nodes.blockquote);
      expect(doc.firstChild?.textContent).toBe(source);
      expect(serialize(doc)).toBe(source);
    }
  });

  test("blockquote nested in a list stores source relative to its list container", () => {
    const doc = parse("- > first\n  > second");
    const quote = doc.firstChild?.firstChild?.child(1);

    expect(quote?.type).toBe(schema.nodes.blockquote);
    expect(quote?.textContent).toBe("> first\n> second");
  });

  test("bullet list with items", () => {
    const doc = parse("- a\n- b");
    const ul = doc.child(0);
    expect(ul.type).toBe(schema.nodes.bullet_list);
    expect(ul.childCount).toBe(2);
    const li = ul.child(0);
    expect(li.type).toBe(schema.nodes.list_item);
    expect(li.child(0).type).toBe(schema.nodes.paragraph);
    expect(li.child(0).textContent).toBe("a");
  });

  test.each([
    ["- one\n- two", 0],
    ["- one\n\n- two", 1],
    ["- one\n\n\n- two", 2],
    ["- one\r\n \r\n\t\r\n- two", 2],
  ] as const)("retains authored list-item spacing for %j", (markdown, gapBefore) => {
    const doc = parse(markdown);
    const list = doc.firstChild;

    expect(list?.type).toBe(schema.nodes.bullet_list);
    expect(list?.child(0).attrs.sourceGapBefore).toBe(0);
    expect(list?.child(1).attrs.sourceGapBefore).toBe(gapBefore);
    expect(serialize(parseMarkdown(markdown))).toBe(markdown);
  });

  test("retains authored spacing independently inside nested lists", () => {
    const doc = parse("- outer\n  - nested one\n\n  - nested two\n- sibling");
    const outer = doc.firstChild;
    const nested = outer?.child(0).child(1);

    expect(nested?.type).toBe(schema.nodes.bullet_list);
    expect(nested?.child(0).attrs.sourceGapBefore).toBe(0);
    expect(nested?.child(1).attrs.sourceGapBefore).toBe(1);
    expect(outer?.child(1).attrs.sourceGapBefore).toBe(0);
  });

  test("retains authored spacing between ordered-list items", () => {
    const markdown = "1. one\n\n\n2. two";
    const doc = parseMarkdown(markdown);
    const list = doc.firstChild;

    expect(list?.type).toBe(schema.nodes.ordered_list);
    expect(list?.child(1).attrs.sourceGapBefore).toBe(2);
    expect(serialize(doc)).toBe(markdown);
  });

  test.each(["*", "+", "-", "1.", "1)"])(
    "keeps incomplete list candidate %j as literal paragraph source",
    (markdown) => {
      const doc = parseMarkdown(markdown);
      expect(doc.firstChild?.type).toBe(schema.nodes.paragraph);
      expect(doc.firstChild?.textContent).toBe(markdown);
      expect(serialize(doc)).toBe(markdown);
    },
  );

  test.each(["Title\n=", "Title\n==", "Title\n-", "Title\n--"])(
    "keeps short Setext candidate %j literal until the third underline",
    (markdown) => {
      const doc = parseMarkdown(markdown);
      expect(doc.firstChild?.type).toBe(schema.nodes.paragraph);
      expect(doc.firstChild?.textContent).toBe(markdown);
      expect(serialize(doc)).toBe(markdown);
    },
  );

  test("protects an incomplete marker at its UTF-16 source offset after astral text", () => {
    const markdown = "😀 title\n\n*";
    const doc = parseMarkdown(markdown);
    expect(doc.lastChild?.type).toBe(schema.nodes.paragraph);
    expect(doc.lastChild?.textContent).toBe("*");
    expect(serialize(doc)).toBe(markdown);
  });

  test("does not reinterpret user-authored private-use characters as protected syntax", () => {
    const markdown = "\uE001\uE002\uE003\uE004\uE005\uE006\n\n*";
    const doc = parseMarkdown(markdown);
    expect(serialize(doc)).toBe(markdown);
    expect(doc.lastChild?.type).toBe(schema.nodes.paragraph);
    expect(doc.lastChild?.textContent).toBe("*");
  });

  test.each(["* ", "+ ", "- ", "1. ", "1) "])(
    "recognizes completed list candidate %j after its required space",
    (markdown) => {
      const doc = parseMarkdown(markdown);
      expect([schema.nodes.bullet_list, schema.nodes.ordered_list]).toContain(doc.firstChild?.type);
      expect(serialize(doc)).toBe(markdown);
    },
  );

  test("ordered list carries start attr", () => {
    const doc = parse("3. a\n4. b");
    const ol = doc.child(0);
    expect(ol.type).toBe(schema.nodes.ordered_list);
    expect(ol.attrs.start).toBe(3);
  });

  test("ordered list default start is 1", () => {
    const doc = parse("1. a\n2. b");
    expect(doc.child(0).attrs.start).toBe(1);
  });

  test("fenced code block with lang", () => {
    const doc = parse("```ts\nconst x = 1;\n```");
    const cb = doc.child(0);
    expect(cb.type).toBe(schema.nodes.code_block);
    expect(cb.attrs.lang).toBe("ts");
    expect(cb.textContent).toBe("```ts\nconst x = 1;\n```");
  });

  test("preserves an unclosed fenced block as editable source", () => {
    const markdown = "```ts\nconst x = 1;\n``";
    const doc = parse(markdown);
    const code = doc.firstChild!;

    expect(code.type).toBe(schema.nodes.code_block);
    expect(code.attrs.lang).toBe("ts");
    expect(code.attrs.sourceEditing).toBe(true);
    expect(code.textContent).toBe(markdown);
    expect(serialize(doc)).toBe(markdown);
  });

  test("indented code block has empty lang", () => {
    const doc = parse("    indented\n    line2");
    const cb = doc.child(0);
    expect(cb.type).toBe(schema.nodes.code_block);
    expect(cb.attrs.lang).toBe("");
    expect(cb.textContent).toBe("```\nindented\nline2\n```");
  });

  test("horizontal rule", () => {
    const doc = parse("foo\n\n---\n\nbar");
    expect(doc.child(1).type).toBe(schema.nodes.horizontal_rule);
    expect(doc.child(1).attrs.markup).toBe("---");

    const asteriskDoc = parse("foo\n\n***\n\nbar");
    expect(asteriskDoc.child(1).type).toBe(schema.nodes.horizontal_rule);
    expect(asteriskDoc.child(1).attrs.markup).toBe("***");
  });
});

describe("parser: inline marks", () => {
  test("strong and em", () => {
    // Typora-pilot (method B): parser keeps the `*` delim chars as plain
    // text in the doc, and the mark covers only the content. The content
    // text + delim text both live in the textblock; normalize maintains
    // the invariant at runtime.
    const doc = parse("**bold** and *italic*");
    const p = doc.child(0);
    const fragments: Array<{ text: string | undefined; marks: string[] }> = [];
    p.forEach((child) => fragments.push({ text: child.text, marks: child.marks.map((m) => m.type.name) }));
    expect(fragments).toEqual([
      { text: "**", marks: [] },
      { text: "bold", marks: ["strong"] },
      { text: "** and *", marks: [] },
      { text: "italic", marks: ["em"] },
      { text: "*", marks: [] },
    ]);
  });

  test("inline code mark", () => {
    const doc = parse("run `npm test`");
    const p = doc.child(0);
    const code = p.child(1);
    expect(code.marks.map((m) => m.type.name)).toEqual(["code"]);
    expect(code.text).toBe("npm test");
  });

  test("link with href and title", () => {
    const doc = parse('see [site](https://example.com "home")');
    const p = doc.child(0);
    const link = p.child(1);
    const linkMark = link.marks[0];
    expect(linkMark.type.name).toBe("link");
    expect(linkMark.attrs.href).toBe("https://example.com");
    expect(linkMark.attrs.title).toBe("home");
  });

  test("link without title has null title", () => {
    // Method-B: text is `[x](url)` plain; the link mark covers only `x`
    // in the middle child. child(0) is the opening `[`.
    const doc = parse("[x](https://example.com)");
    const linkMark = doc.child(0).child(1).marks[0];
    expect(linkMark.attrs.title).toBeNull();
  });

  test("nested marks: strong+em", () => {
    // markdown-it emits em_open → strong_open → text → strong_close → em_close,
    // so em is the outer mark: the `*` delims on the outside carry no mark,
    // the inner `**` delims carry em, and the content carries em+strong.
    const doc = parse("***both***");
    const p = doc.child(0);
    const fragments: Array<{ text: string | undefined; marks: string[] }> = [];
    p.forEach((child) =>
      fragments.push({ text: child.text, marks: child.marks.map((m) => m.type.name).sort() }),
    );
    expect(fragments).toEqual([
      { text: "*", marks: [] },
      { text: "**", marks: ["em"] },
      { text: "both", marks: ["em", "strong"] },
      { text: "**", marks: ["em"] },
      { text: "*", marks: [] },
    ]);
  });

  test("hard break vs soft break", () => {
    const doc = parse("a  \nb\nc");
    const p = doc.child(0);
    // a, <br>, b, "\n", c
    const kinds: string[] = [];
    p.forEach((child) => {
      kinds.push(child.isText ? `t:${JSON.stringify(child.text)}` : `n:${child.type.name}`);
    });
    expect(kinds).toEqual([`t:"a"`, "n:hard_break", `t:"b\\nc"`]);
  });
});

describe("parser: schema safety", () => {
  test("produces valid doc that passes check()", () => {
    const doc = parse(
      [
        "# title",
        "",
        "> quoted **bold**",
        "",
        "- one",
        "- two",
        "",
        "```js",
        "x",
        "```",
      ].join("\n"),
    );
    expect(() => doc.check()).not.toThrow();
  });

  test("code_block rejects inline marks (schema guarantee)", () => {
    // markdown-it never emits inline tokens inside a fence; this assertion
    // pins the schema constraint itself (code_block has `marks: ""`).
    const doc = parse("```\n**not bold**\n```");
    const cb = doc.child(0);
    expect(cb.textContent).toBe("```\n**not bold**\n```");
    expect(cb.child(0).marks.length).toBe(0);
  });
});
