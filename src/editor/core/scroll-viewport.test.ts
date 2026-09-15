import { describe, expect, it, vi } from "vitest";
import { createEditor } from "./lib";
import { scrollTopForRect, visibleScrollBounds } from "./scroll-viewport";

function viewport(top = 57, bottom = 28) {
  const element = document.createElement("div");
  Object.defineProperties(element, {
    clientHeight: { value: 600 }, scrollHeight: { value: 2000 }, scrollTop: { value: 400, writable: true }
  });
  element.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
  return { element, top, bottom };
}

describe("editor scroll viewport", () => {
  it("excludes both bars and a wrapping history banner", () => {
    expect(visibleScrollBounds(viewport())).toEqual({ top: 157, bottom: 672, height: 515 });
    expect(visibleScrollBounds(viewport(153))).toEqual({ top: 253, bottom: 672, height: 419 });
  });

  it("reveals the caret above or below the unobscured region, without moving an already visible caret", () => {
    const area = viewport();
    expect(scrollTopForRect(area, { top: 130, bottom: 150 })).toBe(365);
    expect(scrollTopForRect(area, { top: 665, bottom: 685 })).toBe(421);
    expect(scrollTopForRect(area, { top: 300, bottom: 320 })).toBe(400);
  });

  it("clamps at both document ends and handles a viewport shorter than its bars", () => {
    const area = viewport();
    expect(scrollTopForRect(area, { top: -1000, bottom: -980 })).toBe(0);
    expect(scrollTopForRect(area, { top: 5000, bottom: 5020 })).toBe(1400);
    expect(visibleScrollBounds(viewport(700, 100)).height).toBe(0);
    expect(Number.isFinite(scrollTopForRect(viewport(700, 100), { top: 10, bottom: 30 }))).toBe(true);
  });

  it("accepts dynamic consumer insets without changing source, selection or undo", () => {
    const area = viewport();
    document.body.append(area.element);
    const getScrollViewport = vi.fn(() => area);
    const onChange = vi.fn();
    const editor = createEditor(area.element, { initialContent: "hello", onChange, getScrollViewport });
    try {
      editor.focus();
      editor.setSelectionOffset(2);
      area.top = 153;
      editor.refreshPresentation();
      expect(editor.getMarkdown()).toBe("hello");
      expect(editor.getSelectionOffset()).toBe(2);
      expect(onChange).not.toHaveBeenCalled();
      const live = area.element.querySelector<HTMLElement>(".ProseMirror")!;
      live.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "字", bubbles: true, cancelable: true }));
      expect(editor.getMarkdown()).toBe("he字llo");
      live.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }));
      expect(editor.getMarkdown()).toBe("hello");
      expect(editor.getSelectionOffset()).toBe(2);
      expect(getScrollViewport).toHaveBeenCalled();
    } finally {
      editor.destroy();
      area.element.remove();
    }
  });
});
