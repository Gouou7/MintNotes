import { afterEach, describe, expect, it } from "vitest";
import { createEditor } from "typora-web";

afterEach(() => {
  document.body.replaceChildren();
});

describe("typora-web public controller", () => {
  it("waits until Enter to turn a line-leading greater-than sign into a blockquote", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createEditor(host, { onChange: (markdown) => changes.push(markdown) });

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
    const editor = createEditor(host);

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
    const editor = createEditor(host);

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
    const editor = createEditor(host, {
      initialContent: "> [!WARNING]\n>\n> Body"
    });

    expect(editor.getMarkdown()).toBe("> [!WARNING]\n>\n> Body");
    expect(host.querySelector("blockquote")?.classList.contains("live-callout")).toBe(true);
    expect(host.querySelector("blockquote > p")?.classList.contains("live-callout-marker")).toBe(true);
    editor.replaceMarkdown("> [!WARNI\n>\n> Body");
    expect(editor.getMarkdown()).toBe("> [!WARNI\n>\n> Body");
    expect(editor.getMarkdown()).not.toMatch(/==`|\\\[|\\\]/);
    editor.destroy();
  });

  it("decorates an inactive callout marker without changing its Markdown", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "Before\n\n> [!NOTE]\n>\n> Body";
    const editor = createEditor(host, { initialContent: markdown });

    expect(host.querySelector("blockquote.live-callout")).not.toBeNull();
    expect(host.querySelector("blockquote > p.live-callout-marker > .live-callout-marker-hidden")?.textContent).toBe("[!NOTE]");
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it("keeps a canonical callout line free of generated escapes", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createEditor(host, {
      onChange: (markdown) => changes.push(markdown)
    });

    editor.replaceMarkdown("> [!NOTE]", "> [!NOTE]".length);

    expect(editor.getMarkdown()).toBe("> [!NOTE]");
    expect(changes.at(-1)).toBe("> [!NOTE]");
    expect(host.querySelector("blockquote")?.textContent).toBe("[!NOTE]");
    expect(editor.getMarkdown()).not.toMatch(/==`|\\>|\\\[|\\\]/);
    editor.destroy();
  });

  it("keeps replaceMarkdown changes in the native undo history", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, {
      initialContent: "Before\n\n> [!WARNING]\n>\n> \u2060\n\nAfter"
    });

    editor.replaceMarkdown("Before\n\nAfter", "Before\n\n".length);
    expect(editor.getMarkdown()).toBe("Before\n\nAfter");

    const editable = host.querySelector<HTMLElement>(".ProseMirror");
    editable?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    }));

    expect(editor.getMarkdown()).toContain("[!WARNING]");
    editor.destroy();
  });
});
