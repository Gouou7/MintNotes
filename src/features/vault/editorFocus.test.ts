import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { focusEditorFromTitle } from "./editorFocus";

function titleEvent(overrides: Partial<ReactKeyboardEvent<HTMLInputElement>> = {}) {
  const input = document.createElement("input");
  const blur = vi.spyOn(input, "blur");
  const event = {
    key: "Enter",
    repeat: false,
    defaultPrevented: false,
    nativeEvent: { isComposing: false },
    currentTarget: input,
    preventDefault: vi.fn(),
    ...overrides
  } as unknown as ReactKeyboardEvent<HTMLInputElement>;
  return { blur, event };
}

describe("focusEditorFromTitle", () => {
  it("commits the title field and moves focus into the editor on Enter", () => {
    const focus = vi.fn();
    const { blur, event } = titleEvent();

    expect(focusEditorFromTitle(event, { focus })).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(blur).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("ignores composition, repeated keys, and non-Enter keys", () => {
    const focus = vi.fn();
    const composing = titleEvent({ nativeEvent: { isComposing: true } as KeyboardEvent });
    const repeated = titleEvent({ repeat: true });
    const tab = titleEvent({ key: "Tab" });

    expect(focusEditorFromTitle(composing.event, { focus })).toBe(false);
    expect(focusEditorFromTitle(repeated.event, { focus })).toBe(false);
    expect(focusEditorFromTitle(tab.event, { focus })).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    expect(composing.blur).not.toHaveBeenCalled();
    expect(repeated.blur).not.toHaveBeenCalled();
    expect(tab.blur).not.toHaveBeenCalled();
  });
});
