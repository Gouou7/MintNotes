import type { EditorView } from "prosemirror-view";
import type { SourcePositionMap } from "./source-position-map";

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
  const range = ranges[0]!;
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
