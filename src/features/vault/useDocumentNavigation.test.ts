import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readScrollProgress,
  renderedHeadingElements,
  restoreScrollProgress,
  scrollElementToViewportPosition,
  sourceHeadingScrollTop,
  useDocumentNavigation
} from "./useDocumentNavigation";
import type { WorkspaceEditorMode } from "../../types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function dimensions(element: HTMLElement, values: Partial<Record<"scrollTop" | "scrollHeight" | "clientHeight", number>>): void {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(element, key, { configurable: true, writable: true, value });
  }
}

describe("document navigation", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures and restores scrollbar percentage", () => {
    const scroller = document.createElement("div");
    dimensions(scroller, { scrollTop: 300, scrollHeight: 1400, clientHeight: 400 });
    expect(readScrollProgress(scroller)).toBe(0.3);

    dimensions(scroller, { scrollHeight: 2400, clientHeight: 400 });
    restoreScrollProgress(scroller, 0.3);
    expect(scroller.scrollTop).toBe(600);
  });

  it("places a rendered heading at forty percent of the viewport", () => {
    const scroller = document.createElement("div");
    const heading = document.createElement("h2");
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo;
    dimensions(scroller, { scrollTop: 500, scrollHeight: 3000, clientHeight: 500 });
    scroller.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
    heading.getBoundingClientRect = () => ({ top: 900 } as DOMRect);

    scrollElementToViewportPosition(scroller, heading);

    expect(scrollTo).toHaveBeenCalledWith({ top: 1100, behavior: "smooth" });
  });

  it("keeps an actively edited live heading in the same outline order", () => {
    const area = document.createElement("div");
    area.innerHTML = `
      <div class="markdown-editor-host"><div class="ProseMirror">
        <h1>One</h1>
        <pre data-source-block="1" data-source-kind="heading-2"><code>## Two</code></pre>
        <p>Body</p>
        <h2>Three</h2>
      </div></div>`;
    expect(renderedHeadingElements(area).map((element) => element.textContent?.trim()))
      .toEqual(["One", "## Two", "Three"]);
  });

  it("estimates the source heading position around the same forty-percent band", () => {
    const textarea = document.createElement("textarea");
    textarea.value = Array.from({ length: 101 }, (_, index) => `line ${index}`).join("\n");
    dimensions(textarea, { scrollHeight: 2000, clientHeight: 500 });
    expect(sourceHeadingScrollTop(textarea, 50)).toBe(800);
  });

  it("restores the captured percentage after the editor mode remounts", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    let navigation!: ReturnType<typeof useDocumentNavigation>;
    function Harness({ mode }: { mode: WorkspaceEditorMode }) {
      navigation = useDocumentNavigation(mode);
      return createElement(
        "div",
        { ref: navigation.editorArea },
        mode === "source" ? createElement("textarea", { className: "source-editor" }) : undefined
      );
    }

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Harness, { mode: "source" })));
    const source = host.querySelector<HTMLTextAreaElement>(".source-editor")!;
    dimensions(source, { scrollTop: 300, scrollHeight: 1400, clientHeight: 400 });

    expect(navigation.prepareModeChange("readonly")).toBe(true);
    await act(async () => root.render(createElement(Harness, { mode: "readonly" })));
    const area = host.firstElementChild as HTMLElement;
    dimensions(area, { scrollTop: 0, scrollHeight: 2400, clientHeight: 400 });
    await act(async () => {
      frames.shift()?.(0);
      frames.shift()?.(0);
    });

    expect(area.scrollTop).toBe(600);
    await act(async () => root.unmount());
  });
});
