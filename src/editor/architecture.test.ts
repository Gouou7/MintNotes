import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type Editor, type EditorOptions } from "./core/lib";
import { createCalloutExtension } from "./extensions/callout";

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); document.body.replaceChildren(); });

function setup(source: string, options: EditorOptions = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onChange = vi.fn();
  const editor = createEditor(host, { initialContent: source, onChange, ...options });
  editors.push(editor);
  editor.focus();
  const live = host.querySelector<HTMLElement>(".ProseMirror")!;
  const textarea = host.querySelector<HTMLTextAreaElement>("textarea")!;
  const surface = () => editor.isSourceMode() ? textarea : live;
  const key = (key: string, extra: KeyboardEventInit = {}) => surface().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
  const input = (text: string) => surface().dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true }));
  const clipboard = (kind: "copy" | "cut" | "paste", text = "") => {
    const data = new Map([["text/plain", text]]);
    const event = new Event(kind, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => data.get(type), setData: (type: string, value: string) => data.set(type, value), files: [], items: [] } });
    surface().dispatchEvent(event);
    return data.get("text/plain");
  };
  const undo = () => key("z", { ctrlKey: true, metaKey: true });
  return { editor, host, live, textarea, onChange, key, input, clipboard, undo };
}

describe("editor architecture acceptance", () => {
  it.each(["😀", "👨‍👩‍👧‍👦", "e\u0301", "🇨🇳", "👍🏽"])("moves and deletes %s as one character with one undo", (character) => {
    const { editor, key, undo } = setup(`a${character}b`);
    editor.setSelectionOffset(1);
    key("ArrowRight");
    expect(editor.getSelectionOffset()).toBe(1 + character.length);
    key("Backspace");
    expect(editor.getMarkdown()).toBe("ab");
    undo();
    expect(editor.getMarkdown()).toBe(`a${character}b`);
    expect(editor.getSelectionOffset()).toBe(1 + character.length);
  });

  it("keeps both selection endpoints and undo across live/source/live", () => {
    const { editor, input, undo } = setup("# title\n\nbody");
    editor.setSelectionOffset(4);
    input("X");
    editor.setSelection({ anchor: 7, head: 2 });
    editor.setSourceMode(true);
    expect(editor.getSelection()).toEqual({ anchor: 7, head: 2 });
    editor.setSourceMode(false);
    expect(editor.getSelection()).toEqual({ anchor: 7, head: 2 });
    undo();
    expect(editor.getMarkdown()).toBe("# title\n\nbody");
  });

  it("records source textarea input in the same source history", () => {
    const { editor, textarea, undo } = setup("a");
    editor.setSourceMode(true);
    textarea.setSelectionRange(1, 1);
    textarea.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "b" }));
    textarea.value = "ab";
    textarea.setSelectionRange(2, 2);
    textarea.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "b" }));
    editor.setSourceMode(false);
    undo();
    expect(editor.getMarkdown()).toBe("a");
  });

  it("preserves original CRLF outside a native source textarea edit", () => {
    const source = "# a\r\n\r\nbody\r\ntail";
    const { editor, textarea, onChange, undo } = setup(source);
    editor.setSelectionOffset(source.indexOf("body") + 2);
    editor.setSourceMode(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.getMarkdownOffsetAtPoint(0, 0)).toBe(source.indexOf("body") + 2);
    expect(textarea.value).toBe(source.replaceAll("\r\n", "\n"));
    const from = textarea.selectionStart;
    textarea.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "X" }));
    textarea.value = textarea.value.slice(0, from) + "X" + textarea.value.slice(from);
    textarea.setSelectionRange(from + 1, from + 1);
    textarea.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "X" }));
    expect(editor.getMarkdown()).toBe(source.replace("body", "boXdy"));
    undo(); expect(editor.getMarkdown()).toBe(source);
  });

  it("copies and cuts exactly the selected heading body and restores both endpoints", () => {
    const { editor, clipboard, undo } = setup("# title\n\nbody");
    editor.setSelection({ anchor: 2, head: 7 });
    expect(clipboard("copy")).toBe("title");
    expect(clipboard("cut")).toBe("title");
    expect(editor.getMarkdown()).toBe("# \n\nbody");
    undo();
    expect(editor.getMarkdown()).toBe("# title\n\nbody");
    expect(editor.getSelection()).toEqual({ anchor: 2, head: 7 });
  });

  it("keeps heading typography and only activates the selected list source line", () => {
    const { editor, host } = setup("# title\n\n- first\n- second");
    editor.setSelectionOffset(3);
    expect(host.querySelector("h1 .syntax-hint")?.textContent).toBe("# ");
    editor.setSelectionOffset(12);
    expect([...host.querySelectorAll("li .syntax-hint")].map((node) => node.textContent)).toEqual(["- "]);
    expect(host.querySelector("pre[data-source-kind=bullet_list]")).toBeNull();
  });

  it("does not expose inactive intermediate syntax units", () => {
    const { editor, host } = setup("a **one** b **two** c **three** z");
    editor.setSelection({ anchor: 4, head: 24 });
    const middle = [...host.querySelectorAll(".syntax-hidden")].filter((node) => node.textContent === "**");
    expect(middle.length).toBeGreaterThanOrEqual(2);
  });

  it.each(["# title", "- item", "> quote", "**bold**"])("pastes raw Markdown into %s without repair", (source) => {
    const { editor, clipboard, undo } = setup(source);
    editor.setSelectionOffset(source.length);
    clipboard("paste", "\r\n\t[broken](\n| a | b");
    expect(editor.getMarkdown()).toBe(source + "\r\n\t[broken](\n| a | b");
    undo();
    expect(editor.getMarkdown()).toBe(source);
  });

  it("edits a repeated table value in place without touching spacing or dividers", () => {
    const source = "| same | same  |\r\n|:-----|-----:|\r\n| same | **same** |";
    const { editor, host, input, undo, key } = setup(source);
    const at = source.lastIndexOf("same") + 2;
    editor.setSelectionOffset(at);
    input("X");
    expect(editor.getMarkdown()).toBe(source.slice(0, at) + "X" + source.slice(at));
    expect(host.querySelector("table")).not.toBeNull();
    expect(host.querySelector("pre[data-source-kind=table]")).toBeNull();
    key("Tab");
    undo();
    expect(editor.getMarkdown()).toBe(source);
  });

  it("keeps a table editable inside a Callout", () => {
    const source = "> [!note]\n>\n> | a | b |\n> | --- | --- |\n> | c | d |";
    const { editor, host, input, undo } = setup(source, { extensions: [createCalloutExtension()] });
    const at = source.lastIndexOf("d");
    editor.setSelectionOffset(at);
    input("X");
    expect(editor.getMarkdown()).toBe(source.slice(0, at) + "X" + source.slice(at));
    expect(host.querySelector("table")).not.toBeNull();
    undo();
    expect(editor.getMarkdown()).toBe(source);
  });

  it("uses cell boundaries for navigation and deletion", () => {
    const source = "| a | b |\n| --- | --- |\n| c | d |\n\nafter";
    const { editor, key } = setup(source);
    editor.setSelectionOffset(source.indexOf("a") + 1);
    key("ArrowRight");
    expect(editor.getSelectionOffset()).toBe(source.indexOf("b"));
    key("Backspace");
    expect(editor.getMarkdown()).toBe(source);
    key("Enter");
    expect(editor.getSelectionOffset()).toBe(source.indexOf("d"));
  });

  it("does not move into unmapped table structure at the document edge", () => {
    const source = "| a | b |\n| --- | --- |\n| c | d |";
    const { editor, key } = setup(source);
    const at = source.indexOf("d") + 1;
    editor.setSelectionOffset(at);
    key("Tab"); expect(editor.getSelectionOffset()).toBe(at);
    expect(editor.isSourceMode()).toBe(false);
    expect(editor.getMarkdown()).toBe(source);
  });

  it("adds and deletes table rows through complete source undo operations", () => {
    const source = "> [!note]\r\n>\r\n> | a | b |\r\n> | :--- | ---: |\r\n> | c | d |";
    const { editor, key, host, undo } = setup(source);
    editor.setSelectionOffset(source.indexOf("d"));
    key("Enter", { ctrlKey: true, metaKey: true });
    expect(editor.getMarkdown()).toBe(source + "\r\n> | | |");
    expect(host.querySelectorAll("table tr")).toHaveLength(3);
    undo(); expect(editor.getMarkdown()).toBe(source);
    editor.setSelectionOffset(source.indexOf("d"));
    key("Backspace", { ctrlKey: true, metaKey: true, shiftKey: true });
    expect(editor.getMarkdown()).toBe(source.slice(0, source.lastIndexOf("\r\n")));
    undo(); expect(editor.getMarkdown()).toBe(source);
  });

  it("preserves the image while revealing source at either boundary and on click", () => {
    const source = "before\n\n![alt](image.png)\n\nafter";
    const { editor, host } = setup(source);
    editor.setSelectionOffset(source.length);
    host.querySelector("img")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(editor.getSelectionOffset()).toBe(source.indexOf("!["));
    expect(host.querySelector("img")).not.toBeNull();
    for (const offset of [source.indexOf("!["), source.indexOf(")") + 1]) {
      editor.setSelectionOffset(offset);
      expect(host.querySelector(".syntax-hidden")?.textContent).not.toBe("![alt](image.png)");
    }
  });

  it("defers source mode until source composition finishes and commits once", async () => {
    const { editor, textarea, onChange, undo } = setup("a");
    editor.setSourceMode(true);
    textarea.setSelectionRange(1, 1);
    textarea.dispatchEvent(new CompositionEvent("compositionstart"));
    textarea.value = "a中";
    textarea.dispatchEvent(new InputEvent("input", { isComposing: true }));
    editor.setSourceMode(false);
    expect(editor.isSourceMode()).toBe(true);
    textarea.value = "a中文";
    textarea.setSelectionRange(3, 3);
    textarea.dispatchEvent(new CompositionEvent("compositionend"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(editor.isSourceMode()).toBe(false);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("a中文");
    undo();
    expect(editor.getMarkdown()).toBe("a");
  });
});
