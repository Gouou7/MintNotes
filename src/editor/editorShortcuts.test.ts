import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type Editor } from "./core/lib";
import { editingShortcut } from "./core/editing-shortcuts";
import { createCalloutExtension } from "./extensions/callout";
import { createMathExtension } from "./extensions/math";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup(source: string, platform: string, sourceMode: boolean) {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  const host = document.createElement("div");
  document.body.append(host);
  const changes: string[] = [];
  const editor = createEditor(host, { initialContent: source,
    extensions: [createCalloutExtension(), createMathExtension()], onChange: (next) => changes.push(next) });
  editors.push(editor);
  editor.setSourceMode(sourceMode);
  editor.focus();
  const live = host.querySelector<HTMLElement>(".ProseMirror")!;
  const textarea = host.querySelector<HTMLTextAreaElement>("textarea")!;
  const surface = () => editor.isSourceMode() ? textarea : live;
  const key = (letter: string, extra: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key: letter, code: `Key${letter.toUpperCase()}`,
      ...(/Mac/.test(platform) ? { metaKey: true } : { ctrlKey: true }),
      bubbles: true, cancelable: true, ...extra });
    surface().dispatchEvent(event);
    return event;
  };
  const clipboard = (type: "copy" | "cut" | "paste", text = "") => {
    const data = new Map([["text/plain", text]]);
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: {
      types: ["text/plain"], getData: (type: string) => data.get(type) ?? "",
      setData: (type: string, value: string) => data.set(type, value),
    } });
    surface().dispatchEvent(event);
    return { event, text: data.get("text/plain") };
  };
  return { editor, host, live, textarea, surface, changes, key, clipboard };
}

const table = "| A | B |\r\n| --- | --- |\r\n| one | two |";
const sources = [
  "", " \t\r\n\r\n", "\n已有内容\n\n", "#  标题 ##\r\n\r\n07) **项目**  \t\r\n",
  ">\r\n\r\n后文", "> - **嵌套**\n>\n> 第二行", "```text\r\n- raw\r\n```\r\n",
  "![image](https://example.test/image.png)\n", "---\ntitle: example\n---\n\nbody",
  "> [!note]- 提示\n> 正文", "$$\nx^2\n$$", table, `${table}\r\n`,
  `before\n\n${table}\n\nafter`,
];

