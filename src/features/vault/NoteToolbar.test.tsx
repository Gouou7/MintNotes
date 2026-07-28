import { act } from "react";
import { createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { EmptyEditor, NoteToolbar } from "./NoteToolbar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

describe("empty vault editor", () => {
  it("keeps the regular toolbar layout and disables note-only controls", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <I18nProvider>
        <NoteToolbar
          titleInput={createRef<HTMLInputElement>()}
          active={false}
          title=""
          titleReadOnly
          locked={false}
          historyPreview={false}
          displayedMode="live"
          onOpenLeft={vi.fn()}
          onTitleChange={vi.fn()}
          onTitleBlur={vi.fn()}
          onTitleKeyDown={vi.fn()}
          onModeChange={vi.fn()}
          onToggleLock={vi.fn()}
          onAddImage={vi.fn()}
          onOpenRight={vi.fn()}
        />
      </I18nProvider>
    ));

    expect(container.querySelector(".empty-title-slot")?.textContent).toBe("Select a note");
    const modeButtons = [...container.querySelectorAll<HTMLButtonElement>(".mode-switch button")];
    expect(modeButtons).toHaveLength(3);
    expect(modeButtons.every((button) => button.disabled)).toBe(true);
    expect(modeButtons.every((button) => !button.classList.contains("active"))).toBe(true);
    expect(container.querySelector<HTMLButtonElement>(".note-lock-toggle")?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Add image attachment"]')?.disabled).toBe(true);

    await act(async () => root.unmount());
  });

  it("shows only the empty-state instruction", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(<I18nProvider><EmptyEditor /></I18nProvider>));

    expect(container.querySelector("h2")?.textContent).toBe("Select or create a note");
    expect(container.querySelector("p")).toBeNull();

    await act(async () => root.unmount());
  });

  it("keeps note controls enabled for an active editable note", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <I18nProvider>
        <NoteToolbar
          titleInput={createRef<HTMLInputElement>()}
          active
          title="Note title"
          titleReadOnly={false}
          locked={false}
          historyPreview={false}
          displayedMode="source"
          onOpenLeft={vi.fn()}
          onTitleChange={vi.fn()}
          onTitleBlur={vi.fn()}
          onTitleKeyDown={vi.fn()}
          onModeChange={vi.fn()}
          onToggleLock={vi.fn()}
          onAddImage={vi.fn()}
          onOpenRight={vi.fn()}
        />
      </I18nProvider>
    ));

    expect(container.querySelector<HTMLInputElement>(".title-input")?.value).toBe("Note title");
    const modeButtons = [...container.querySelectorAll<HTMLButtonElement>(".mode-switch button")];
    expect(modeButtons.every((button) => !button.disabled)).toBe(true);
    expect(modeButtons[1]?.classList.contains("active")).toBe(true);
    expect(container.querySelector<HTMLButtonElement>(".note-lock-toggle")?.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Add image attachment"]')?.disabled).toBe(false);

    await act(async () => root.unmount());
  });
});
