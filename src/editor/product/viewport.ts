/** A consumer's scroll surface and the chrome obscuring its top/bottom edges. */
export interface EditorScrollViewport {
  element: HTMLElement;
  top: number;
  bottom: number;
}

export function visibleScrollBounds({ element, top, bottom }: EditorScrollViewport): { top: number; bottom: number; height: number } {
  const rect = element.getBoundingClientRect();
  const start = rect.top + element.clientTop + Math.max(0, top);
  const end = Math.max(start, rect.top + element.clientTop + element.clientHeight - Math.max(0, bottom));
  return { top: start, bottom: end, height: end - start };
}

export function scrollTopForRect(viewport: EditorScrollViewport, rect: { top: number; bottom: number }, margin = 8): number {
  const bounds = visibleScrollBounds(viewport);
  const gap = Math.min(margin, bounds.height / 4);
  const delta = rect.top < bounds.top + gap
    ? rect.top - bounds.top - gap
    : rect.bottom > bounds.bottom - gap
      ? Math.min(rect.top - bounds.top - gap, rect.bottom - bounds.bottom + gap)
      : 0;
  const maximum = Math.max(0, viewport.element.scrollHeight - viewport.element.clientHeight);
  return Math.max(0, Math.min(maximum, viewport.element.scrollTop + delta));
}

export function revealScrollRect(viewport: EditorScrollViewport, rect: { top: number; bottom: number }): void {
  const top = scrollTopForRect(viewport, rect);
  if (top !== viewport.element.scrollTop) viewport.element.scrollTop = top;
}

/** Measure the native textarea's visual line without changing its value/selection. */
export function textareaCaretRect(textarea: HTMLTextAreaElement, offset: number): { top: number; bottom: number } | null {
  return textareaCaretRects(textarea, [offset])[0] ?? null;
}

/** Measure all source headings in one text mirror, rather than cloning the document per heading. */
export function textareaCaretRects(textarea: HTMLTextAreaElement, offsets: readonly number[]): ({ top: number; bottom: number } | null)[] {
  if (!offsets.length) return [];
  const rect = textarea.getBoundingClientRect();
  if (!textarea.isConnected || rect.width <= 0) return offsets.map(() => null);
  const style = getComputedStyle(textarea);
  const mirror = textarea.ownerDocument.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  for (const property of [
    "box-sizing", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-style", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "font-family", "font-size", "font-weight", "font-style", "font-variant", "font-stretch",
    "line-height", "letter-spacing", "word-spacing", "text-indent", "text-align", "text-transform",
    "direction", "white-space", "word-break", "overflow-wrap", "tab-size"
  ]) mirror.style.setProperty(property, style.getPropertyValue(property));
  Object.assign(mirror.style, {
    position: "fixed", left: "0", top: "0", visibility: "hidden", pointerEvents: "none",
    width: `${rect.width}px`, height: "auto", margin: "0"
  });
  const normalized = offsets.map(offset => Math.max(0, Math.min(offset, textarea.value.length)));
  const markers = new Map<number, HTMLSpanElement>();
  let cursor = 0;
  for (const at of [...new Set(normalized)].sort((left, right) => left - right)) {
    const marker = textarea.ownerDocument.createElement("span");
    marker.textContent = textarea.value.slice(at, at + 1) || "\u200b";
    mirror.append(textarea.value.slice(cursor, at), marker);
    markers.set(at, marker);
    cursor = at + 1;
  }
  mirror.append(textarea.value.slice(cursor));
  textarea.ownerDocument.body.append(mirror);
  try {
    const mirrorTop = mirror.getBoundingClientRect().top;
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const positions = new Map([...markers].map(([offset, marker]) => {
      const line = marker.getClientRects()[0];
      const top = line ? rect.top + line.top - mirrorTop - textarea.scrollTop : null;
      return [offset, top === null ? null : { top, bottom: top + lineHeight }] as const;
    }));
    return normalized.map(offset => positions.get(offset) ?? null);
  } finally {
    mirror.remove();
  }
}
