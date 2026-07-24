import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { submitFormOnEnter } from "./formKeyboard";

function keyboardEvent(input: HTMLInputElement, overrides: Partial<ReactKeyboardEvent<HTMLInputElement>> = {}) {
  return {
    key: "Enter",
    repeat: false,
    defaultPrevented: false,
    nativeEvent: { isComposing: false },
    currentTarget: input,
    preventDefault: vi.fn(),
    ...overrides
  } as unknown as ReactKeyboardEvent<HTMLInputElement>;
}

describe("submitFormOnEnter", () => {
  it("requests the enabled explicit submit button", () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    const submit = document.createElement("button");
    submit.type = "submit";
    form.append(input, submit);
    const requestSubmit = vi.spyOn(form, "requestSubmit").mockImplementation(() => undefined);
    const event = keyboardEvent(input);

    submitFormOnEnter(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(requestSubmit).toHaveBeenCalledWith(submit);
  });

  it("ignores composition, repeated keys, and disabled submission", () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.disabled = true;
    form.append(input, submit);
    const requestSubmit = vi.spyOn(form, "requestSubmit").mockImplementation(() => undefined);

    submitFormOnEnter(keyboardEvent(input));
    submit.disabled = false;
    submitFormOnEnter(keyboardEvent(input, { repeat: true }));
    submitFormOnEnter(keyboardEvent(input, { nativeEvent: { isComposing: true } as KeyboardEvent }));

    expect(requestSubmit).not.toHaveBeenCalled();
  });
});
