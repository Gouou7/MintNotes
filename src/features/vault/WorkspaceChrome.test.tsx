import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { WorkspacePanelHeader, WorkspaceSidebar } from "./WorkspaceChrome";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => document.body.replaceChildren());

describe("workspace chrome", () => {
  it("keeps search clearing, sort selection and sidebar actions connected", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onSearchChange = vi.fn(), onCreate = vi.fn(), onSortChange = vi.fn();
    const onLocate = vi.fn(), onCollapseAll = vi.fn(), onLock = vi.fn(), onSettings = vi.fn();
    const searchInput = createRef<HTMLInputElement>();
    await act(async () => root.render(<I18nProvider><WorkspaceSidebar
      searchInput={searchInput} search="query" onSearchChange={onSearchChange} onCreate={onCreate}
      sortMode="alphabetical" onSortChange={onSortChange} canLocate onLocate={onLocate}
      onCollapseAll={onCollapseAll} onCollapse={vi.fn()} onClose={vi.fn()} pinned={null}
      displayName="User" username="username" avatarUrl={null} onLock={onLock} onSettings={onSettings}
    ><div className="document-tree" /></WorkspaceSidebar></I18nProvider>));

    const click = (label: string) => act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click());
    click("Clear search");
    expect(onSearchChange).toHaveBeenCalledWith("");
    expect(document.activeElement).toBe(searchInput.current);
    click("New note"); click("New folder");
    expect(onCreate.mock.calls).toEqual([["note"], ["folder"]]);
    const sort = container.querySelector<HTMLSelectElement>("select")!;
    act(() => { sort.value = "manual"; sort.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onSortChange).toHaveBeenCalledWith("manual");
    click("Locate current note"); click("Collapse all folders");
    expect(onLocate).toHaveBeenCalledOnce(); expect(onCollapseAll).toHaveBeenCalledOnce();
    click("Lock"); click("Settings");
    expect(onLock).toHaveBeenCalledOnce(); expect(onSettings).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("keeps panel navigation and both close controls accessible without visible labels", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onTabChange = vi.fn(), onCollapse = vi.fn(), onClose = vi.fn();
    await act(async () => root.render(<I18nProvider><WorkspacePanelHeader tab="outline" onTabChange={onTabChange} onCollapse={onCollapse} onClose={onClose} /></I18nProvider>));
    const tabs = container.querySelectorAll<HTMLButtonElement>(".right-panel-tabs button");
    expect(tabs[0].getAttribute("aria-current")).toBe("page");
    expect([...tabs].every(button => Boolean(button.getAttribute("aria-label")))).toBe(true);
    act(() => tabs[1].click());
    expect(onTabChange).toHaveBeenCalledWith("history");
    act(() => container.querySelector<HTMLButtonElement>(".right-pane-collapse")?.click());
    act(() => container.querySelector<HTMLButtonElement>(".mobile-outline-close")?.click());
    expect(onCollapse).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
});
