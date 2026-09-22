import { afterEach, describe, expect, it } from "vitest";
import { createEditor } from "./core/lib";

afterEach(() => { document.body.replaceChildren(); });

function textBoundary(root: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (offset <= length) return { node, offset };
    offset -= length;
  }
  throw new Error("Missing text boundary");
}

function input(surface: HTMLElement, type: string, text: string, range?: StaticRangeInit) {
  const event = new InputEvent("beforeinput", { inputType: type, data: text, bubbles: true, cancelable: true });
  Object.defineProperty(event, "getTargetRanges", { value: () => range ? [range] : [] });
  surface.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

function undo(surface: HTMLElement, redo = false) {
  surface.dispatchEvent(new KeyboardEvent("keydown", {
    key: "z", code: "KeyZ", ctrlKey: true, shiftKey: redo, bubbles: true, cancelable: true,
  }));
}

describe("native dictation targets", () => {
  it.each([
    ["insertText", "前缀后缀", "p"],
    ["insertReplacementText", "前缀后缀", "p"],
    ["insertText", "# 前缀后缀", "h1"],
    ["insertText", "```text\n前缀后缀\n```", "pre > code"],
    ["insertReplacementText", "| A |\n| --- |\n| 前缀后缀 |", "td"],
  ])("replaces cumulative %s candidates in %s without touching surrounding source", (type, initial, selector) => {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const editor = createEditor(host, { initialContent: initial, onChange: (source) => changes.push(source) });
    const start = initial.indexOf("前缀") + 2;
    editor.setSelectionOffset(start);
    editor.focus();
    const live = host.querySelector<HTMLElement>(".ProseMirror")!;
    const candidates = ["这", "这是通", "这是通过", "这是通过语音输入", "这是通过语音输入法输入的", "这是通过语音输入法输入的一段话"];
    let previous = "";
    for (const candidate of candidates) {
      const surface = live.querySelector<HTMLElement>(selector)!;
      const offset = surface.textContent!.indexOf("前缀") + 2;
      const from = textBoundary(surface, offset);
      const to = textBoundary(surface, offset + previous.length);
      input(live, previous ? type : "insertText", candidate, {
        startContainer: from.node, startOffset: from.offset, endContainer: to.node, endOffset: to.offset,
      });
      expect(editor.getMarkdown()).toBe(initial.slice(0, start) + candidate + initial.slice(start));
      expect(editor.getSelection()).toEqual({ anchor: start + candidate.length, head: start + candidate.length });
      expect(editor.isSourceMode()).toBe(false);
      previous = candidate;
    }
    expect(changes).toHaveLength(candidates.length);
    // Each replacement is atomic and retains the canonical caret in both directions.
    undo(live);
    expect(editor.getMarkdown()).toBe(initial.slice(0, start) + candidates.at(-2) + initial.slice(start));
    expect(editor.getSelectionOffset()).toBe(start + candidates.at(-2)!.length);
    undo(live, true);
    expect(editor.getMarkdown()).toBe(initial.slice(0, start) + previous + initial.slice(start));
    expect(editor.getSelectionOffset()).toBe(start + previous.length);
    editor.destroy();
  });

  it("does not deduplicate intentional repeated words", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: "你好" });
    editor.setSelectionOffset(2);
    input(host.querySelector(".ProseMirror")!, "insertText", "你好");
    expect(editor.getMarkdown()).toBe("你好你好");
    editor.destroy();
  });

  it("uses the correction target even when the caret is elsewhere", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const initial = "teh end\r\n\r\nkeep  spacing\t";
    const editor = createEditor(host, { initialContent: initial });
    editor.setSelectionOffset(initial.length);
    const live = host.querySelector<HTMLElement>(".ProseMirror")!;
    const node = live.querySelector("p")!.firstChild!;
    input(live, "insertReplacementText", "the", {
      startContainer: node, startOffset: 0, endContainer: node, endOffset: 3,
    });
    expect(editor.getMarkdown()).toBe("the" + initial.slice(3));
    expect(editor.getSelectionOffset()).toBe(3);
    undo(live);
    expect(editor.getMarkdown()).toBe(initial);
    expect(editor.getSelectionOffset()).toBe(initial.length);
    editor.destroy();
  });

  it.each(["missing", "outside", "multiple"])("falls back without modifying source for a %s replacement target", (kind) => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: "保留" });
    editor.setSelectionOffset(2);
    const live = host.querySelector<HTMLElement>(".ProseMirror")!;
    const external = document.createTextNode("外部");
    const range = { startContainer: external, startOffset: 0, endContainer: external, endOffset: 2 };
    const event = new InputEvent("beforeinput", { inputType: "insertReplacementText", data: "替换", bubbles: true, cancelable: true });
    Object.defineProperty(event, "getTargetRanges", { value: () => kind === "missing" ? [] : kind === "outside" ? [range] : [range, range] });
    live.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("保留");
    expect(editor.getSelectionOffset()).toBe(2);
    expect(editor.isSourceMode()).toBe(true);
    editor.destroy();
  });
});
