import { afterEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./core/lib";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function setup(source: string, anchor: number, head = anchor) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: string[] = [];
  const editor = createEditor(host, { initialContent: source, onChange: (next) => changes.push(next) });
  editors.push(editor);
  editor.focus();
  editor.setSelection({ anchor, head });
  const live = host.querySelector<HTMLElement>(".ProseMirror")!;
  return { editor, live, changes };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function compositionEvent(type: string, data = "") {
  const event = new CompositionEvent(type, { bubbles: true, data });
  // happy-dom does not implement CompositionEvent.data.
  Object.defineProperty(event, "data", { value: data });
  return event;
}

/** Exercise DOM mutations as well as events; dispatched input alone edits nothing. */
async function compose(live: HTMLElement, candidates: string[], removeBreaks = false, waitAtEnd = true) {
  live.dispatchEvent(compositionEvent("compositionstart"));
  const selection = document.getSelection()!;
  const range = selection.getRangeAt(0);
  if (removeBreaks) {
    // Browsers can consume a blank line's BR as the native insertion placeholder.
    const parent = range.startContainer.nodeType === 1
      ? range.startContainer as HTMLElement : range.startContainer.parentElement!;
    parent.closest("code")?.querySelectorAll("[data-source-gap-eol]").forEach((node) => node.remove());
  }
  range.deleteContents();
  const text = document.createTextNode("");
  range.insertNode(text);
  for (const candidate of candidates) {
    text.data = candidate;
    range.setStart(text, text.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    live.dispatchEvent(compositionEvent("compositionupdate", candidate));
    live.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: candidate, isComposing: true }));
    await tick();
  }
  live.dispatchEvent(compositionEvent("compositionend", candidates.at(-1) ?? ""));
  if (waitAtEnd) await tick();
}

function undo(live: HTMLElement, redo = false) {
  live.dispatchEvent(new KeyboardEvent("keydown", {
    key: "z", ctrlKey: true, shiftKey: redo, bubbles: true, cancelable: true,
  }));
}

