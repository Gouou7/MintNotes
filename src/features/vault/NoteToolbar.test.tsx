import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { EmptyEditor, NoteToolbar } from "./NoteToolbar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

async function setup(state: { active?: boolean; locked?: boolean; sourceMode?: boolean; readOnly?: boolean; historyPreview?: boolean } = {}) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const onToggleSource = vi.fn(), onToggleReadOnly = vi.fn();
  await act(async () => root!.render(<I18nProvider><NoteToolbar
    titleInput={createRef<HTMLInputElement>()} active={state.active ?? true} title="Note title" titleReadOnly={state.readOnly ?? false}
    locked={state.locked ?? false} historyPreview={state.historyPreview ?? false}
    sourceMode={state.sourceMode ?? false} readOnly={state.readOnly ?? false}
    onOpenLeft={vi.fn()} onTitleChange={vi.fn()} onTitleBlur={vi.fn()} onTitleKeyDown={vi.fn()}
    onToggleSource={onToggleSource} onToggleReadOnly={onToggleReadOnly} onToggleLock={vi.fn()} onAddImage={vi.fn()} onOpenRight={vi.fn()}
  /></I18nProvider>));
  const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
  return { host, button, onToggleSource, onToggleReadOnly };
}

describe("note toolbar", () => {
  it("keeps the empty layout and disables note-only controls", async () => {
    const { host } = await setup({ active: false });
    expect(host.querySelector(".empty-title-slot")?.textContent).toBe("Select a note");
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".mode-switch button,.note-lock-toggle,.toolbar-icon:not(.right-pane-toggle)")];
    expect(buttons).toHaveLength(4);
    expect(buttons.every(button => button.disabled && !button.classList.contains("active"))).toBe(true);
  });
  it("orders image, protection, read-only and source actions and toggles them independently", async () => {
    const { host, button, onToggleSource, onToggleReadOnly } = await setup({ sourceMode: true, readOnly: true });
    expect([...host.querySelectorAll<HTMLButtonElement>(".toolbar-icon:not(.right-pane-toggle),.mode-switch button")].map(button => button.getAttribute("aria-label")))
      .toEqual(["Add image attachment", "Lock note", "Read-only", "Source"]);
    expect(button("Read-only").getAttribute("aria-pressed")).toBe("true");
    expect(button("Source").getAttribute("aria-pressed")).toBe("true");
    expect(button("Add image attachment").disabled).toBe(true);
    await act(async () => { button("Source").click(); button("Read-only").click(); });
    expect(onToggleSource).toHaveBeenCalledOnce(); expect(onToggleReadOnly).toHaveBeenCalledOnce();
  });
  it("allows protected source switching while read-only stays pressed and disabled", async () => {
    const { button, onToggleSource, onToggleReadOnly } = await setup({ locked: true, readOnly: true, sourceMode: true });
    expect(button("Unlock note").getAttribute("aria-pressed")).toBe("true");
    expect(button("Unlock note").disabled).toBe(false);
    expect(button("Read-only").getAttribute("aria-pressed")).toBe("true");
    expect(button("Read-only").disabled).toBe(true);
    expect(button("Source").disabled).toBe(false);
    await act(async () => { button("Source").click(); button("Read-only").click(); });
    expect(onToggleSource).toHaveBeenCalledOnce(); expect(onToggleReadOnly).not.toHaveBeenCalled();
  });
  it("disables mode and note actions in history preview", async () => {
    const { host } = await setup({ historyPreview: true });
    expect([...host.querySelectorAll<HTMLButtonElement>(".mode-switch button,.note-lock-toggle,.toolbar-icon:not(.right-pane-toggle)")].every(button => button.disabled)).toBe(true);
  });
  it("shows only the empty-state instruction", async () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root!.render(<I18nProvider><EmptyEditor /></I18nProvider>));
    expect(host.querySelector("h2")?.textContent).toBe("Select or create a note"); expect(host.querySelector("p")).toBeNull();
  });
});