describe.each(["Win32", "MacIntel"])("editing shortcuts on %s", (platform) => {
  describe.each([false, true])("source mode %s", (sourceMode) => {
    it.each(sources)("selects and copies the entire authored source %j without editing", (source) => {
      const { editor, key, clipboard, changes } = setup(source, platform, sourceMode);
      editor.setSelectionOffset(Math.floor(source.length / 2));
      expect(key("a").defaultPrevented).toBe(true);
      expect(editor.getSelection()).toEqual({ anchor: 0, head: source.length });
      expect(key("c").defaultPrevented).toBe(false);
      if (source) expect(clipboard("copy").text).toBe(source);
      key("a");
      key("z");
      expect(editor.getMarkdown()).toBe(source);
      expect(changes).toEqual([]);
    });

    it("cuts exactly the selected source and restores its direction with one undo", () => {
      const source = "before\r\n#  标题 ##\r\n\r\nafter";
      const { editor, key, clipboard, changes } = setup(source, platform, sourceMode);
      const selection = { anchor: source.indexOf("after"), head: source.indexOf("#") };
      editor.setSelection(selection);
      expect(key("x").defaultPrevented).toBe(false);
      expect(clipboard("cut").text).toBe(source.slice(selection.head, selection.anchor));
      const cut = source.slice(0, selection.head) + source.slice(selection.anchor);
      expect(editor.getMarkdown()).toBe(cut);
      expect(changes).toEqual([cut]);
      expect(key("z").defaultPrevented).toBe(true);
      expect(editor.getMarkdown()).toBe(source);
      expect(editor.getSelection()).toEqual(selection);
      key("Z", { shiftKey: true });
      expect(editor.getMarkdown()).toBe(cut);
      key("z");
      key("y");
      expect(editor.getMarkdown()).toBe(cut);
    });

    it("replaces all selected text by verbatim paste and restores both text and selection", () => {
      const source = "#  旧文 ##\r\n\r\n- item\r\n";
      const pasted = "new  \r\n\r\n\t- **原样**\rfinal";
      const { editor, key, clipboard, changes } = setup(source, platform, sourceMode);
      key("a");
      expect(key("v").defaultPrevented).toBe(false);
      expect(clipboard("paste", pasted).event.defaultPrevented).toBe(true);
      expect(editor.getMarkdown()).toBe(pasted);
      expect(changes).toEqual([pasted]);
      key("z");
      expect(editor.getMarkdown()).toBe(source);
      expect(editor.getSelection()).toEqual({ anchor: 0, head: source.length });
      key("z", { shiftKey: true });
      expect(editor.getMarkdown()).toBe(pasted);
    });

    it("does not cut a collapsed selection or add history for an empty paste", () => {
      const { editor, key, clipboard, changes } = setup("原文", platform, sourceMode);
      editor.setSelectionOffset(1);
      key("x");
      expect(clipboard("cut").text).toBe("");
      key("a");
      key("v");
      clipboard("paste", "");
      key("z");
      expect(editor.getMarkdown()).toBe("原文");
      expect(changes).toEqual([]);
    });

    it("shares history across mode switches and clears redo after a new edit", () => {
      const { editor, key, clipboard } = setup("original", platform, sourceMode);
      key("a");
      clipboard("paste", "first");
      editor.setSourceMode(!sourceMode);
      key("z");
      expect(editor.getMarkdown()).toBe("original");
      key("z", { shiftKey: true });
      expect(editor.getMarkdown()).toBe("first");
      key("z");
      clipboard("paste", "second");
      key("y");
      expect(editor.getMarkdown()).toBe("second");
    });

    it("leaves unrelated focus and alternative modifier chords alone", () => {
      const { editor, key, changes } = setup("原文", platform, sourceMode);
      editor.setSelectionOffset(1);
      for (const extra of [{ altKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 },
        /Mac/.test(platform) ? { ctrlKey: true, metaKey: false } : { metaKey: true, ctrlKey: false }]) {
        expect(key("a", extra).defaultPrevented).toBe(false);
        expect(editor.getSelection()).toEqual({ anchor: 1, head: 1 });
      }
      const input = document.createElement("input");
      document.body.append(input);
      input.focus();
      const event = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, metaKey: true,
        bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(changes).toEqual([]);
    });

    it("accepts physical shortcut codes on a non-Latin layout", () => {
      const { editor, key, clipboard } = setup("原文", platform, sourceMode);
      expect(key("ф", { code: "KeyA" }).defaultPrevented).toBe(true);
      clipboard("paste", "new");
      expect(key("я", { code: "KeyZ" }).defaultPrevented).toBe(true);
      expect(editor.getMarkdown()).toBe("原文");
    });

    it("leaves genuine active IME composition to the platform", () => {
      const { editor, surface, key, changes } = setup("原文", platform, sourceMode);
      surface().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      for (const letter of ["a", "z", "y", "c", "x", "v"]) expect(key(letter).defaultPrevented).toBe(false);
      expect(editor.getMarkdown()).toBe("原文");
      expect(changes).toEqual([]);
    });
  });

  it("commits an ended live composition before immediate select-all and undo", () => {
    const { editor, live, key, changes } = setup("原文", platform, false);
    editor.setSelectionOffset(0);
    live.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const end = new CompositionEvent("compositionend", { bubbles: true });
    Object.defineProperty(end, "data", { value: "新" });
    live.dispatchEvent(end);
    expect(key("a").defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("新原文");
    expect(editor.getSelection()).toEqual({ anchor: 0, head: 3 });
    key("z");
    expect(editor.getMarkdown()).toBe("原文");
    expect(changes).toEqual(["新原文", "原文"]);
  });

  it("commits an ended source composition before immediate select-all and undo", () => {
    const { editor, textarea, key, changes } = setup("原文", platform, true);
    editor.setSelectionOffset(0);
    textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    textarea.value = "新原文";
    textarea.setSelectionRange(1, 1);
    textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    expect(key("a").defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("新原文");
    expect(editor.getSelection()).toEqual({ anchor: 0, head: 3 });
    key("z");
    expect(editor.getMarkdown()).toBe("原文");
    expect(changes).toEqual(["新原文", "原文"]);
  });

  it("preserves a complete range crossing a table before cutting from source", () => {
    const source = `before\n\n${table}\n\nafter`;
    const { editor, key, clipboard, changes } = setup(source, platform, false);
    key("a");
    expect(editor.isSourceMode()).toBe(false);
    expect(clipboard("cut", "previous clipboard").text).toBe("previous clipboard");
    expect(editor.isSourceMode()).toBe(true);
    expect(editor.getSelection()).toEqual({ anchor: 0, head: source.length });
    expect(editor.getMarkdown()).toBe(source);
    expect(changes).toEqual([]);
    expect(clipboard("cut").text).toBe(source);
    expect(editor.getMarkdown()).toBe("");
    key("z");
    expect(editor.getMarkdown()).toBe(source);
  });

  it("uses an editable source selection when a theme hides a selection endpoint", () => {
    const source = "# hidden\n\nbody";
    const { editor, live, key, clipboard, changes } = setup(source, platform, false);
    live.querySelector("h1")!.style.display = "none";
    key("a");
    expect(editor.isSourceMode()).toBe(true);
    expect(editor.getSelection()).toEqual({ anchor: 0, head: source.length });
    expect(clipboard("copy").text).toBe(source);
    expect(changes).toEqual([]);
    clipboard("paste", "new");
    expect(editor.getMarkdown()).toBe("new");
    key("z");
    expect(editor.getMarkdown()).toBe(source);
  });

  it("keeps ordinary single-cell cut on the rich editing path", () => {
    const { editor, clipboard, key } = setup(table, platform, false);
    const from = table.indexOf("one");
    editor.setSelection({ anchor: from, head: from + 3 });
    expect(clipboard("cut").text).toBe("one");
    expect(editor.isSourceMode()).toBe(false);
    expect(editor.getMarkdown()).toBe(table.replace("one", ""));
    key("z");
    expect(editor.getMarkdown()).toBe(table);
  });

  it("uses the pending DOM selection when a cut crosses cells before selectionchange", () => {
    const source = `before\n\n${table}\n\nafter`;
    const { editor, live, clipboard, changes } = setup(source, platform, false);
    editor.setSelectionOffset(1);
    const cells = live.querySelectorAll("td");
    const text = (cell: Element) => {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      return walker.nextNode()!;
    };
    const first = text(cells[0]!);
    const last = text(cells[1]!);
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.textContent!.length);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    const expected = { anchor: table.indexOf("one") + 8, head: table.indexOf("two") + 11 };
    clipboard("cut");
    expect(editor.isSourceMode()).toBe(true);
    expect(editor.getSelection()).toEqual(expected);
    expect(editor.getMarkdown()).toBe(source);
    expect(changes).toEqual([]);
    expect(clipboard("cut").text).toBe(source.slice(expected.anchor, expected.head));
  });
});

describe("shortcut policy", () => {
  it("uses a layout's Latin key before its physical code and rejects AltGraph", () => {
    expect(editingShortcut(new KeyboardEvent("keydown", { key: "q", code: "KeyA", ctrlKey: true }), "Linux")).toBeNull();
    const event = new KeyboardEvent("keydown", { key: "a", ctrlKey: true });
    vi.spyOn(event, "getModifierState").mockImplementation((modifier) => modifier === "AltGraph");
    expect(editingShortcut(event, "Linux")).toBeNull();
  });
});

describe("native replacement of a complete source selection", () => {
  it.each(["\n", "\r\n", "\r"].flatMap((ending) => [false, true].map((backwards) => ({ ending, backwards }))))(
    "includes selected hidden $ending atoms omitted from the browser target (backwards=$backwards)", ({ ending, backwards }) => {
      const source = `before${ending}${ending}# 标题${ending}`;
      const { editor, live, key, changes } = setup(source, "Win32", false);
      key("a");
      const selection = backwards ? { anchor: source.length, head: 0 } : { anchor: 0, head: source.length };
      editor.setSelection(selection);
      const native = document.getSelection()!.getRangeAt(0);
      const target = { startContainer: native.startContainer, startOffset: native.startOffset,
        endContainer: live.querySelector("pre[data-source-gap]:last-child")!, endOffset: 0 };
      const event = new InputEvent("beforeinput", { inputType: "insertText", data: "new", bubbles: true, cancelable: true });
      Object.defineProperty(event, "getTargetRanges", { value: () => [target] });
      live.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(editor.getMarkdown()).toBe("new");
      expect(changes).toEqual(["new"]);
      key("z");
      expect(editor.getMarkdown()).toBe(source);
      expect(editor.getSelection()).toEqual(selection);
    },
  );

  it.each(["insertText", "insertReplacementText"])("preserves an explicit %s target that differs by actual text", (inputType) => {
    const { editor, live, key } = setup("before after\n", "Win32", false);
    key("a");
    const text = live.querySelector("p")!.firstChild!;
    const target = { startContainer: text, startOffset: 0, endContainer: text, endOffset: 6 };
    const event = new InputEvent("beforeinput", { inputType, data: "new", bubbles: true, cancelable: true });
    Object.defineProperty(event, "getTargetRanges", { value: () => [target] });
    live.dispatchEvent(event);
    expect(editor.getMarkdown()).toBe("new after\n");
  });
});
