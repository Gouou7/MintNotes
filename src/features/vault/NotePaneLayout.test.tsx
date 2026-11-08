import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NotePaneLayout } from "./NotePaneLayout";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("measures chrome, updates wrapping history/safe-area heights only on change, and preserves the scroll surface", async () => {
  const observers = new Map<Element, { resize: () => void; disconnect: () => void }>();
  vi.stubGlobal("ResizeObserver", class {
    constructor(readonly resize: () => void) {}
    observe(element: Element) { observers.set(element, this); }
    disconnect = vi.fn();
  });
  let headerHeight = 57;
  let footerHeight = 28;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { height: this.classList.contains("note-pane-top") ? headerHeight : footerHeight } as DOMRect;
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const area = createRef<HTMLDivElement>();
  const render = (history = false) => <NotePaneLayout editorArea={area} toolbar={<header>Title</header>}
    historyBanner={history ? <div>History</div> : null} status={<footer>Saved</footer>}><article>Body</article></NotePaneLayout>;
  let chromeObserver: ReturnType<typeof observers.get>;
  try {
    await act(async () => root.render(render()));
    const pane = host.querySelector<HTMLElement>("main")!;
    const scroller = area.current!;
    scroller.scrollTop = 300;
    chromeObserver = observers.get(pane.querySelector(".note-pane-top")!);
    expect(chromeObserver).toBeDefined();
    expect(observers.get(pane.querySelector(".note-pane-bottom")!)).toBe(chromeObserver);
    expect(pane.style.getPropertyValue("--editor-inset-top")).toBe("57px");
    expect(pane.style.getPropertyValue("--editor-inset-bottom")).toBe("28px");
    const write = vi.spyOn(pane.style, "setProperty");
    chromeObserver!.resize();
    expect(write).not.toHaveBeenCalled();
    headerHeight = 153;
    footerHeight = 68;
    await act(async () => root.render(render(true)));
    chromeObserver!.resize();
    expect(pane.style.getPropertyValue("--editor-inset-top")).toBe("153px");
    expect(pane.style.getPropertyValue("--editor-inset-bottom")).toBe("68px");
    expect(area.current).toBe(scroller);
    expect(scroller.scrollTop).toBe(300);
    headerHeight = 57;
    await act(async () => root.render(render()));
    chromeObserver!.resize();
    expect(pane.style.getPropertyValue("--editor-inset-top")).toBe("57px");
  } finally {
    await act(async () => root.unmount());
  }
  expect(chromeObserver!.disconnect).toHaveBeenCalledOnce();
});
