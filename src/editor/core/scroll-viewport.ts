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
