import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutlineItem } from "../../types";
import { trackActiveOutlineHeading } from "./outlineTracking";
import * as viewport from "../../editor/product/viewport";

const items: OutlineItem[] = [0, 1, 2].map(index => ({ id: `heading-${index}`, index, level: 2, text: `Title ${index}`, sourceOffset: index * 10, sourceLine: index * 2 }));
let frames: Map<number, FrameRequestCallback>;
let resizeCallback: ResizeObserverCallback;
let mutationCallback: MutationCallback;
let resizeDisconnect: ReturnType<typeof vi.fn>;
let mutationDisconnect: ReturnType<typeof vi.fn>;
const disposers: (() => void)[] = [];

function fixture(tops = [100, 1000, 1900]) {
  const area = document.createElement("div");
  area.innerHTML = `<div class="markdown-editor-host"><div class="ProseMirror">${tops.map((_, index) => `<h2>Title ${index}</h2>`).join("")}</div></div>`;
  document.body.append(area);
  Object.defineProperties(area, {
    clientHeight: { configurable: true, value: 600 }, scrollHeight: { configurable: true, value: 2800 },
    scrollTop: { configurable: true, writable: true, value: 0 }
  });
  area.style.scrollPaddingTop = "48px"; area.style.scrollPaddingBottom = "25px";
  area.getBoundingClientRect = vi.fn(() => ({ top: 50, height: 600 } as DOMRect));
  const headings = [...area.querySelectorAll<HTMLElement>("h2")];
  const measures = headings.map((heading, index) => vi.spyOn(heading, "getBoundingClientRect").mockImplementation(() => ({ top: 50 + tops[index] - area.scrollTop } as DOMRect)));
  const onChange = vi.fn();
  const dispose = trackActiveOutlineHeading(area, "live", items.slice(0, tops.length), onChange);
  disposers.push(dispose);
  const scroll = (position: number) => { area.scrollTop = position; area.dispatchEvent(new Event("scroll")); };
  return { area, headings, tops, onChange, measures, scroll, dispose };
}

function flushFrame() {
  const pending = [...frames.values()]; frames.clear();
  pending.forEach(callback => callback(performance.now()));
}

beforeEach(() => {
  vi.useFakeTimers();
  frames = new Map();
  let sequence = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++sequence, callback); return sequence; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  resizeDisconnect = vi.fn(); mutationDisconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
    observe = vi.fn(); unobserve = vi.fn(); disconnect = resizeDisconnect;
  });
  vi.stubGlobal("MutationObserver", class {
    constructor(callback: MutationCallback) { mutationCallback = callback; }
    observe = vi.fn(); disconnect = mutationDisconnect;
  });
});
afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose());
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  document.body.replaceChildren();
});

describe("outline scroll tracking", () => {
  it("tracks sections in both scroll directions, keeps the previous heading between sections, and handles fast jumps", () => {
    const { scroll, onChange } = fixture();
    flushFrame();
    expect(onChange).toHaveBeenLastCalledWith("heading-0");
    scroll(800); flushFrame();
    expect(onChange).toHaveBeenLastCalledWith("heading-1");
    scroll(1300); flushFrame();
    expect(onChange).toHaveBeenCalledTimes(2);
    scroll(1800); flushFrame();
    expect(onChange).toHaveBeenLastCalledWith("heading-2");
    scroll(0); flushFrame();
    expect(onChange).toHaveBeenLastCalledWith("heading-0");
  });

  it("coalesces scroll events into one frame without scanning or measuring headings again", () => {
    const { scroll, onChange, measures, area } = fixture();
    const query = vi.spyOn(area, "querySelector");
    flushFrame();
    measures.forEach(measure => measure.mockClear()); query.mockClear(); onChange.mockClear();
    for (let index = 0; index < 100; index++) scroll(800 + index);
    expect(frames.size).toBe(1);
    flushFrame();
    expect(onChange).toHaveBeenCalledExactlyOnceWith("heading-1");
    expect(query).not.toHaveBeenCalled();
    measures.forEach(measure => expect(measure).not.toHaveBeenCalled());
    scroll(900); flushFrame();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("selects a short final section at the bottom even if it cannot reach the reference line", () => {
    const { scroll, onChange } = fixture([100, 1000, 2700]);
    flushFrame(); scroll(2200); flushFrame();
    expect(onChange).toHaveBeenLastCalledWith("heading-2");
    scroll(2100); flushFrame();
    expect(onChange).toHaveBeenLastCalledWith("heading-1");
  });

  it("batches layout changes and refreshes cached positions after image or text changes", () => {
    const { tops, scroll, onChange, measures } = fixture();
    flushFrame(); scroll(800); flushFrame();
    tops[1] = 1600;
    measures.forEach(measure => measure.mockClear());
    for (let index = 0; index < 20; index++) {
      resizeCallback([], {} as ResizeObserver);
      mutationCallback([], {} as MutationObserver);
    }
    flushFrame();
    measures.forEach(measure => expect(measure).not.toHaveBeenCalled());
    vi.advanceTimersByTime(120); flushFrame();
    expect(onChange).toHaveBeenLastCalledWith("heading-0");
    measures.forEach(measure => expect(measure).toHaveBeenCalledTimes(1));
  });

  it("handles a note with no rendered headings", () => {
    const { headings, onChange } = fixture();
    headings.forEach(heading => heading.remove());
    flushFrame();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("measures source headings as a single batch and tracks source scrolling from that cache", () => {
    const { area, scroll, onChange, dispose } = fixture();
    dispose();
    const source = document.createElement("textarea");
    source.className = "typora-web-source";
    source.value = "## One\n\n## Two\n\n## Three";
    area.append(source);
    const measure = vi.spyOn(viewport, "textareaCaretRects").mockReturnValue([{ top: 150, bottom: 170 }, { top: 1050, bottom: 1070 }, { top: 1950, bottom: 1970 }]);
    disposers.push(trackActiveOutlineHeading(area, "source", items, onChange));
    flushFrame();
    expect(measure).toHaveBeenCalledExactlyOnceWith(source, items.map(item => item.sourceOffset));
    scroll(800); flushFrame();
    expect(onChange).toHaveBeenLastCalledWith("heading-1");
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("pauses geometry work in a background tab and refreshes it on return", () => {
    const { scroll, onChange, measures } = fixture();
    flushFrame();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    scroll(1800); resizeCallback([], {} as ResizeObserver);
    expect(frames.size).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange")); flushFrame();
    expect(onChange).toHaveBeenLastCalledWith("heading-2");
    measures.forEach(measure => expect(measure).toHaveBeenCalledTimes(2));
  });

  it("cancels pending frames, delayed measurements, observers and listeners when disposed", () => {
    const { dispose, scroll, onChange } = fixture();
    flushFrame();
    resizeCallback([], {} as ResizeObserver); flushFrame();
    scroll(800); dispose();
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(resizeDisconnect).toHaveBeenCalled(); expect(mutationDisconnect).toHaveBeenCalled();
    scroll(1800); flushFrame();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
