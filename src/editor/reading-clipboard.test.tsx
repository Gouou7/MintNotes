import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { ReadingEditor } from "./ReadingEditor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.replaceChildren(); document.getSelection()?.removeAllRanges(); });

async function setup(markdown: string) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const onSelectionChange = vi.fn();
  await act(async () => root.render(<I18nProvider><ReadingEditor markdown={markdown} onSelectionChange={onSelectionChange} /></I18nProvider>));
  const select = (start: Node, from: number, end: Node = start, to = start.textContent!.length) => {
    const range = document.createRange(); range.setStart(start, from); range.setEnd(end, to);
    document.getSelection()?.removeAllRanges(); document.getSelection()?.addRange(range);
  };
  const copy = async () => {
    const setData = vi.fn(); const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    await act(async () => { host.querySelector("article")!.dispatchEvent(event); });
    return { setData, event };
  };
  const leaf = (text: string) => [...host.querySelectorAll("[data-source-offsets]")].find((node) => node.textContent === text)?.firstChild as Text;
  return { host, root, select, copy, leaf, onSelectionChange };
}

describe("reading clipboard source provenance", () => {
  it.each([
    ["# title", "title", "title"],
    ["---\r\ntags: x\r\n---\r\n\r\n# title", "title", "title"],
    ["**same** and **same**", "same", "same"],
    ["\\*literal\\*", "*literal*", "\\*literal\\*"],
    ["a &amp; b", "a & b", "a &amp; b"],
    ["a\r\nb", "a\r\nb", "a\r\nb"],
    ["`code`", "code", "code"],
    ["`%%code%%`", "%%code%%", "%%code%%"],
    ["==highlight==", "highlight", "highlight"],
    ["[[target|label]]", "label", "label"],
    ["> [!note]\n> body", "body", "body"],
    ["> one\n> two", "one\ntwo", "one\n> two"],
  ])("copies exact source for %j", async (source, displayed, expected) => {
    const { root, leaf, select, copy } = await setup(source);
    expect(leaf(displayed), document.body.innerHTML).toBeTruthy(); select(leaf(displayed), 0);
    const { setData, event } = await copy();
    expect(event.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledExactlyOnceWith("text/plain", expected);
    await act(async () => root.unmount());
  });

  it("keeps only the selected portion of bold text", async () => {
    const { root, leaf, select, copy } = await setup("**abcdef**");
    select(leaf("abcdef"), 2, leaf("abcdef"), 4);
    expect((await copy()).setData).toHaveBeenCalledExactlyOnceWith("text/plain", "cd");
    await act(async () => root.unmount());
  });

  it("does not include a quote prefix after a selected newline", async () => {
    const { root, leaf, select, copy } = await setup("> one\n> two");
    select(leaf("one\ntwo"), 0, leaf("one\ntwo"), 4);
    expect((await copy()).setData).toHaveBeenCalledExactlyOnceWith("text/plain", "one\n");
    await act(async () => root.unmount());
  });

  it("copies all authored markers and comments between two visible endpoints", async () => {
    const source = "# one **bold**\n\ntwo %%hidden%% end";
    const { root, leaf, select, copy } = await setup(source);
    select(leaf("one "), 0, leaf("two  end"), "two  end".length);
    expect((await copy()).setData).toHaveBeenCalledExactlyOnceWith("text/plain", source.slice(2));
    await act(async () => root.unmount());
  });

  it("resolves a native element selection without adding heading markers", async () => {
    const { root, host, select, copy } = await setup("# title");
    const heading = host.querySelector("h1")!;
    select(heading, 0, heading, heading.childNodes.length);
    expect((await copy()).setData).toHaveBeenCalledExactlyOnceWith("text/plain", "title");
    await act(async () => root.unmount());
  });

  it("shows read-only source before accepting an unmappable rendered selection", async () => {
    const { root, host, select, copy } = await setup("# title");
    const unknown = document.createElement("span"); unknown.textContent = "unknown";
    host.querySelector("h1")!.append(unknown);
    select(unknown.firstChild!, 0);
    const { setData, event } = await copy();
    expect(event.defaultPrevented).toBe(true); expect(setData).not.toHaveBeenCalled();
    expect(host.querySelector(".reading-source-fallback")?.textContent).toBe("# title");
    expect(host.querySelector("textarea, [contenteditable=true]")).toBeNull();
    await act(async () => root.unmount());
  });
});
