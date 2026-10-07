import { describe, expect, it } from "vitest";
import { scrollTopForRect, visibleScrollBounds } from "./viewport";

function viewport(top = 57, bottom = 28) {
  const element = document.createElement("div");
  Object.defineProperties(element, {
    clientHeight: { value: 600 }, scrollHeight: { value: 2000 }, scrollTop: { value: 400, writable: true }
  });
  element.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
  return { element, top, bottom };
}

describe("editor scroll viewport", () => {
  it("excludes both bars and a wrapping history banner", () => {
    expect(visibleScrollBounds(viewport())).toEqual({ top: 157, bottom: 672, height: 515 });
    expect(visibleScrollBounds(viewport(153))).toEqual({ top: 253, bottom: 672, height: 419 });
  });

  it("reveals the caret above or below the unobscured region, without moving an already visible caret", () => {
    const area = viewport();
    expect(scrollTopForRect(area, { top: 130, bottom: 150 })).toBe(365);
    expect(scrollTopForRect(area, { top: 665, bottom: 685 })).toBe(421);
    expect(scrollTopForRect(area, { top: 300, bottom: 320 })).toBe(400);
  });

  it("clamps at both document ends and handles a viewport shorter than its bars", () => {
    const area = viewport();
    expect(scrollTopForRect(area, { top: -1000, bottom: -980 })).toBe(0);
    expect(scrollTopForRect(area, { top: 5000, bottom: 5020 })).toBe(1400);
    expect(visibleScrollBounds(viewport(700, 100)).height).toBe(0);
    expect(Number.isFinite(scrollTopForRect(viewport(700, 100), { top: 10, bottom: 30 }))).toBe(true);
  });

});
