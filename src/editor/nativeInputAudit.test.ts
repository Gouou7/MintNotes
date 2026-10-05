import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "prosemirror-view";
import { createEditor, type Editor } from "./core/lib";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup(source: string, caret = source.length) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: string[] = [];
  const editor = createEditor(host, { initialContent: source, onChange: (next) => changes.push(next) });
  editors.push(editor);
  editor.focus();
  editor.setSelectionOffset(caret);
  const live = host.querySelector<HTMLElement>(".ProseMirror")!;
  const textarea = host.querySelector<HTMLTextAreaElement>("textarea")!;
  return { editor, live, textarea, changes };
}

function beforeInput(surface: HTMLElement, inputType: string, data: string | null = null, range?: StaticRangeInit, cancelable = true) {
  const event = new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable });
  if (range) Object.defineProperty(event, "getTargetRanges", { value: () => [range] });
  surface.dispatchEvent(event);
  return event;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function paste(surface: HTMLElement, types: string[], text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { types, getData: () => text } });
  surface.dispatchEvent(event);
  return event;
}

function compositionEnd(surface: HTMLElement, data: string) {
  const event = new CompositionEvent("compositionend", { bubbles: true });
  Object.defineProperty(event, "data", { value: data });
  surface.dispatchEvent(event);
}

function textTransfer(initial = "") {
  const data = new Map(initial ? [["text/plain", initial]] : []);
  return { files: [], get types() { return Array.from(data.keys()); }, getData: (type: string) => data.get(type) ?? "",
    setData: (type: string, value: string) => { data.set(type, value); }, clearData: () => data.clear() };
}

function drag(surface: HTMLElement, type: string, transfer: ReturnType<typeof textTransfer>) {
  vi.spyOn(EditorView.prototype, "posAtCoords").mockImplementation(function (this: EditorView) {
    return { pos: this.state.selection.head, inside: -1 };
  });
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { dataTransfer: { value: transfer }, clientX: { value: 10 }, clientY: { value: 10 } });
  surface.dispatchEvent(event);
  return event;
}

