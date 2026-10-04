import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState, Plugin, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";

import { nativeSelectionPresentationPlugin } from "./native-selection-presentation";
import { schema } from "./schema";
import { createEditor } from "./lib";

const views: EditorView[] = [];
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const frame = nextFrame++;
    frames.set(frame, callback);
    return frame;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frame) => {
    frames.delete(frame);
  });
});

function flushFrames(): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(performance.now());
}

afterEach(() => {
  for (const view of views.splice(0)) {
    const host = view.dom.parentElement;
    view.destroy();
    host?.remove();
  }
  vi.restoreAllMocks();
});

function createView(backwards = false) {
  let deferred = false;
  const presentation: Plugin<boolean> = new Plugin<boolean>({
    state: {
      init: () => false,
      apply: (transaction, previous) => transaction.getMeta("reveal") ?? previous,
    },
    props: {
      decorations(state) {
        return presentation.getState(state)
          ? DecorationSet.create(state.doc, [Decoration.inline(2, 5, { class: "syntax-hint" })])
          : DecorationSet.empty;
      },
    },
  });
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("first **bold**")),
    schema.node("paragraph", null, schema.text("last")),
  ]);
  const from = 2;
  const to = doc.content.size - 2;
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, backwards ? to : from, backwards ? from : to),
    plugins: [presentation, nativeSelectionPresentationPlugin(() => deferred)],
  });
  const host = document.createElement("div");
  document.body.append(host);
  const view = new EditorView(host, { state });
  views.push(view);
  view.focus();
  // Consume the focus-class mutation before testing presentation changes.
  view.updateState(view.state);
  flushFrames();
  return { view, defer: (value: boolean) => { deferred = value; } };
}

