import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollTopForRect, textareaCaretRects, visibleScrollBounds } from "./viewport";

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

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

  it("measures multiple source positions in one mirror and preserves source text, selection and offset order", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "## One\n\n#### Two";
    textarea.style.lineHeight = "20px";
    document.body.append(textarea);
    textarea.setSelectionRange(3, 6);
    textarea.getBoundingClientRect = () => ({ top: 100, width: 300 } as DOMRect);
    const append = vi.spyOn(document.body, "append");
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
      const siblings = [...this.parentElement!.childNodes];
      const at = siblings.slice(0, siblings.indexOf(this)).reduce((length, sibling) => length + (sibling.textContent?.length ?? 0), 0);
      return [{ top: at > 0 ? 60 : 20 }] as unknown as DOMRectList;
    });

    expect(textareaCaretRects(textarea, [8, 0, 8])).toEqual([
      { top: 160, bottom: 180 }, { top: 120, bottom: 140 }, { top: 160, bottom: 180 }
    ]);
    expect(append).toHaveBeenCalledTimes(1);
    const mirror = append.mock.calls[0][0] as HTMLElement;
    expect(mirror.textContent).toBe(textarea.value);
    expect(mirror.isConnected).toBe(false);
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([3, 6]);
  });

});
