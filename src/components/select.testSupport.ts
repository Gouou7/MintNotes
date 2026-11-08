import { act } from "react";

export async function openSelect(trigger: HTMLElement) {
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  });
  return [...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')];
}

export async function chooseSelect(trigger: HTMLElement, label: string) {
  const option = (await openSelect(trigger)).find((item) => item.textContent === label);
  if (!option) throw new Error(`Missing select option: ${label}`);
  await act(async () => {
    option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    option.click();
  });
}