describe("native composition source ownership", () => {
  it("keeps the authored line ending when IME replaces a leading blank line's BR", async () => {
    const initial = "\n这是一行已有的内容";
    const { editor, live, changes } = setup(initial, 0);
    await compose(live, ["shu", "输入"], true);
    expect(editor.getMarkdown()).toBe(`输入${initial}`);
    expect(editor.getSelection()).toEqual({ anchor: 2, head: 2 });
    expect(changes).toEqual([`输入${initial}`]);
    undo(live);
    expect(editor.getMarkdown()).toBe(initial);
    expect(editor.getSelection()).toEqual({ anchor: 0, head: 0 });
    undo(live, true);
    expect(editor.getMarkdown()).toBe(`输入${initial}`);
    expect(editor.getSelectionOffset()).toBe(2);
  });

  it.each([
    ["leading CRLF", "\r\n原有内容", 0],
    ["leading CR", "\r原有内容", 0],
    ["several leading rows", "\n\n\n原有内容", 1],
    ["between paragraphs", "前文\n\n\n后文", 4],
    ["trailing row", "前文\n", 3],
    ["trailing rows", "前文\n\n\n", 4],
    ["space and tab", "前文\n \n\t\n后文", 6],
    ["only blank rows", "\n\n\n", 1],
  ] as const)("keeps every original whitespace character on a %s", async (_name, initial, caret) => {
    const { editor, live, changes } = setup(initial, caret);
    await compose(live, ["p", "pin", "拼音", "字"], true);
    const expected = initial.slice(0, caret) + "字" + initial.slice(caret);
    expect(editor.getMarkdown()).toBe(expected);
    expect(editor.getSelectionOffset()).toBe(caret + 1);
    expect(editor.isSourceMode()).toBe(false);
    expect(changes).toEqual([expected]);
    undo(live);
    expect(editor.getMarkdown()).toBe(initial);
    expect(editor.getSelectionOffset()).toBe(caret);
  });

  it.each([
    ["paragraph start", "相同文字\n\n相同文字", 6],
    ["paragraph middle", "前后\n\n后续", 1],
    ["heading middle", "# 前后\n\n后续", 3],
    ["list middle", "- 前后\n- 后续", 3],
    ["table cell", "| 前后 | b |\n| --- | --- |\n| 后续 | d |", 3],
  ] as const)("retains surrounding source through candidate changes at %s", async (_name, initial, caret) => {
    const { editor, live, changes } = setup(initial, caret);
    await compose(live, ["n", "nihao", "你好", "你"]);
    const expected = initial.slice(0, caret) + "你" + initial.slice(caret);
    expect(editor.getMarkdown()).toBe(expected);
    expect(editor.getSelection()).toEqual({ anchor: caret + 1, head: caret + 1 });
    expect(changes).toEqual([expected]);
  });

  it.each([false, true])("replaces the exact selected source with a backward=%s selection", async (backward) => {
    const initial = "前旧文字后\n\n保留\t空格  ";
    const from = 1, to = 4;
    const { editor, live, changes } = setup(initial, backward ? to : from, backward ? from : to);
    await compose(live, ["xin", "新的", "新"]);
    expect(editor.getMarkdown()).toBe("前新后\n\n保留\t空格  ");
    expect(editor.getSelectionOffset()).toBe(2);
    expect(changes).toHaveLength(1);
    undo(live);
    expect(editor.getMarkdown()).toBe(initial);
    expect(editor.getSelection()).toEqual({ anchor: backward ? to : from, head: backward ? from : to });
  });

  it("captures the browser selection when composition starts before selectionchange is processed", async () => {
    const { editor, live } = setup("前旧文字后", 5);
    const text = live.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 4);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    await compose(live, ["xin", "新"]);
    expect(editor.getMarkdown()).toBe("前新后");
    expect(editor.getSelectionOffset()).toBe(2);
  });

  it.each(["😀", "👨‍👩‍👧‍👦", "e\u0301", "か\u3099"])("commits %s as one undoable composition", async (text) => {
    const { editor, live } = setup("前后", 1);
    await compose(live, ["x", text]);
    expect(editor.getMarkdown()).toBe(`前${text}后`);
    expect(editor.getSelectionOffset()).toBe(1 + text.length);
    undo(live);
    expect(editor.getMarkdown()).toBe("前后");
  });

  it("repairs a cancelled blank-line composition without saving or adding undo history", async () => {
    const initial = "\n原有内容";
    const { editor, live, changes } = setup(initial, 0);
    await compose(live, ["ni", ""], true);
    expect(editor.getMarkdown()).toBe(initial);
    expect(editor.getSelectionOffset()).toBe(0);
    expect(live.querySelector("[data-source-gap-eol]")).not.toBeNull();
    expect(changes).toEqual([]);
    undo(live);
    expect(changes).toEqual([]);
  });

  it("keeps final native mutations inside the same commit when compositionend runs first", async () => {
    const { editor, live, changes } = setup("前后", 1);
    live.dispatchEvent(compositionEvent("compositionstart"));
    const selection = document.getSelection()!;
    const range = selection.getRangeAt(0);
    const text = document.createTextNode("最终");
    range.insertNode(text);
    range.setStart(text, text.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    live.dispatchEvent(compositionEvent("compositionend", "最终"));
    live.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromComposition", data: "最终" }));
    await tick();
    expect(editor.getMarkdown()).toBe("前最终后");
    expect(editor.getSelectionOffset()).toBe(3);
    expect(changes).toEqual(["前最终后"]);
    expect(editor.isComposing()).toBe(false);
  });

  it.each([false, true])("does not lose ordinary typing immediately after IME confirmation with targetRanges=%s", async (withTargetRanges) => {
    const { editor, live, changes } = setup("前后", 1);
    await compose(live, ["ni", "你"], false, false);
    const range = document.getSelection()!.getRangeAt(0);
    const target = { startContainer: range.startContainer, startOffset: range.startOffset,
      endContainer: range.endContainer, endOffset: range.endOffset };
    const event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: "x" });
    if (withTargetRanges) Object.defineProperty(event, "getTargetRanges", { value: () => [target] });
    live.dispatchEvent(event);
    await tick();
    expect(editor.getMarkdown()).toBe("前你x后");
    expect(editor.getSelectionOffset()).toBe(3);
    expect(changes).toEqual(["前你后", "前你x后"]);
    expect(editor.isComposing()).toBe(false);
  });

  it("keeps consecutive sessions separate even before the prior commit timer runs", async () => {
    const { editor, live, changes } = setup("\n后文", 0);
    await compose(live, ["ni", "你"], true, false);
    await compose(live, ["hao", "好"]);
    expect(editor.getMarkdown()).toBe("你好\n后文");
    expect(editor.getSelectionOffset()).toBe(2);
    expect(changes).toEqual(["你\n后文", "你好\n后文"]);
    undo(live);
    expect(editor.getMarkdown()).toBe("你\n后文");
    undo(live);
    expect(editor.getMarkdown()).toBe("\n后文");
  });

  it("defers mode and async presentation changes through the composition commit", async () => {
    const { editor, live, changes } = setup("\n后文", 0);
    live.dispatchEvent(compositionEvent("compositionstart"));
    editor.setSourceMode(true);
    editor.refreshPresentation();
    expect(editor.isSourceMode()).toBe(false);
    const surface = live.querySelector("pre[data-source-gap]")!;
    surface.textContent = "输入";
    const range = document.createRange();
    range.selectNodeContents(surface);
    range.collapse(false);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    live.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "输入", isComposing: true }));
    live.dispatchEvent(compositionEvent("compositionend", "输入"));
    await tick();
    expect(editor.getMarkdown()).toBe("输入\n后文");
    expect(editor.isSourceMode()).toBe(true);
    expect(editor.getSelectionOffset()).toBe(2);
    expect(changes).toEqual(["输入\n后文"]);
  });
});

