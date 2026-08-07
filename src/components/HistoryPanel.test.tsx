import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { HistoryListItem } from "../types";
import { HistoryPanel } from "./HistoryPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

const protectedItem: HistoryListItem = {
  historyId: "history-a",
  noteId: "note-a",
  capturedAt: "2026-08-08T12:00:00.000Z",
  captureKind: "manual",
  name: "发布前版本",
  protected: true,
  byteSize: 128,
  pending: false
};

async function renderHistory(overrides: Partial<Parameters<typeof HistoryPanel>[0]> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const props: Parameters<typeof HistoryPanel>[0] = {
    items: [protectedItem],
    selectedId: null,
    loading: false,
    hasMore: false,
    disabled: false,
    renamingId: null,
    onSelect: vi.fn(),
    onSave: vi.fn(),
    onBeginRename: vi.fn(),
    onRename: vi.fn(),
    onRenameCancel: vi.fn(),
    onToggleProtection: vi.fn(),
    onDelete: vi.fn(),
    onClear: vi.fn(),
    onLoadMore: vi.fn(),
    ...overrides
  };
  await act(async () => root.render(<I18nProvider><HistoryPanel {...props} /></I18nProvider>));
  return { container, props };
}

describe("HistoryPanel", () => {
  it("reuses the protected badge and disables deletion in the three-action menu", async () => {
    const { container, props } = await renderHistory();
    expect(container.querySelector(".protection-badge")?.getAttribute("title")).toBe("Protected history");
    await act(async () => (container.querySelector("button[aria-label='History actions']") as HTMLButtonElement).click());
    const menuButtons = [...container.querySelectorAll(".history-context-menu button")] as HTMLButtonElement[];
    expect(menuButtons.map((button) => button.textContent?.trim())).toEqual(["Rename", "Remove protection", "Delete this version"]);
    expect(menuButtons[2].disabled).toBe(true);
    expect(menuButtons[2].title).toBe("Remove protection before deleting this version");
    await act(async () => menuButtons[1].click());
    expect(props.onToggleProtection).toHaveBeenCalledWith(protectedItem);
  });

  it("focuses and selects the complete generated name while renaming", async () => {
    const onRename = vi.fn();
    const { container } = await renderHistory({ renamingId: protectedItem.historyId, onRename });
    const input = container.querySelector(".history-rename-input") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "里程碑");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onRename).toHaveBeenCalledWith(protectedItem, "里程碑");
  });

  it("cancels inline rename on Escape without committing", async () => {
    const onRename = vi.fn();
    const onRenameCancel = vi.fn();
    const { container } = await renderHistory({
      renamingId: protectedItem.historyId,
      onRename,
      onRenameCancel
    });
    const input = container.querySelector(".history-rename-input") as HTMLInputElement;
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onRenameCancel).toHaveBeenCalledOnce();
    expect(onRename).not.toHaveBeenCalled();
  });
});
