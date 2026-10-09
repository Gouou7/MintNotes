import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { OutlineItem } from "../types";
import { OutlinePanel } from "./OutlinePanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  localStorage.clear();
});

const items: OutlineItem[] = [
  { id: "heading-0", level: 2, text: "Parent", index: 0, sourceOffset: 0, sourceLine: 0 },
  { id: "heading-1", level: 4, text: "Child", index: 1, sourceOffset: 20, sourceLine: 2 },
  { id: "heading-2", level: 6, text: "Deep child", index: 2, sourceOffset: 40, sourceLine: 4 },
  { id: "heading-3", level: 2, text: "Next section", index: 3, sourceOffset: 60, sourceLine: 6 }
];
async function renderOutline(outline = items) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  const onSelect = vi.fn();
  const render = (next: OutlineItem[], activeId: string | null = null) => act(async () => root.render(<I18nProvider><OutlinePanel items={next} activeId={activeId} onSelect={onSelect} /></I18nProvider>));
  await render(outline);
  return { host, onSelect, render };
}
const toggle = (host: HTMLElement, title: string) => host.querySelector<HTMLButtonElement>(`.outline-toggle[aria-label$=" ${title}"]`)!;
const children = (button: HTMLButtonElement) => document.getElementById(button.getAttribute("aria-controls")!)!;

describe("OutlinePanel", () => {
  it("renders normalized nested levels with a toggle only for parent headings", async () => {
    const { host } = await renderOutline();
    expect([...host.querySelectorAll(".outline-node")].map(node => node.getAttribute("data-outline-level"))).toEqual(["1", "2", "3", "1"]);
    expect(host.querySelectorAll(".outline-toggle")).toHaveLength(2);
    expect(host.querySelectorAll(".outline-spacer")).toHaveLength(2);
    expect(host.querySelector(".outline-children .outline-children .outline-title")?.textContent).toBe("Deep child");
  });

  it("toggles branches without navigation and retains nested collapse choices", async () => {
    const { host, onSelect } = await renderOutline();
    const parent = toggle(host, "Parent"), child = toggle(host, "Child");
    await act(async () => { child.click(); parent.click(); });
    expect(children(parent).hidden).toBe(true);
    expect(parent.getAttribute("aria-expanded")).toBe("false");
    await act(async () => parent.click());
    expect(children(parent).hidden).toBe(false);
    expect(children(child).hidden).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("passes the original heading with its source position when selecting a title", async () => {
    const { host, onSelect, render } = await renderOutline();
    const title = host.querySelectorAll<HTMLButtonElement>(".outline-title")[2];
    await act(async () => title.click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(items[2]);
    await render(items, items[2].id);
    expect(title.getAttribute("aria-current")).toBe("location");
    expect(toggle(host, "Parent").getAttribute("aria-expanded")).toBe("true");
  });

  it("retains a collapsed section when an earlier heading is inserted", async () => {
    const { host, render } = await renderOutline();
    await act(async () => toggle(host, "Parent").click());
    const shifted = items.map(item => ({ ...item, id: `heading-${item.index + 1}`, index: item.index + 1, sourceOffset: item.sourceOffset + 12 }));
    await render([{ ...items[0], text: "Introduction" }, ...shifted]);
    expect(toggle(host, "Parent").getAttribute("aria-expanded")).toBe("false");
    expect(children(toggle(host, "Parent")).hidden).toBe(true);
  });

  it("follows the controlled current heading and highlights a visible ancestor without opening a folded branch", async () => {
    const { host, render, onSelect } = await renderOutline();
    await render(items, items[2].id);
    expect(host.querySelector(".outline-title[aria-current]")?.textContent).toBe("Deep child");
    await act(async () => toggle(host, "Child").click());
    expect(host.querySelector(".outline-title[aria-current]")?.textContent).toBe("Child");
    expect(children(toggle(host, "Child")).hidden).toBe(true);
    await act(async () => toggle(host, "Parent").click());
    expect(host.querySelector(".outline-title[aria-current]")?.textContent).toBe("Parent");
    await render(items, items[3].id);
    expect(host.querySelector(".outline-title[aria-current]")?.textContent).toBe("Next section");
    expect(children(toggle(host, "Parent")).hidden).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([
    ["en", "Collapse Parent", "Expand Parent"],
    ["zh-CN", "收起 Parent", "展开 Parent"],
    ["zh-TW", "收合 Parent", "展開 Parent"]
  ])("provides translated branch controls in %s", async (locale, collapse, expand) => {
    localStorage.setItem("webmd-notes-language", locale);
    const { host } = await renderOutline();
    const parent = toggle(host, "Parent");
    expect(parent.getAttribute("aria-label")).toBe(collapse);
    await act(async () => parent.click());
    expect(parent.getAttribute("aria-label")).toBe(expand);
  });

  it("shows the existing empty-state prompt without tree controls", async () => {
    const { host } = await renderOutline([]);
    expect(host.querySelector(".outline-empty")?.textContent).toBe("Add Markdown headings to see a live outline here.");
    expect(host.querySelector("button")).toBeNull();
  });
});