describe("native input audit", () => {
  it.each(["live", "source"])("uses the canonical history for the %s surface's native undo and redo", (mode) => {
    const { editor, live, textarea, changes } = setup("原文");
    editor.insertMarkdown("新增");
    editor.setSourceMode(mode === "source");
    const surface = mode === "source" ? textarea : live;
    expect(beforeInput(surface, "historyUndo").defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("原文");
    expect(beforeInput(surface, "historyRedo").defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("原文新增");
    expect(changes).toEqual(["原文新增", "原文", "原文新增"]);
  });

  it("replaces the actual DOM selection before its selectionchange reaches the model", () => {
    const { editor, live } = setup("前旧文后");
    const text = live.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 3);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    expect(beforeInput(live, "insertText", "新").defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("前新后");
    expect(editor.getSelectionOffset()).toBe(2);
    beforeInput(live, "historyUndo");
    expect(editor.getMarkdown()).toBe("前旧文后");
    expect(editor.getSelection()).toEqual({ anchor: 1, head: 3 });
  });

  it.each(["deleteWordBackward", "deleteWordForward", "deleteSoftLineBackward", "deleteHardLineForward"])(
    "uses the browser's exact %s target rather than deleting at the caret", (type) => {
      const { editor, live } = setup("one two tail");
      const text = live.querySelector("p")!.firstChild!;
      const range = { startContainer: text, startOffset: 4, endContainer: text, endOffset: 8 };
      expect(beforeInput(live, type, null, range).defaultPrevented).toBe(true);
      expect(editor.getMarkdown()).toBe("one tail");
      expect(editor.getSelectionOffset()).toBe(4);
    },
  );

  it("accepts a noncancelable correction from its target even when native DOM parsing is ambiguous", async () => {
    const { editor, live, changes } = setup("teh\n\nkeep  spacing\t");
    const text = live.querySelector("p")!.firstChild!;
    const target = { startContainer: text, startOffset: 0, endContainer: text, endOffset: 3 };
    beforeInput(live, "insertReplacementText", "the", target, false);
    live.querySelector("p")!.innerHTML = "<div>the</div>";
    live.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: "the" }));
    await tick();
    expect(editor.getMarkdown()).toBe("the\n\nkeep  spacing\t");
    expect(editor.getSelectionOffset()).toBe(3);
    expect(changes).toEqual(["the\n\nkeep  spacing\t"]);
  });

  it("keeps a blank line when a noncancelable native insertion consumes its placeholder", async () => {
    const { editor, live, changes } = setup("\n保留原文", 0);
    const range = document.getSelection()!.getRangeAt(0);
    const target = { startContainer: range.startContainer, startOffset: range.startOffset,
      endContainer: range.endContainer, endOffset: range.endOffset };
    beforeInput(live, "insertText", "字", target, false);
    live.querySelector("[data-source-gap-eol]")!.replaceWith(document.createTextNode("字"));
    live.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "字" }));
    await tick();
    expect(editor.getMarkdown()).toBe("字\n保留原文");
    expect(changes).toEqual(["字\n保留原文"]);
  });

  it("does not split CRLF when the browser's native target skips the invisible CR", () => {
    const { editor, live } = setup("\r\n保留原文", 0);
    const code = live.querySelector("pre[data-source-gap] code")!;
    const target = { startContainer: code, startOffset: 1, endContainer: code, endOffset: 1 };
    expect(beforeInput(live, "insertText", "字", target).defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("字\r\n保留原文");
    expect(editor.getSelectionOffset()).toBe(1);
  });

  it.each(["deleteContentBackward", "deleteContentForward"])("retains a noncancelable %s intent with no target ranges", async (type) => {
    const { editor, live } = setup("ab", 1);
    beforeInput(live, type, null, undefined, false);
    live.querySelector("p")!.textContent = type === "deleteContentBackward" ? "b" : "a";
    live.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: type }));
    await tick();
    expect(editor.getMarkdown()).toBe(type === "deleteContentBackward" ? "b" : "a");
  });

  it("rebuilds the projection when replacement text recreates the original block structure", () => {
    const { editor, live } = setup("one\n\ntwo");
    editor.setSelection({ anchor: 0, head: 8 });
    beforeInput(live, "insertText", "alpha\n\nbeta");
    expect(editor.getMarkdown()).toBe("alpha\n\nbeta");
    expect(Array.from(live.children).filter((node) => node.tagName === "P"), live.innerHTML).toHaveLength(2);
    expect(editor.getSelectionOffset()).toBe(11);
  });

  it.each([
    ["```text\n- item\n```", 14],
    ["```text\n> quote\n```", 15],
    ["    - item", 10],
    ["---\n- item\n---\nbody", 10],
  ] as const)("treats list and quote spellings literally inside %j", (source, caret) => {
    const { editor, live } = setup(source, caret);
    live.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(editor.getMarkdown()).toBe(source.slice(0, caret) + "\n" + source.slice(caret));
  });

  it("continues a task list inside a quote without losing either prefix", () => {
    const { editor, live } = setup("> - [x] first second", 14);
    beforeInput(live, "insertParagraph");
    expect(editor.getMarkdown()).toBe("> - [x] first \n> - [ ] second");
  });

  it("does not invent list continuation when Enter replaces a multiline selection", () => {
    const { editor, live } = setup("- first\n- second\nuntouched");
    editor.setSelection({ anchor: 4, head: 12 });
    beforeInput(live, "insertParagraph");
    expect(editor.getMarkdown()).toBe("- fi\ncond\nuntouched");
  });

  it.each(["live", "source"])("preserves programmatic selection after %s compositionend", async (mode) => {
    const { editor, live, textarea } = setup("原文", 0);
    editor.setSourceMode(mode === "source");
    const surface = mode === "source" ? textarea : live;
    surface.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    if (mode === "source") { textarea.value = "输入原文"; textarea.setSelectionRange(2, 2); }
    const end = new CompositionEvent("compositionend", { bubbles: true });
    Object.defineProperty(end, "data", { value: "输入" });
    surface.dispatchEvent(end);
    editor.setSelection({ anchor: 0, head: 1 });
    await tick();
    expect(editor.getMarkdown()).toBe("输入原文");
    expect(editor.getSelection()).toEqual({ anchor: 0, head: 1 });
  });

  it("commits an ended composition before accepting paste", async () => {
    const { editor, live, changes } = setup("原文", 0);
    live.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    compositionEnd(live, "新");
    expect(paste(live, ["text/plain"], "paste").defaultPrevented).toBe(true);
    await tick();
    expect(editor.getMarkdown()).toBe("新paste原文");
    expect(changes).toEqual(["新原文", "新paste原文"]);
  });

  it.each(["live", "source"])("does not delete a %s selection for a clipboard without plain text", (mode) => {
    const { editor, live, textarea, changes } = setup("keep selected tail");
    editor.setSourceMode(mode === "source");
    editor.setSelection({ anchor: 5, head: 13 });
    paste(mode === "source" ? textarea : live, ["text/html"], "");
    expect(editor.getMarkdown()).toBe("keep selected tail");
    expect(changes).toEqual([]);
  });

  it("undoes an ended source composition immediately from native history", async () => {
    const { editor, textarea } = setup("原文", 0);
    editor.setSourceMode(true);
    textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    textarea.value = "新原文";
    textarea.setSelectionRange(1, 1);
    compositionEnd(textarea, "新");
    expect(beforeInput(textarea, "historyUndo").defaultPrevented).toBe(true);
    await tick();
    expect(editor.getMarkdown()).toBe("原文");
  });

  it("exports the exact selected source for dragging rather than serializing the projection", () => {
    const source = "#  Heading ##\r\n\r\n07) item  \t\r\n";
    const { editor, live } = setup(source);
    editor.setSelection({ anchor: 0, head: source.length });
    const transfer = textTransfer();
    drag(live, "dragstart", transfer);
    expect(transfer.getData("text/plain")).toBe(source);
  });

  it("inserts externally dropped source verbatim in one undoable edit", () => {
    const { editor, live, changes } = setup("before after", 7);
    const text = "#  Title ##\r\n\r\n\tplain  ";
    expect(drag(live, "drop", textTransfer(text)).defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("before " + text + "after");
    expect(changes).toHaveLength(1);
    beforeInput(live, "historyUndo");
    expect(editor.getMarkdown()).toBe("before after");
  });

  it("moves selected source atomically, including its exact whitespace", () => {
    const { editor, live, changes } = setup("a  b\r\n\tc end");
    editor.setSelection({ anchor: 1, head: 9 });
    const transfer = textTransfer();
    drag(live, "dragstart", transfer);
    editor.setSelectionOffset(12);
    drag(live, "drop", transfer);
    expect(editor.getMarkdown()).toBe("aend  b\r\n\tc ");
    expect(changes).toHaveLength(1);
    beforeInput(live, "historyUndo");
    expect(editor.getMarkdown()).toBe("a  b\r\n\tc end");
  });

  it("keeps source-mode copy and cut faithful to CRLF, CR, and backwards selections", () => {
    const source = "a\r\nb\r c\nend";
    const { editor, textarea, changes } = setup(source);
    editor.setSourceMode(true);
    editor.setSelection({ anchor: 8, head: 0 });
    for (const type of ["copy", "cut"]) {
      const data = new Map<string, string>();
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { setData: (key: string, value: string) => data.set(key, value) } });
      textarea.dispatchEvent(event);
      expect(data.get("text/plain")).toBe(source.slice(0, 8));
      expect(event.defaultPrevented).toBe(true);
    }
    expect(editor.getMarkdown()).toBe(source.slice(8));
    expect(changes).toEqual([source.slice(8)]);
    beforeInput(textarea, "historyUndo");
    expect(editor.getMarkdown()).toBe(source);
    expect(editor.getSelection()).toEqual({ anchor: 8, head: 0 });
  });

  it("tracks an async insertion's selected range through edits before it", () => {
    const { editor } = setup("prefix target suffix");
    editor.setSelection({ anchor: 7, head: 13 });
    const bookmark = editor.createInsertionBookmark();
    editor.insertMarkdown("X", 0);
    expect(bookmark.insert("[image]")).toBe(true);
    expect(editor.getMarkdown()).toBe("Xprefix [image] suffix");
    expect(bookmark.insert("again")).toBe(false);
  });

  it("preserves text that replaces a pending insertion's original selection", () => {
    const { editor } = setup("prefix target suffix");
    editor.setSelection({ anchor: 7, head: 13 });
    const bookmark = editor.createInsertionBookmark();
    editor.insertMarkdown("new");
    expect(bookmark.insert("[image]")).toBe(true);
    expect(editor.getMarkdown()).toBe("prefix new[image] suffix");
  });

  it("tracks async insertion through multi-range move, undo, and redo", () => {
    const { editor, live } = setup("a  b\r\n\tc end");
    const bookmark = editor.createInsertionBookmark(12);
    editor.setSelection({ anchor: 1, head: 9 });
    const transfer = textTransfer();
    drag(live, "dragstart", transfer);
    editor.setSelectionOffset(12);
    drag(live, "drop", transfer);
    beforeInput(live, "historyUndo");
    beforeInput(live, "historyRedo");
    bookmark.insert("[image]");
    expect(editor.getMarkdown()).toBe("aend  b\r\n\tc [image]");
  });

  it("invalidates pending insertion when an external document replaces the source", () => {
    const { editor, changes } = setup("first document");
    const bookmark = editor.createInsertionBookmark(4);
    editor.setMarkdown("second document");
    expect(bookmark.insert("[image]")).toBe(false);
    expect(editor.getMarkdown()).toBe("second document");
    expect(changes).toEqual([]);
  });

  it.each(["deleteContentBackward", "deleteContentForward"])("deletes complete source graphemes from touchscreen %s", (type) => {
    const { editor, textarea } = setup("a👨‍👩‍👧‍👦b", 2);
    editor.setSourceMode(true);
    expect(beforeInput(textarea, type).defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("ab");
    expect(editor.getSelectionOffset()).toBe(1);
  });
});