describe("source textarea composition lifecycle", () => {
  it("does not let the prior session's timer commit a new active candidate", async () => {
    const { editor, live, changes } = setup("前后", 1);
    editor.setSourceMode(true);
    const textarea = live.parentElement!.parentElement!.querySelector("textarea")!;
    textarea.dispatchEvent(compositionEvent("compositionstart"));
    textarea.value = "前你后";
    textarea.setSelectionRange(2, 2);
    textarea.dispatchEvent(new InputEvent("input", { inputType: "insertCompositionText", isComposing: true }));
    textarea.dispatchEvent(compositionEvent("compositionend", "你"));
    textarea.dispatchEvent(compositionEvent("compositionstart"));
    textarea.value = "前你hao后";
    textarea.setSelectionRange(5, 5);
    textarea.dispatchEvent(new InputEvent("input", { inputType: "insertCompositionText", isComposing: true }));
    await tick();
    expect(changes).toEqual(["前你后"]);
    expect(editor.isComposing()).toBe(true);
    textarea.value = "前你好后";
    textarea.setSelectionRange(3, 3);
    textarea.dispatchEvent(compositionEvent("compositionend", "好"));
    await tick();
    expect(changes).toEqual(["前你后", "前你好后"]);
    expect(editor.getSelectionOffset()).toBe(3);
  });

  it("finishes a queued commit before destruction and leaves no callback behind", async () => {
    const { editor, live, changes } = setup("前后", 1);
    editor.setSourceMode(true);
    const textarea = live.parentElement!.parentElement!.querySelector("textarea")!;
    textarea.dispatchEvent(compositionEvent("compositionstart"));
    textarea.value = "前你后";
    textarea.setSelectionRange(2, 2);
    textarea.dispatchEvent(compositionEvent("compositionend", "你"));
    editor.destroy();
    editors.splice(editors.indexOf(editor), 1);
    expect(changes).toEqual(["前你后"]);
    await tick();
    expect(changes).toEqual(["前你后"]);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("settles the old source session before accepting an external document", async () => {
    const { editor, live, changes } = setup("前后", 1);
    editor.setSourceMode(true);
    const textarea = live.parentElement!.parentElement!.querySelector("textarea")!;
    textarea.dispatchEvent(compositionEvent("compositionstart"));
    textarea.value = "前你后";
    textarea.setSelectionRange(2, 2);
    textarea.dispatchEvent(compositionEvent("compositionend", "你"));
    editor.setMarkdown("另一篇笔记");
    await tick();
    expect(editor.getMarkdown()).toBe("另一篇笔记");
    expect(changes).toEqual(["前你后"]);
    expect(editor.isComposing()).toBe(false);
  });
});