describe("native selection after presentation changes", () => {
  it.each([false, true])("reestablishes an equivalent range after syntax wrappers change (backwards: %s)", (backwards) => {
    const { view } = createView(backwards);
    const selection = view.state.selection;
    const restore = vi.spyOn(view, "focus");
    const collapse = vi.spyOn(document.getSelection()!, "collapse");
    const extend = vi.spyOn(document.getSelection()!, "extend");

    view.dispatch(view.state.tr.setMeta("reveal", true));
    expect(restore).not.toHaveBeenCalled();
    flushFrames();

    expect(restore).toHaveBeenCalledOnce();
    expect(view.state.selection.eq(selection)).toBe(true);
    const anchor = view.domAtPos(selection.anchor, -1);
    const head = view.domAtPos(selection.head, -1);
    expect(collapse).toHaveBeenLastCalledWith(anchor.node, anchor.offset);
    expect(extend).toHaveBeenLastCalledWith(head.node, head.offset);
    const range = document.getSelection()!.getRangeAt(0);
    expect(view.posAtDOM(range.startContainer, range.startOffset)).toBe(selection.from);
    expect(view.posAtDOM(range.endContainer, range.endOffset)).toBe(selection.to);
    expect(document.getSelection()!.isCollapsed).toBe(false);
    expect(view.dom.querySelector(".syntax-hint")?.textContent).toBe("irs");
    expect(view.state.doc.textContent).toBe("first **bold**last");
  });

  it("does not rebuild a range for a state update that leaves the DOM unchanged", () => {
    const { view } = createView();
    const restore = vi.spyOn(view, "focus");
    view.dispatch(view.state.tr);
    flushFrames();
    expect(restore).not.toHaveBeenCalled();
  });

  it("restores the selection after presentation changes outside a state update", async () => {
    const { view } = createView();
    const restore = vi.spyOn(view, "focus");
    // happy-dom reports the anchor as the focus of a non-collapsed selection.
    // Correct its forward endpoint while ProseMirror handles selectionchange.
    const native = document.getSelection()!;
    vi.spyOn(native, "focusNode", "get").mockImplementation(() => native.getRangeAt(0).endContainer);
    vi.spyOn(native, "focusOffset", "get").mockImplementation(() => native.getRangeAt(0).endOffset);
    view.dom.querySelector("p")!.style.paddingLeft = "1px";
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    flushFrames();
    expect(restore).toHaveBeenCalledOnce();
  });

  it("retains presentation changes made while a pointer selection is deferred", () => {
    const { view, defer } = createView();
    const restore = vi.spyOn(view, "focus");
    defer(true);
    view.dispatch(view.state.tr.setMeta("reveal", true));
    flushFrames();
    expect(restore).not.toHaveBeenCalled();
    defer(false);
    view.dispatch(view.state.tr);
    flushFrames();
    expect(restore).toHaveBeenCalledOnce();
  });

  it("coalesces changes and restores the latest selection at paint time", () => {
    const { view } = createView();
    const restore = vi.spyOn(view, "focus");
    view.dispatch(view.state.tr.setMeta("reveal", true));
    view.dispatch(view.state.tr.setMeta("reveal", false));
    const latest = TextSelection.create(view.state.doc, 10, 3);
    view.dispatch(view.state.tr.setSelection(latest));
    const collapse = vi.spyOn(document.getSelection()!, "collapse");
    const extend = vi.spyOn(document.getSelection()!, "extend");
    flushFrames();

    expect(restore).toHaveBeenCalledOnce();
    const anchor = view.domAtPos(latest.anchor, -1);
    const head = view.domAtPos(latest.head, -1);
    expect(collapse).toHaveBeenLastCalledWith(anchor.node, anchor.offset);
    expect(extend).toHaveBeenLastCalledWith(head.node, head.offset);
  });

  it("cancels queued restoration when a newer selection collapses", () => {
    const { view } = createView();
    const restore = vi.spyOn(view, "focus");
    view.dispatch(view.state.tr.setMeta("reveal", true));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
    flushFrames();
    expect(restore).not.toHaveBeenCalled();
    expect(view.state.selection.empty).toBe(true);
  });

  it("does not reclaim focus if the editor loses it before the next frame", () => {
    const { view } = createView();
    const restore = vi.spyOn(view, "focus");
    view.dispatch(view.state.tr.setMeta("reveal", true));
    const other = document.createElement("button");
    document.body.append(other);
    try {
      other.focus();
      flushFrames();
      expect(restore).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(other);
    } finally { other.remove(); }
  });

  it("cancels queued work when the editor is destroyed", () => {
    const { view } = createView();
    const restore = vi.spyOn(view, "focus");
    view.dispatch(view.state.tr.setMeta("reveal", true));
    view.destroy();
    flushFrames();
    expect(restore).not.toHaveBeenCalled();
  });

  it("leaves an active pointer drag or deferred composition alone", () => {
    const { view, defer } = createView();
    const restore = vi.spyOn(view, "focus");
    defer(true);
    view.dispatch(view.state.tr.setMeta("reveal", true));
    flushFrames();
    expect(restore).not.toHaveBeenCalled();
    defer(false);
    view.dispatch(view.state.tr.setMeta("reveal", false));
    flushFrames();
    expect(restore).toHaveBeenCalledOnce();
  });

  it("does not disturb a native composition", () => {
    const { view } = createView();
    const restore = vi.spyOn(view, "focus");
    vi.spyOn(view, "composing", "get").mockReturnValue(true);
    view.dispatch(view.state.tr.setMeta("reveal", true));
    flushFrames();
    expect(restore).not.toHaveBeenCalled();
  });

  it("does not touch a collapsed caret or an editor that has lost focus", () => {
    const { view } = createView();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    const restore = vi.spyOn(view, "focus");
    view.dispatch(view.state.tr.setMeta("reveal", true));
    flushFrames();
    expect(restore).not.toHaveBeenCalled();

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 10)));
    restore.mockClear();
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();
    try {
      view.dispatch(view.state.tr.setMeta("reveal", false));
      flushFrames();
      expect(restore).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(other);
    } finally {
      other.remove();
    }
  });

  it.each([false, true])("preserves a large list selection, copy and undo through source reveal (backwards: %s)", (backwards) => {
    const source = "outside\n\n" + Array.from({ length: 40 }, (_,index) => (
      `- Lv.${index}\n\n  **楼层 ${index}**\n  评论内容😀\n  举报 支持(0) 反对(0) 回复\n`
    )).join("\n");
    const from = source.indexOf("  **楼层 0**") + 2;
    const to = source.length - 1;
    const selected = { anchor: backwards ? to : from, head: backwards ? from : to };
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor(host, { initialContent: source, onChange });
    try {
      editor.focus();
      flushFrames();
      const clear = vi.spyOn(document.getSelection()!, "removeAllRanges");
      editor.setSelection(selected);
      flushFrames();
      expect(clear).toHaveBeenCalled();
      expect(editor.getSelection()).toEqual(selected);
      expect(onChange).not.toHaveBeenCalled();

      const editable = host.querySelector<HTMLElement>(".ProseMirror")!;
      expect(editable.querySelectorAll("li.source-list-editing").length).toBeGreaterThan(30);
      let copied = "";
      const copy = new Event("copy", { bubbles: true, cancelable: true });
      Object.defineProperty(copy, "clipboardData", { value: {
        setData: (_type: string, value: string) => { copied = value; },
      } });
      editable.dispatchEvent(copy);
      expect(copy.defaultPrevented).toBe(true);
      expect(copied).toBe(source.slice(from, to));

      editable.dispatchEvent(new InputEvent("beforeinput", {
        inputType: "insertText", data: "replacement", bubbles: true, cancelable: true,
      }));
      expect(editor.getMarkdown()).toBe(source.slice(0, from) + "replacement" + source.slice(to));
      expect(onChange).toHaveBeenCalledOnce();
      editable.dispatchEvent(new KeyboardEvent("keydown", {
        key: "z", ctrlKey: true, metaKey: true, bubbles: true, cancelable: true,
      }));
      expect(editor.getMarkdown()).toBe(source);
      expect(editor.getSelection()).toEqual(selected);
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});
