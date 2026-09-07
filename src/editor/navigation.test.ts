import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "prosemirror-view";
import { createEditor, type Editor } from "./core/lib";
import { createCalloutExtension } from "./extensions/callout";
import { createCommentExtension } from "./extensions/comment";
import { createMathExtension } from "./extensions/math";
import { createMermaidExtension } from "./extensions/mermaid";
import { createWikiLinkExtension } from "./extensions/wikilink";

const editors: Editor[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.replaceChildren();
});

function setup(source: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const onChange = vi.fn();
  const render = (container: HTMLElement, text: string) => { container.textContent = text; };
  const editor = createEditor(host, {
    initialContent: source,
    onChange,
    extensions: [
      createCalloutExtension(), createCommentExtension(), createWikiLinkExtension(),
      createMathExtension({ renderInline: render, renderBlock: render }),
      createMermaidExtension({ render }),
    ],
  });
  editors.push(editor);
  editor.focus();
  const live = host.querySelector<HTMLElement>(".ProseMirror")!;
  const key = (key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
    live.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { editor, live, onChange, key };
}

const styledBlocks = [
  ["ATX heading", "### abcdefghij"],
  ["Setext heading", "abcdefghij\n=========="],
  ["quote", "> abcdefghij\n> second"],
  ["Callout", "> [!NOTE]\n> abcdefghij\n> second"],
  ["nested quote", "> > abcdefghij\n> > second"],
  ["bullet list", "- abcdefghij\n- second"],
  ["ordered list", "1. abcdefghij\n2. second"],
  ["task list", "- [ ] abcdefghij\n- [x] second"],
  ["nested list", "- outer\n  - abcdefghij\n  - second"],
  ["fenced code", "```ts\nabcdefghij\nsecond\n```"],
  ["indented code", "    abcdefghij\n    second"],
  ["block math", "$$\nabcdefghij\nsecond\n$$"],
  ["Mermaid", "```mermaid\nabcdefghij\nsecond\n```"],
  ["image", "![abcdefghij](attachment:example)"],
  ["inline styles", "**abcdefghij** *em* ~~del~~ ==mark== `code` $math$ [link](url) [[wiki]] %%comment%%"],
] as const;

describe("styled container arrow navigation", () => {
  it.each(styledBlocks)("walks both directions through every source boundary of %s", (_name, block) => {
    const source = `before\n\n${block}\n\nafter`;
    const { editor, onChange, key } = setup(source);
    editor.setSelectionOffset(0);
    for (let head = 1; head <= source.length; head++) {
      key("ArrowRight");
      expect(editor.getSelection()).toEqual({ anchor: head, head });
    }
    for (let head = source.length - 1; head >= 0; head--) {
      key("ArrowLeft");
      expect(editor.getSelection()).toEqual({ anchor: head, head });
    }
    expect(editor.isSourceMode()).toBe(false);
    expect(editor.getMarkdown()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ...styledBlocks,
    ["Front Matter", "---\ntitle: abcdefghij\n---"],
    ["table", "| abcdefghij | other |\n| --- | --- |\n| second | last |"],
    ["Callout table", "> [!NOTE]\n> | abcdefghij | other |\n> | --- | --- |\n> | second | last |"],
  ] as const)("leaves wrapped visual lines in %s to native up/down navigation", (_name, source) => {
    const { editor, onChange, key } = setup(source);
    const offset = source.indexOf("abcdefghij") + 5;
    editor.setSelectionOffset(offset);
    // Emulate three visual rows within the selected authored line. Happy DOM
    // cannot move a native caret, so assert the key is released to the browser.
    vi.spyOn(EditorView.prototype, "coordsAtPos").mockImplementation(function (this: EditorView, pos) {
      const top = pos < this.state.selection.head ? 0 : pos > this.state.selection.head ? 40 : 20;
      return { top, bottom: top + 20, left: 0, right: 0 };
    });
    for (const direction of ["ArrowUp", "ArrowDown"]) {
      expect(key(direction)).toBe(false);
      expect(editor.getSelectionOffset()).toBe(offset);
    }
    expect(editor.getMarkdown()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps table boundary navigation and Shift selection after the last visual row", () => {
    const source = "| abcdefghij | other |\n| --- | --- |\n| second | last |";
    const { editor, key, onChange } = setup(source);
    const start = source.indexOf("abcdefghij") + 2;
    editor.setSelectionOffset(start);
    vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({ top: 0, bottom: 20, left: 0, right: 0 });
    expect(key("ArrowDown", { shiftKey: true })).toBe(true);
    expect(editor.getSelection()).toEqual({ anchor: start, head: source.indexOf("second") + 2 });
    expect(editor.getMarkdown()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ["Callout", "> [!NOTE]\n> first\n> a much longer second line"],
    ["code", "```\nfirst\na much longer second line\n```"],
    ["math", "$$\nfirst\na much longer second line\n$$"],
  ])("uses native movement across authored lines in %s as well as soft wraps", (_name, source) => {
    const { editor, key } = setup(source);
    const head = source.indexOf("first") + "first".length;
    editor.setSelectionOffset(head);
    vi.spyOn(EditorView.prototype, "coordsAtPos").mockImplementation(function (this: EditorView, pos) {
      // Current authored line ends here; the following authored line has room
      // for native movement. Do not force its caret to a source column.
      const top = pos <= this.state.selection.head ? 0 : 20;
      return { top, bottom: top + 20, left: 0, right: 0 };
    });
    expect(key("ArrowDown")).toBe(false);
    expect(editor.getSelectionOffset()).toBe(head);
  });

  it("still enters the closing code fence at its stable source edge", () => {
    const source = "```\nlast body row\n```";
    const { editor, key, onChange } = setup(source);
    editor.setSelectionOffset(source.indexOf("body") + 2);
    vi.spyOn(EditorView.prototype, "coordsAtPos").mockImplementation(function (this: EditorView, pos) {
      const closingFrom = this.state.selection.$head.end() - 3;
      const top = pos >= closingFrom ? 20 : 0;
      return { top, bottom: top + 20, left: 0, right: 0 };
    });
    expect(key("ArrowDown")).toBe(true);
    expect(editor.getSelectionOffset()).toBe(source.length);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not replace native table range collapse with a row jump", () => {
    const source = "| abcdefghij | other |\n| --- | --- |\n| second | last |";
    const { editor, key } = setup(source);
    const selection = { anchor: source.indexOf("abcdef"), head: source.indexOf("abcdef") + 4 };
    editor.setSelection(selection);
    expect(key("ArrowDown")).toBe(false);
    expect(editor.getSelection()).toEqual(selection);
  });

  it.each(["```\ncode\n```", "```\n```", "```\nunclosed", "```mermaid\ngraph TD\n```"])(
    "does not create a projected paragraph or undo entry at the end of %s", (source) => {
      const { editor, live, key, onChange } = setup(source);
      editor.setSelectionOffset(source.length);
      const childCount = live.childElementCount;
      for (let attempt = 0; attempt < 3; attempt++) key("ArrowDown");
      expect(live.childElementCount).toBe(childCount);
      expect(editor.getSelectionOffset()).toBe(source.length);
      key("z", { ctrlKey: true, metaKey: true });
      expect(editor.getMarkdown()).toBe(source);
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it.each(["> [!NOTE]\n> first\n> second", "```\nfirst\nsecond\n```", "before\n\n\nfirst\n\nsecond"])("leaves modified and composing arrows to the platform in %s", (source) => {
    const { editor, key, onChange } = setup(source);
    const head = source.indexOf("first") + 2;
    editor.setSelectionOffset(head);
    for (const options of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }]) {
      key("ArrowDown", options);
      expect(editor.getSelectionOffset()).toBe(head);
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("preserves the preceding edit and its undo selection after container navigation", () => {
    const source = "> [!NOTE]\n> first\n> second\n\nafter";
    const { editor, key, onChange } = setup(source);
    const head = source.indexOf("first") + 2;
    editor.setSelectionOffset(head);
    editor.insertMarkdown("X", head);
    key("ArrowDown");
    key("ArrowUp");
    key("ArrowLeft");
    key("ArrowRight");
    expect(onChange).toHaveBeenCalledTimes(1);
    key("z", { ctrlKey: true, metaKey: true });
    expect(editor.getMarkdown()).toBe(source);
    expect(editor.getSelection()).toEqual({ anchor: head, head });
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
