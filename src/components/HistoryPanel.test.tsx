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
  localStorage.clear();
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
  container.className = "app-shell";
  const sidebar = document.createElement("aside");
  sidebar.className = "outline-pane";
  container.append(sidebar);
  document.body.append(container);
  const root = createRoot(sidebar);
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
  return { container, props, root };
}

describe("HistoryPanel", () => {
  it.each([
    ["en", "Create snapshot", "Clear history"],
    ["zh-CN", "创建快照", "清空历史"],
    ["zh-TW", "建立快照", "清空歷史"]
  ])("labels and connects both snapshot actions in %s", async (locale, createLabel, clearLabel) => {
    localStorage.setItem("webmd-notes-language", locale);
    const { container, props } = await renderHistory();
    const buttons = container.querySelectorAll<HTMLButtonElement>(".history-panel-actions button");
    expect([...buttons].map(button => button.textContent)).toEqual([createLabel, clearLabel]);
    expect(buttons[0].querySelector(".lucide-clock-plus")).not.toBeNull();
    expect(buttons[1].querySelector(".lucide-trash-2")).not.toBeNull();

    await act(async () => { buttons[0].click(); buttons[1].click(); });

    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.onClear).toHaveBeenCalledOnce();
  });

  it("groups by local calendar date and shows only the time in row metadata", async () => {
    const items = [
      { ...protectedItem, historyId: "new-day", capturedAt: new Date(2026, 7, 9, 0, 5).toISOString() },
      { ...protectedItem, historyId: "previous-day", capturedAt: new Date(2026, 7, 8, 23, 55).toISOString() },
      { ...protectedItem, historyId: "earlier", capturedAt: new Date(2026, 7, 8, 14, 12).toISOString(), pending: true }
    ];
    const { container } = await renderHistory({ items });

    expect([...container.querySelectorAll(".history-day > h3")].map(heading => heading.textContent)).toEqual(["2026-08-09", "2026-08-08"]);
    expect([...container.querySelectorAll(".history-day")].map(day => day.querySelectorAll(".history-row").length)).toEqual([1, 2]);
    expect([...container.querySelectorAll(".history-select small")].map(details => details.textContent)).toEqual([
      "00:05 · Saved manually", "23:55 · Saved manually", "14:12 · Saved manually · Pending sync"
    ]);
  });

  it("disables snapshot actions when no note is available and clearing when history is empty", async () => {
    const { container, props, root } = await renderHistory({ disabled: true });
    expect([...container.querySelectorAll<HTMLButtonElement>(".history-panel-actions button")].every(button => button.disabled)).toBe(true);

    await act(async () => root.render(<I18nProvider><HistoryPanel {...props} disabled={false} items={[]} /></I18nProvider>));

    const buttons = container.querySelectorAll<HTMLButtonElement>(".history-panel-actions button");
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
  });

  it("places the protection shield beside the menu and disables deletion in the three-action menu", async () => {
    const { container, props } = await renderHistory();
    const badge = container.querySelector(".history-protection");
    expect(badge?.getAttribute("title")).toBe("Protected history");
    expect(badge?.querySelector(".lucide-shield")?.getAttribute("width")).toBe("16");
    expect(badge?.querySelector(".lucide-lock-keyhole")).toBeNull();
    expect(badge?.parentElement?.classList.contains("history-row")).toBe(true);
    expect(badge?.nextElementSibling?.classList.contains("history-actions")).toBe(true);
    expect(container.querySelector(".history-select svg")).toBeNull();
    await act(async () => (container.querySelector("button[aria-label='History actions']") as HTMLButtonElement).click());
    const menuButtons = [...container.querySelectorAll(".history-context-menu button")] as HTMLButtonElement[];
    expect(menuButtons.map((button) => button.textContent?.trim())).toEqual(["Rename", "Remove protection", "Delete this version"]);
    expect(menuButtons.every((button) => button.querySelector("svg"))).toBe(true);
    expect(menuButtons[2].disabled).toBe(true);
    expect(menuButtons[2].title).toBe("Remove protection before deleting this version");
    await act(async () => menuButtons[1].click());
    expect(props.onToggleProtection).toHaveBeenCalledWith(protectedItem);
  });

  it.each(["manual", "restore-safety"] as const)("shows %s history without a leading icon or an unprotected shield", async (captureKind) => {
    const item = { ...protectedItem, captureKind, protected: false };
    const { container, props } = await renderHistory({ items: [item] });
    const select = container.querySelector<HTMLButtonElement>(".history-select")!;

    expect(select.querySelector("svg")).toBeNull();
    expect(container.querySelector(".history-protection")).toBeNull();
    expect(container.querySelector(".history-actions .lucide-ellipsis")).not.toBeNull();
    await act(async () => select.click());
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith(item);
  });

  it("opens the same action menu by right-clicking a history row", async () => {
    const { container } = await renderHistory();
    const row = container.querySelector(".history-row") as HTMLElement;
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 80, clientY: 90 });

    await act(async () => row.dispatchEvent(event));

    const menu = container.querySelector(".history-context-menu") as HTMLElement;
    expect(event.defaultPrevented).toBe(true);
    expect(menu).not.toBeNull();
    expect(menu.parentElement).toBe(container);
    expect(container.querySelector(".outline-pane .history-context-menu")).toBeNull();
    expect(menu.style.left).toBe("80px");
    expect(menu.style.top).toBe("90px");
    expect([...menu.querySelectorAll("button")].map((button) => button.textContent?.trim())).toEqual(["Rename", "Remove protection", "Delete this version"]);
  });

  it.each([
    [0, "onBeginRename"],
    [1, "onToggleProtection"],
    [2, "onDelete"]
  ] as const)("keeps menu action %i clickable outside the sidebar", async (index, callback) => {
    const item = { ...protectedItem, protected: false };
    const { container, props } = await renderHistory({ items: [item] });
    await act(async () => (container.querySelector(".history-actions") as HTMLButtonElement).click());
    const button = container.querySelectorAll<HTMLButtonElement>(".history-context-menu button")[index];

    await act(async () => button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(container.querySelector(".history-context-menu")).not.toBeNull();
    await act(async () => button.click());

    expect(props[callback]).toHaveBeenCalledExactlyOnceWith(item);
    expect(container.querySelector(".history-context-menu")).toBeNull();
  });

  it.each(["pointerdown", "Escape"])("dismisses the menu on %s", async (event) => {
    const { container } = await renderHistory();
    await act(async () => (container.querySelector(".history-actions") as HTMLButtonElement).click());

    await act(async () => document.body.dispatchEvent(event === "Escape"
      ? new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      : new PointerEvent("pointerdown", { bubbles: true })));

    expect(container.querySelector(".history-context-menu")).toBeNull();
  });

  it("removes the menu when its history panel unmounts", async () => {
    const { container } = await renderHistory();
    await act(async () => (container.querySelector(".history-actions") as HTMLButtonElement).click());
    expect(container.querySelector(".history-context-menu")).not.toBeNull();

    await act(async () => roots.pop()!.unmount());

    expect(container.querySelector(".history-context-menu")).toBeNull();
  });

  it.each(["", "里程碑"])("keeps the displayed name and metadata in place while renaming %s", async (name) => {
    const item = { ...protectedItem, name, pending: true };
    const { container, props, root } = await renderHistory({ items: [item] });
    const displayedName = container.querySelector(".history-select strong")!.textContent;
    const metadata = container.querySelector(".history-select small")!.textContent;

    await act(async () => root.render(<I18nProvider><HistoryPanel {...props} renamingId={item.historyId} /></I18nProvider>));

    const input = container.querySelector<HTMLInputElement>(".history-rename-input")!;
    expect(input.value).toBe(displayedName);
    expect(container.querySelector(".history-select small")!.textContent).toBe(metadata);
    expect(input.parentElement).toBe(container.querySelector(".history-select small")!.parentElement);
    expect(container.querySelector(".history-protection + .history-actions")).not.toBeNull();
  });

  it("focuses and selects the complete generated name while renaming", async () => {
    const onRename = vi.fn();
    const { container } = await renderHistory({ renamingId: protectedItem.historyId, onRename });
    const input = container.querySelector(".history-rename-input") as HTMLInputElement;
    expect(container.querySelector(".history-select svg")).toBeNull();
    expect(container.querySelector(".history-protection + .history-actions")).not.toBeNull();
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
