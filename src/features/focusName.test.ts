import { afterEach, describe, expect, it } from "vitest";
import { focusAndSelectName } from "./focusName";

afterEach(() => document.body.replaceChildren());

describe("focusAndSelectName", () => {
  it("focuses an input and selects its complete value", () => {
    const input = document.createElement("input");
    input.value = "Untitled note 2";
    document.body.append(input);

    expect(focusAndSelectName(input)).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("does nothing when the input is unavailable", () => {
    expect(focusAndSelectName(null)).toBe(false);
  });
});
