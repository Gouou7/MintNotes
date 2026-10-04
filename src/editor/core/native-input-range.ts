import type { EditorView } from "prosemirror-view";
import type { SourcePositionMap } from "./source-position-map";
import type { SourceSelection } from "./source";

function exactNativeRange(
  view: EditorView,
  range: Pick<StaticRange, "startContainer" | "startOffset" | "endContainer" | "endOffset">,
  positions: SourcePositionMap,
): { from: number; to: number } | null {
  for (const node of [range.startContainer, range.endContainer]) {
    if (!view.dom.contains(node)) return null;
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    if (element?.closest('[contenteditable="false"]')) return null;
  }
  try {
    const from = view.posAtDOM(range.startContainer, range.startOffset, 1);
    const collapsed = range.startContainer === range.endContainer && range.startOffset === range.endOffset;
    const to = collapsed ? from : view.posAtDOM(range.endContainer, range.endOffset, -1);
    if (from > to || !positions.hasExactDocumentBoundary(from) || !positions.hasExactDocumentBoundary(to)) return null;
    if (positions.documentToSource(from, "right") > positions.documentToSource(to, collapsed ? "right" : "left")) return null;
    return { from, to };
  } catch {
    return null;
  }
}

/** Selectionchange may still be queued when the browser starts composition. */
export function nativeSourceSelection(view: EditorView, positions: SourcePositionMap): SourceSelection | null {
  const selection = view.dom.ownerDocument.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const target = exactNativeRange(view, range, positions);
  if (!target) return null;
  const from = positions.documentToSource(target.from, "right");
  const to = target.from === target.to ? from : positions.documentToSource(target.to, "left");
  const forward = selection.anchorNode === range.startContainer && selection.anchorOffset === range.startOffset;
  return forward ? { anchor: from, head: to } : { anchor: to, head: from };
}

/** null means the browser's edit cannot safely be applied to the Live projection. */
export function nativeTextInputRange(
  view: EditorView,
  event: InputEvent,
  positions: SourcePositionMap,
): { from: number; to: number } | null {
  const ranges = event.getTargetRanges?.() ?? [];
  if (!ranges.length) {
    // A replacement without a target or selection must not become an append.
    if (event.inputType === "insertReplacementText" && view.state.selection.empty) return null;
    return { from: view.state.selection.from, to: view.state.selection.to };
  }
  if (ranges.length !== 1) return null;
  return exactNativeRange(view, ranges[0]!, positions);
}
