import { editorScrollViewport } from "../../editor/product/scrollViewport";
import { textareaCaretRects } from "../../editor/product/viewport";
import type { OutlineItem, WorkspaceEditorMode } from "../../types";
import { documentScrollElement, HEADING_VIEWPORT_POSITION, renderedHeadingElements } from "./useDocumentNavigation";

const MEASUREMENT_INTERVAL_MS = 120;
interface HeadingPosition { id: string; top: number }
interface HeadingGeometry {
  scroller: HTMLElement;
  positions: HeadingPosition[];
  referenceLine: number;
  maximum: number;
}

function measureHeadings(area: HTMLElement, mode: WorkspaceEditorMode, items: readonly OutlineItem[]): HeadingGeometry {
  const scroller = documentScrollElement(area);
  const viewport = editorScrollViewport(scroller);
  const origin = scroller.getBoundingClientRect().top + scroller.clientTop;
  const scrollTop = scroller.scrollTop;
  const source = mode === "source" ? area.querySelector<HTMLTextAreaElement>(".typora-web-source:not([hidden]), .source-editor") : null;
  const headings = source ? [] : renderedHeadingElements(area);
  const sourceRects = source ? textareaCaretRects(source, items.map(item => item.sourceOffset)) : [];
  const positions: HeadingPosition[] = [];
  for (const [index, item] of items.entries()) {
    const rect = source ? sourceRects[index] : headings[item.index]?.getBoundingClientRect();
    if (rect) positions.push({ id: item.id, top: scrollTop + rect.top - origin });
  }
  return {
    scroller, positions,
    referenceLine: viewport.top + Math.max(0, scroller.clientHeight - viewport.top - viewport.bottom) * HEADING_VIEWPORT_POSITION,
    maximum: Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  };
}

function activeHeading(geometry: HeadingGeometry): string | null {
  const { positions, scroller, referenceLine, maximum } = geometry;
  if (!positions.length) return null;
  // A short last section may never reach the reference line before the scrollbar ends.
  if (maximum > 0 && scroller.scrollTop >= maximum - 1) return positions.at(-1)!.id;
  const position = scroller.scrollTop + referenceLine + 1;
  let lower = 0, upper = positions.length;
  while (lower < upper) {
    const middle = (lower + upper) >>> 1;
    if (positions[middle].top <= position) lower = middle + 1; else upper = middle;
  }
  return positions[Math.max(0, lower - 1)].id;
}

/** Scroll frames only read scrollTop and search cached geometry; they never scan heading DOM. */
export function trackActiveOutlineHeading(
  area: HTMLElement, mode: WorkspaceEditorMode, items: readonly OutlineItem[], onChange: (id: string | null) => void
): () => void {
  let geometry: HeadingGeometry | null = null;
  let frame = 0, timer = 0, lastMeasurement = -Infinity;
  let dirty = true, disposed = false;
  let previousId: string | null | undefined;
  const observed = new Set<Element>();
  const resize = new ResizeObserver(() => invalidate());

  const schedule = () => {
    if (!disposed && !document.hidden && !frame) frame = window.requestAnimationFrame(update);
  };
  const invalidate = () => {
    dirty = true;
    schedule();
  };
  const update = () => {
    frame = 0;
    if (disposed || document.hidden) return;
    if (dirty) {
      const remaining = MEASUREMENT_INTERVAL_MS - (performance.now() - lastMeasurement);
      if (remaining <= 0 || !geometry) {
        if (timer) { window.clearTimeout(timer); timer = 0; }
        geometry = measureHeadings(area, mode, items);
        lastMeasurement = performance.now();
        dirty = false;
        const targets = [area, area.firstElementChild, ...(area.parentElement?.querySelectorAll(".note-pane-top, .note-pane-bottom") ?? [])].filter((target): target is Element => target !== null);
        for (const target of observed) if (!targets.includes(target)) { resize.unobserve(target); observed.delete(target); }
        for (const target of targets) if (!observed.has(target)) { resize.observe(target); observed.add(target); }
      } else {
        if (!timer) timer = window.setTimeout(() => { timer = 0; schedule(); }, remaining);
        // Layout/scroll anchoring can move many headings at once. Don't publish an obsolete position.
        return;
      }
    }
    if (!geometry) return;
    const id = activeHeading(geometry);
    if (id !== previousId) { previousId = id; onChange(id); }
  };

  const mutations = new MutationObserver(invalidate);
  mutations.observe(area, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
  if (area.parentElement) mutations.observe(area.parentElement, { attributes: true, attributeFilter: ["style"] });
  area.addEventListener("scroll", schedule, { passive: true, capture: true });
  area.addEventListener("input", invalidate);
  area.addEventListener("load", invalidate, true);
  window.addEventListener("resize", invalidate, { passive: true });
  document.addEventListener("visibilitychange", invalidate);
  document.fonts?.addEventListener("loadingdone", invalidate);
  schedule();

  return () => {
    disposed = true;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    resize.disconnect();
    mutations.disconnect();
    area.removeEventListener("scroll", schedule, true);
    area.removeEventListener("input", invalidate);
    area.removeEventListener("load", invalidate, true);
    window.removeEventListener("resize", invalidate);
    document.removeEventListener("visibilitychange", invalidate);
    document.fonts?.removeEventListener("loadingdone", invalidate);
  };
}
