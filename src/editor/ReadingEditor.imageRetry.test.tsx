import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { ReadingEditor } from "./ReadingEditor";
import { IMAGE_RECONNECT_RETRY_INTERVAL_MS } from "./core/image-reconnect-retry";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount(); });
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});

async function setup(markdown: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const render = async (source: string) => act(async () => root.render(
    <I18nProvider><ReadingEditor markdown={source} /></I18nProvider>
  ));
  await render(markdown);
  return { host, root, render };
}

describe("reading image reconnect retries", () => {
  it("retries failures without reloading successful images, attachments or the reading selection", async () => {
    const { host, root } = await setup("before ![failed](https://images.example.test/failed.png) ![loaded](https://images.example.test/loaded.png) after");
    const [failed, loaded] = [...host.querySelectorAll("img")];
    const retry = vi.spyOn(failed, "setAttribute");
    const untouched = vi.spyOn(loaded, "setAttribute");
    failed.dispatchEvent(new Event("error"));
    loaded.dispatchEvent(new Event("load"));
    const paragraph = host.querySelector("p")!;
    const selection = document.getSelection()!;
    const text = paragraph.querySelector("[data-source-offsets]")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 3);
    selection.removeAllRanges();
    selection.addRange(range);
    window.dispatchEvent(new Event("online"));

    expect(retry).toHaveBeenCalledExactlyOnceWith("src", "https://images.example.test/failed.png");
    expect(untouched).not.toHaveBeenCalled();
    expect(failed.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(selection.getRangeAt(0).startContainer).toBe(text);
    expect(selection.getRangeAt(0).startOffset).toBe(0);
    expect(selection.getRangeAt(0).endContainer).toBe(text);
    expect(selection.getRangeAt(0).endOffset).toBe(3);
    expect(selection.toString()).toBe("bef");
    failed.dispatchEvent(new Event("load"));
    window.dispatchEvent(new Event("online"));
    expect(retry).toHaveBeenCalledTimes(1);

    const attachmentId = "11111111-1111-4111-8111-111111111111";
    await act(async () => root.render(<I18nProvider><ReadingEditor
      markdown={`![local](webmd-attachment:${attachmentId})`}
      attachmentUrls={new Map([[attachmentId, "blob:http://localhost/attachment"]])}
    /></I18nProvider>));
    const attachment = host.querySelector("img")!;
    const reloadAttachment = vi.spyOn(attachment, "setAttribute");
    attachment.dispatchEvent(new Event("error"));
    window.dispatchEvent(new Event("online"));
    expect(reloadAttachment).not.toHaveBeenCalled();
  });

  it("coalesces repeated reconnect signals without continuously retrying errors", async () => {
    vi.useFakeTimers();
    const { host } = await setup("![photo](https://images.example.test/retry.png)");
    const image = host.querySelector("img")!;
    const reload = vi.spyOn(image, "setAttribute");
    image.dispatchEvent(new Event("error"));
    window.dispatchEvent(new Event("online"));
    image.dispatchEvent(new Event("error"));
    for (let i = 0; i < 10; i++) window.dispatchEvent(new Event("online"));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(IMAGE_RECONNECT_RETRY_INTERVAL_MS);
    expect(reload).toHaveBeenCalledTimes(2);
    image.dispatchEvent(new Event("error"));
    vi.advanceTimersByTime(60_000);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it.each(["replace", "hide", "unmount"])("drops queued image retries when the reading surface is %s", async (operation) => {
    vi.useFakeTimers();
    const { host, root, render } = await setup("![old](https://images.example.test/old.png)");
    const oldImage = host.querySelector("img")!;
    const oldReload = vi.spyOn(oldImage, "setAttribute");
    oldImage.dispatchEvent(new Event("error"));
    window.dispatchEvent(new Event("online"));
    oldImage.dispatchEvent(new Event("error"));
    window.dispatchEvent(new Event("online"));
    if (operation === "replace") await render("![new](https://images.example.test/new.png)");
    if (operation === "hide") host.hidden = true;
    if (operation === "unmount") {
      await act(async () => root.unmount());
      roots.splice(roots.indexOf(root), 1);
    }
    oldReload.mockClear();
    vi.advanceTimersByTime(IMAGE_RECONNECT_RETRY_INTERVAL_MS);
    window.dispatchEvent(new Event("online"));
    expect(oldReload).not.toHaveBeenCalled();
    if (operation === "replace") expect(host.querySelector("img")?.getAttribute("src")).toBe("https://images.example.test/new.png");
  });
});
