import { afterEach, describe, expect, it } from "vitest";
import { createEditor, type EditorOptions } from "./core/lib";
import { createCalloutExtension, focusCalloutMarker } from "./extensions/callout";
import {
  createRichSyntaxExtension,
  type RichSyntaxOptions,
} from "./extensions/richSyntax";

function createMintEditor(
  host: HTMLElement,
  options: EditorOptions & { richSyntax?: RichSyntaxOptions } = {},
) {
  const { richSyntax, ...editorOptions } = options;
  return createEditor(host, {
    ...editorOptions,
    extensions: [
      createCalloutExtension(),
      createRichSyntaxExtension(richSyntax),
    ],
  });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Mint editor core public controller", () => {
  it("reveals a horizontal rule source on click and preserves its delimiter", () => {
    for (const delimiter of ["---", "***"] as const) {
      const host = document.createElement("div");
      document.body.append(host);
      const editor = createMintEditor(host, { initialContent: delimiter });
      const ruleRow = host.querySelector<HTMLElement>(".hr-node-view");
      if (!ruleRow) throw new Error(`Missing rendered rule row for ${delimiter}`);

      const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      ruleRow.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      ruleRow.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

      const source = host.querySelector<HTMLParagraphElement>("p.hr-draft");
      expect(source?.textContent).toBe(delimiter);
      expect(editor.getMarkdown()).toBe(delimiter);
      editor.destroy();
      host.remove();
    }
  });

  it("lets an activated horizontal rule be deleted or followed by a new line", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host, { initialContent: "---" });
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    const ruleRow = host.querySelector<HTMLElement>(".hr-node-view");
    if (!editable || !ruleRow) throw new Error("Missing live horizontal rule");

    ruleRow.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const source = host.querySelector<HTMLParagraphElement>("p.hr-draft");
    if (!source) throw new Error("Missing revealed horizontal rule source");
    source.textContent = "--";
    const range = document.createRange();
    range.selectNodeContents(source);
    range.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    editable.dispatchEvent(new InputEvent("input", {
      inputType: "deleteContentBackward",
      data: null,
      bubbles: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.querySelector("hr")).toBeNull();
    expect(editor.getMarkdown()).toBe("--");
    editor.destroy();
    host.remove();

    const lineHost = document.createElement("div");
    document.body.append(lineHost);
    const lineEditor = createMintEditor(lineHost, { initialContent: "---" });
    const lineEditable = lineHost.querySelector<HTMLElement>(".ProseMirror");
    const lineRuleRow = lineHost.querySelector<HTMLElement>(".hr-node-view");
    if (!lineEditable || !lineRuleRow) throw new Error("Missing second live horizontal rule");
    lineRuleRow.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const lineSource = lineHost.querySelector<HTMLParagraphElement>("p.hr-draft");
    if (!lineSource) throw new Error("Missing second revealed horizontal rule source");
    const lineRange = document.createRange();
    lineRange.selectNodeContents(lineSource);
    lineRange.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(lineRange);
    lineEditable.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }));
    expect(lineHost.querySelector(".hr-node-view")).not.toBeNull();
    expect(lineHost.querySelectorAll(".ProseMirror > p")).toHaveLength(1);
    expect(lineEditor.getMarkdown()).toBe("---");

    const restoredRuleRow = lineHost.querySelector<HTMLElement>(".hr-node-view");
    if (!restoredRuleRow) throw new Error("Missing restored horizontal rule row");
    restoredRuleRow.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }));
    expect(lineHost.querySelector("p.hr-draft")?.textContent).toBe("---");
    lineEditor.destroy();
  });

  it("reveals one editable fenced-code source without changing Markdown", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "```ts\nconst value = 1;\n```";
    const editor = createMintEditor(host, { initialContent: markdown });
    const label = host.querySelector<HTMLElement>(".cb-language-label");
    const code = host.querySelector<HTMLElement>("pre code");
    if (!label || !code) throw new Error("Missing fenced code block");
    expect(label.textContent).toBe("TypeScript");

    label.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    }));

    expect(host.querySelector("pre")?.dataset.sourceEditing).toBe("1");
    expect(code.textContent).toBe(markdown);
    expect(host.querySelector(".cb-language-label")?.hasAttribute("hidden")).toBe(true);
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it("loads Mint-specific presentation only through explicit extensions", () => {
    const bareHost = document.createElement("div");
    document.body.append(bareHost);
    const markdown = "> [!NOTE]\n>\n> Body";
    const bareEditor = createEditor(bareHost, { initialContent: markdown });

    expect(bareHost.querySelector("blockquote")).not.toBeNull();
    expect(bareHost.querySelector("blockquote.live-callout")).toBeNull();
    bareEditor.destroy();

    const extendedHost = document.createElement("div");
    document.body.append(extendedHost);
    const extendedEditor = createMintEditor(extendedHost, { initialContent: markdown });

    expect(extendedHost.querySelector("blockquote.live-callout")).not.toBeNull();
    extendedEditor.destroy();
  });

  it("waits until Enter to turn a line-leading greater-than sign into a blockquote", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createMintEditor(host, { onChange: (markdown) => changes.push(markdown) });

    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    const paragraph = editable?.querySelector("p");
    if (!editable || !paragraph) throw new Error("Missing live editor paragraph");
    paragraph.textContent = ">";
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    editable.dispatchEvent(new InputEvent("input", {
      inputType: "insertText",
      data: ">",
      bubbles: true
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.querySelector("blockquote")).toBeNull();
    expect(editor.getMarkdown()).toBe(">");

    editable.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true
    }));
    expect(host.querySelector("blockquote")).not.toBeNull();
    expect(host.querySelectorAll("blockquote > p")).toHaveLength(2);
    expect(editor.getMarkdown()).toMatch(/^> ?/);
    expect(changes.at(-1)).toMatch(/^> ?/);
    expect(editor.getMarkdown()).not.toContain("\\>");

    editor.replaceMarkdown("a > b", "a > b".length);
    expect(editor.getMarkdown()).toBe("a > b");
    editor.destroy();
  });

  it("never synthesizes backslash escapes for Markdown punctuation", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host);

    editor.replaceMarkdown("plain # - + * _ [ ] < > \\ `");
    expect(editor.getMarkdown()).toBe("plain # - + * _ [ ] < > \\ `");
    expect(editor.getMarkdown()).not.toContain("\\#");
    expect(editor.getMarkdown()).not.toContain("\\-");
    expect(editor.getMarkdown()).not.toContain("\\+");
    expect(editor.getMarkdown()).not.toContain("\\*");
    expect(editor.getMarkdown()).not.toContain("\\_");
    expect(editor.getMarkdown()).not.toContain("\\[");
    expect(editor.getMarkdown()).not.toContain("\\]");
    expect(editor.getMarkdown()).not.toContain("\\<");

    editor.replaceMarkdown([
      "| Left | Right |",
      "| --- | --- |",
      "| a &#124; b | value |"
    ].join("\n"));
    expect(editor.getMarkdown()).toContain("a | b");
    expect(editor.getMarkdown()).not.toContain("\\|");

    editor.replaceMarkdown('[link](https://example.com "a\\"b")');
    expect(editor.getMarkdown()).toContain('"a"b"');
    expect(editor.getMarkdown()).not.toContain('\\"');

    editor.replaceMarkdown('![image](https://example.com/image.png "a\\"b")');
    expect(editor.getMarkdown()).toContain('"a"b"');
    expect(editor.getMarkdown()).not.toContain('\\"');
    editor.destroy();
  });

  it("preserves user-authored escapes while rendering the escaped symbol as text", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host);

    for (const symbol of "\\!\"#$%&'()*+,./:;<=>?@[]^_`{|}~-") {
      const escaped = `\\${symbol}`;
      editor.replaceMarkdown(escaped, escaped.length);
      expect(editor.getMarkdown()).toBe(escaped);
      expect(host.querySelector(".live-markdown-escape-hidden")?.textContent).toBe("\\");
    }

    editor.replaceMarkdown("\\>", "\\>".length);
    expect(host.querySelector("blockquote")).toBeNull();
    editor.destroy();
  });

  it("round-trips complete and partially edited callout markers without private syntax", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host, {
      initialContent: "> [!WARNING]\n>\n> Body"
    });

    expect(editor.getMarkdown()).toBe("> [!WARNING]\n>\n> Body");
    expect(host.querySelector("blockquote")?.classList.contains("live-callout")).toBe(true);
    expect(host.querySelector("blockquote > p")?.classList.contains("live-callout-marker")).toBe(true);
    editor.replaceMarkdown("> [!WARNI\n>\n> Body");
    expect(editor.getMarkdown()).toBe("> [!WARNI\n>\n> Body");
    expect(host.querySelector("blockquote")).not.toBeNull();
    expect(host.querySelector("blockquote.live-callout")).toBeNull();
    expect(host.querySelector("blockquote > p.live-callout-marker")).toBeNull();
    expect(editor.getMarkdown()).not.toMatch(/==`|\\\[|\\\]/);
    editor.replaceMarkdown("> [!WARNING]\n>\n> Body");
    expect(host.querySelector("blockquote.live-callout")).not.toBeNull();
    expect(host.querySelector("blockquote > p.live-callout-marker")).not.toBeNull();
    editor.destroy();
  });

  it("decorates an inactive callout marker without changing its Markdown", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "Before\n\n> [!NOTE]\n>\n> Body";
    const editor = createMintEditor(host, { initialContent: markdown });

    expect(host.querySelector("blockquote.live-callout")).not.toBeNull();
    expect(host.querySelector("blockquote > p.live-callout-marker > .live-callout-marker-hidden")?.textContent).toBe("[!NOTE]");
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it("focuses top-level and nested callout markers without changing Markdown", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const markdown = [
      "> [!NOTE] Outer",
      ">",
      "> Body",
      "> > [!WARNING]- Nested",
      "> >",
      "> > Details"
    ].join("\n");
    const editor = createMintEditor(host, {
      initialContent: markdown,
      onChange: (next) => changes.push(next)
    });
    const serialized = editor.getMarkdown();

    expect(focusCalloutMarker(editor, 0, 8)).toBe(true);
    const outerMarker = host.querySelector<HTMLParagraphElement>("blockquote > p.live-callout-marker");
    expect(outerMarker?.classList.contains("is-live-callout-marker-editing")).toBe(true);
    expect(outerMarker?.dataset.calloutPrefix).toBe("> ");
    expect(document.getSelection()?.anchorOffset).toBe(8);
    expect(editor.getMarkdown()).toBe(serialized);
    expect(changes).toEqual([]);

    expect(focusCalloutMarker(editor, 1, 999)).toBe(true);
    const nestedMarker = host.querySelector<HTMLParagraphElement>("blockquote blockquote > p.live-callout-marker");
    expect(nestedMarker?.classList.contains("is-live-callout-marker-editing")).toBe(true);
    expect(nestedMarker?.dataset.calloutPrefix).toBe("> > ");
    expect(document.getSelection()?.anchorOffset).toBe("[!WARNING]- Nested".length);
    expect(editor.getMarkdown()).toBe(serialized);
    expect(changes).toEqual([]);

    expect(focusCalloutMarker(editor, -1)).toBe(false);
    expect(focusCalloutMarker(editor, 2)).toBe(false);
    editor.destroy();
  });

  it("keeps a canonical callout line free of generated escapes", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createMintEditor(host, {
      onChange: (markdown) => changes.push(markdown)
    });

    editor.replaceMarkdown("> [!NOTE]", "> [!NOTE]".length);

    expect(editor.getMarkdown()).toBe("> [!NOTE]");
    expect(changes.at(-1)).toBe("> [!NOTE]");
    expect(host.querySelector("blockquote")?.textContent).toBe("[!NOTE]");
    expect(editor.getMarkdown()).not.toMatch(/==`|\\>|\\\[|\\\]/);
    editor.destroy();
  });

  it("keeps a trailing title space and custom title visible while the marker is edited", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host, { initialContent: "> [!TIP]" });
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    const markerParagraph = host.querySelector<HTMLParagraphElement>("blockquote > p");
    if (!editable || !markerParagraph) throw new Error("Missing callout marker");

    markerParagraph.textContent = "[!TIP] ";
    const range = document.createRange();
    range.selectNodeContents(markerParagraph);
    range.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    editable.dispatchEvent(new InputEvent("input", {
      inputType: "insertText",
      data: " ",
      bubbles: true
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editor.getMarkdown()).toBe("> [!TIP] ");
    expect(host.querySelector(".live-callout-marker-hidden")).toBeNull();
    expect(host.querySelector("blockquote > p")?.textContent).toBe("[!TIP] ");

    const editedParagraph = host.querySelector<HTMLParagraphElement>("blockquote > p");
    if (!editedParagraph) throw new Error("Missing edited callout marker");
    editedParagraph.textContent = "[!TIP] Custom title";
    range.selectNodeContents(editedParagraph);
    range.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    editable.dispatchEvent(new InputEvent("input", {
      inputType: "insertText",
      data: "Custom title",
      bubbles: true
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editor.getMarkdown()).toBe("> [!TIP] Custom title");
    expect(host.querySelector(".live-callout-marker-hidden")).toBeNull();
    expect(host.querySelector("blockquote > p")?.textContent).toBe("[!TIP] Custom title");
    editor.destroy();
  });

  it("undoes an incomplete marker and then restores its empty callout body", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host, {
      initialContent: "> [!CAUTION]\n>\n> \u2060"
    });

    editor.replaceMarkdown("> [!CAUTION]", "> [!CAUTION]".length);
    editor.replaceMarkdown("> [!CAUTION", "> [!CAUTION".length);

    expect(editor.getMarkdown()).toBe("> [!CAUTION");
    expect(host.querySelector("blockquote")).not.toBeNull();
    expect(host.querySelector("blockquote.live-callout")).toBeNull();

    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    editable?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    }));

    expect(editor.getMarkdown()).toBe("> [!CAUTION]");
    expect(host.querySelector("blockquote.live-callout")).not.toBeNull();

    editable?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    }));

    expect(editor.getMarkdown()).toBe("> [!CAUTION]\n>\n> \u2060");
    editor.destroy();
  });

  it("renders math, Mermaid, and WikiLinks as reversible live decorations", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const wikiLinks: string[] = [];
    const markdown = [
      "Before $x_i$ and [[Guide|the guide]].",
      "",
      "$$E = mc^2$$",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```"
    ].join("\n");
    const editor = createMintEditor(host, {
      initialContent: markdown,
      richSyntax: {
        renderMath: (container, source) => { container.textContent = `inline:${source}`; },
        renderMathBlock: (container, source) => { container.textContent = `block:${source}`; },
        renderMermaid: (container, source) => { container.textContent = `diagram:${source}`; },
        onWikiLink: (target) => wikiLinks.push(target)
      }
    });

    expect(host.querySelector(".live-inline-math-widget")?.textContent).toBe("inline:x_i");
    expect(host.querySelector(".live-math-block-widget")?.textContent).toBe("block:E = mc^2");
    expect(host.querySelector(".live-mermaid-widget")?.textContent).toContain("diagram:graph TD");
    const wikiLink = host.querySelector<HTMLButtonElement>(".live-wikilink");
    expect(wikiLink?.textContent).toBe("the guide");
    wikiLink?.click();
    expect(wikiLinks).toEqual(["Guide"]);
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });
});
