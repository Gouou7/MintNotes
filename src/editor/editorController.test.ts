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
  it("refreshes a pending image source without changing Markdown or the caret", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const attachmentSource = "webmd-attachment:11111111-1111-4111-8111-111111111111";
    const markdown = `before ![image](${attachmentSource}) after`;
    const displaySource = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
    let resolvedSource: string | null | undefined = null;
    const editor = createMintEditor(host, {
      initialContent: markdown,
      resolveImageSource: (source) => source === attachmentSource ? resolvedSource : undefined,
    });

    editor.setSelectionOffset(markdown.length);
    const initialOffset = editor.getSelectionOffset();
    expect(host.querySelector("img.image-render")?.hasAttribute("src")).toBe(false);

    resolvedSource = displaySource;
    editor.refreshPresentation();

    expect(host.querySelector("img.image-render")?.getAttribute("src")).toBe(displaySource);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(editor.getSelectionOffset()).toBe(initialOffset);
    editor.destroy();
  });

  it("refreshes a blockquote preview without changing source or selection", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "> [!NOTE]\n> Body";
    let renderCount = 0;
    const editor = createEditor(host, {
      initialContent: markdown,
      extensions: [createCalloutExtension({
        renderBlockquotePreview: (container, source) => {
          renderCount += 1;
          container.textContent = source;
        },
      })],
    });

    expect(focusCalloutMarker(editor, 0, 3)).toBe(true);
    const offset = editor.getSelectionOffset();
    editor.refreshPresentation();

    expect(renderCount).toBe(2);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(editor.getSelectionOffset()).toBe(offset);
    editor.destroy();
  });

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
    expect(bareHost.querySelector(".source-blockquote-node.live-callout")).toBeNull();
    bareEditor.destroy();

    const extendedHost = document.createElement("div");
    document.body.append(extendedHost);
    const extendedEditor = createMintEditor(extendedHost, { initialContent: markdown });

    expect(extendedHost.querySelector(".source-blockquote-node.live-callout")).not.toBeNull();
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
    expect(host.querySelector(".source-blockquote-node.is-source-editing")).not.toBeNull();
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe(">\n>");
    expect(editor.getMarkdown()).toBe(">\n>");
    expect(changes.at(-1)).toBe(">\n>");
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
    expect(editor.getMarkdown()).toContain("a &#124; b");
    expect(editor.getMarkdown()).not.toContain("\\|");

    editor.replaceMarkdown('[link](https://example.com "a\\"b")');
    expect(editor.getMarkdown()).toContain('"a\\"b"');

    editor.replaceMarkdown('![image](https://example.com/image.png "a\\"b")');
    expect(editor.getMarkdown()).toContain('"a\\"b"');
    editor.destroy();
  });

  it("keeps unedited authored spellings through a real Live transaction", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = [
      "| Left | Right |",
      "| --- | --- |",
      "| a &#124; b | value |",
      "",
      "after"
    ].join("\n");
    const editor = createMintEditor(host, { initialContent: markdown });
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    const paragraph = editable?.lastElementChild as HTMLElement | null;
    if (!editable || !paragraph || paragraph.tagName !== "P") throw new Error("Missing paragraph after table");
    paragraph.textContent = "later";
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    editable.dispatchEvent(new InputEvent("input", {
      inputType: "insertText",
      data: "later",
      bubbles: true
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.getMarkdown()).toContain("a &#124; b");
    expect(editor.getMarkdown()).toContain("later");
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
    expect(host.querySelector(".source-blockquote-node.live-callout")).not.toBeNull();
    expect(host.querySelector(".source-blockquote-preview")?.hasAttribute("hidden")).toBe(false);
    editor.replaceMarkdown("> [!WARNI\n>\n> Body");
    expect(editor.getMarkdown()).toBe("> [!WARNI\n>\n> Body");
    expect(host.querySelector("blockquote")).not.toBeNull();
    expect(host.querySelector(".source-blockquote-node.live-callout")).toBeNull();
    expect(editor.getMarkdown()).not.toMatch(/==`|\\\[|\\\]/);
    editor.replaceMarkdown("> [!WARNING]\n>\n> Body");
    expect(host.querySelector(".source-blockquote-node.live-callout")).not.toBeNull();
    editor.destroy();
  });

  it("keeps an inactive callout as presentation over unchanged authored source", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "Before\n\n> [!NOTE]\n>\n> Body";
    const editor = createMintEditor(host, { initialContent: markdown });

    expect(host.querySelector(".source-blockquote-node.live-callout")).not.toBeNull();
    expect(host.querySelector(".source-blockquote-preview .markdown-callout")?.textContent).toContain("Note");
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe("> [!NOTE]\n>\n> Body");
    expect(host.querySelector(".source-blockquote-source")?.hasAttribute("hidden")).toBe(true);
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it("reveals a two-line Callout without merging its authored lines", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const markdown = "> [!NOTE] \n> Note callout";
    const editor = createMintEditor(host, {
      initialContent: markdown,
      onChange: (next) => changes.push(next),
    });
    const preview = host.querySelector<HTMLElement>(".source-blockquote-preview");
    if (!preview) throw new Error("Missing Callout preview");

    preview.dispatchEvent(new MouseEvent("mousedown", {
      button: 0,
      bubbles: true,
      cancelable: true,
    }));

    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe(markdown);
    expect(host.querySelector(".source-blockquote-source")?.hasAttribute("hidden")).toBe(false);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);
    editor.destroy();
  });

  it("reveals a source-backed quote when keyboard focus lands inside it", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const markdown = "> Keyboard editable";
    const editor = createMintEditor(host, {
      initialContent: markdown,
      onChange: (next) => changes.push(next),
    });
    const surface = host.querySelector<HTMLElement>(".ProseMirror");

    expect(host.querySelector(".source-blockquote-source")?.hasAttribute("hidden")).toBe(true);
    surface?.dispatchEvent(new FocusEvent("focus"));

    expect(host.querySelector(".source-blockquote-node.is-source-editing")).not.toBeNull();
    expect(host.querySelector(".source-blockquote-source")?.hasAttribute("hidden")).toBe(false);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);
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
    expect(host.querySelector(".source-blockquote-node.is-source-editing")).not.toBeNull();
    expect(host.querySelector(".source-blockquote-source")?.hasAttribute("hidden")).toBe(false);
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe(markdown);
    expect(editor.getSelectionOffset()).toBe("> ".length + 8);
    expect(editor.getMarkdown()).toBe(serialized);
    expect(changes).toEqual([]);

    expect(focusCalloutMarker(editor, 1, 999)).toBe(true);
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe(markdown);
    expect(editor.getSelectionOffset()).toBe(
      markdown.indexOf("[!WARNING]- Nested") + "[!WARNING]- Nested".length,
    );
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
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe("> [!NOTE]");
    expect(editor.getMarkdown()).not.toMatch(/==`|\\>|\\\[|\\\]/);
    editor.destroy();
  });

  it("edits trailing spaces and titles in the real Callout source", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host, { initialContent: "> [!TIP]" });
    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    expect(focusCalloutMarker(editor, 0)).toBe(true);
    const markerSource = host.querySelector<HTMLElement>(".source-blockquote-source-code");
    if (!editable || !markerSource) throw new Error("Missing callout source");

    markerSource.textContent = "> [!TIP] ";
    const range = document.createRange();
    range.selectNodeContents(markerSource);
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
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe("> [!TIP] ");

    const editedSource = host.querySelector<HTMLElement>(".source-blockquote-source-code");
    if (!editedSource) throw new Error("Missing edited callout source");
    editedSource.textContent = "> [!TIP] Custom title";
    range.selectNodeContents(editedSource);
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
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe("> [!TIP] Custom title");
    editor.destroy();
  });

  it("preserves quote lines when native editing creates block DOM", async () => {
    for (const fixture of [
      {
        initial: "> [!note] \n> \n> callout ",
        dom: "&gt; [!note] <div>&gt; test</div><div>&gt; callout </div>",
        expected: "> [!note] \n> test\n> callout ",
      },
      {
        initial: "> quote\n> \n> tail",
        dom: "&gt; quote<div>&gt; test</div><div>&gt; tail</div>",
        expected: "> quote\n> test\n> tail",
      },
    ]) {
      const host = document.createElement("div");
      document.body.append(host);
      const changes: string[] = [];
      const editor = createMintEditor(host, {
        initialContent: fixture.initial,
        onChange: (next) => changes.push(next),
      });
      const source = host.querySelector<HTMLElement>(".source-blockquote-source-code");
      if (!source) throw new Error("Missing source-backed quote content");

      source.innerHTML = fixture.dom;
      source.dispatchEvent(new InputEvent("input", {
        inputType: "insertText",
        data: "test",
        bubbles: true,
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(editor.getMarkdown()).toBe(fixture.expected);
      expect(changes.at(-1)).toBe(fixture.expected);
      expect(host.querySelector(".source-blockquote-source")?.textContent).toBe(fixture.expected);
      expect(host.querySelector(".source-blockquote-source-code")?.querySelector("div, br")).toBeNull();
      editor.destroy();
      host.remove();
    }
  });

  it("inserts and deletes text on a middle quote line before native DOM mutation", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const initial = "> [!note] \n> \n> callout ";
    const inserted = "> [!note] \n> test\n> callout ";
    const changes: string[] = [];
    const editor = createMintEditor(host, {
      initialContent: initial,
      onChange: (next) => changes.push(next),
    });
    expect(focusCalloutMarker(editor, 0)).toBe(true);

    let source = host.querySelector<HTMLElement>(".source-blockquote-source-code");
    let text = source?.firstChild;
    if (!source || !text) throw new Error("Missing editable quote source");
    const insertAt = initial.indexOf("\n> ") + 3;
    let range = document.createRange();
    range.setStart(text, insertAt);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    const insert = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: "test",
      bubbles: true,
      cancelable: true,
    });

    source.dispatchEvent(insert);

    expect(insert.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe(inserted);
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe(inserted);

    source = host.querySelector<HTMLElement>(".source-blockquote-source-code");
    text = source?.firstChild;
    if (!source || !text) throw new Error("Missing updated quote source");
    const deleteFrom = inserted.indexOf("test");
    range = document.createRange();
    range.setStart(text, deleteFrom + 4);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    for (let index = 0; index < 4; index += 1) {
      source = host.querySelector<HTMLElement>(".source-blockquote-source-code");
      if (!source) throw new Error("Missing quote source while deleting");
      const remove = new InputEvent("beforeinput", {
        inputType: "deleteContentBackward",
        bubbles: true,
        cancelable: true,
      });
      source.dispatchEvent(remove);
      expect(remove.defaultPrevented).toBe(true);
    }

    expect(editor.getMarkdown()).toBe(initial);
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe(initial);
    expect(changes.at(0)).toBe(inserted);
    expect(changes.at(-1)).toBe(initial);
    editor.destroy();
  });

  it("keeps an empty Callout body editable without a private placeholder", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createMintEditor(host, {
      initialContent: "> [!CAUTION]\n> "
    });

    expect(editor.getMarkdown()).toBe("> [!CAUTION]\n> ");
    expect(editor.getMarkdown()).not.toContain("\u2060");
    expect(focusCalloutMarker(editor, 0)).toBe(true);
    expect(host.querySelector(".source-blockquote-source")?.textContent).toBe("> [!CAUTION]\n> ");
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
