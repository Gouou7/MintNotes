import type { EditorView } from "prosemirror-view";
import type { SourcePositionMap } from "./source-position-map";
import type { SourceSelection, SourceTransaction } from "./source";

export function nativeReplacementText(event: InputEvent): string | null {
  if (["insertText", "insertReplacementText"].includes(event.inputType)) {
    return event.data ?? event.dataTransfer?.getData("text/plain") ?? null;
  }
  return event.inputType.startsWith("delete") ? "" : null;
}

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
    const rawFrom = view.posAtDOM(range.startContainer, range.startOffset, 1);
    const collapsed = range.startContainer === range.endContainer && range.startOffset === range.endOffset;
    const rawTo = collapsed ? rawFrom : view.posAtDOM(range.endContainer, range.endOffset, -1);
    if (rawFrom > rawTo || !positions.hasExactDocumentBoundary(rawFrom) || !positions.hasExactDocumentBoundary(rawTo)) return null;
    const from = positions.nativeInputBoundary(rawFrom, "left");
    const to = collapsed ? from : positions.nativeInputBoundary(rawTo, "right");
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
    const selection = view.dom.ownerDocument.getSelection();
    const native = selection?.rangeCount
      ? exactNativeRange(view, selection.getRangeAt(0), positions) : null;
    if (native) {
      if (event.inputType === "insertReplacementText" && native.from === native.to) return null;
      return native;
    }
    // A replacement without a target or selection must not become an append.
    if (event.inputType === "insertReplacementText" && view.state.selection.empty) return null;
    if (!positions.hasExactDocumentBoundary(view.state.selection.from)
      || !positions.hasExactDocumentBoundary(view.state.selection.to)) return null;
    const from = positions.nativeInputBoundary(view.state.selection.from, "left");
    return { from, to: view.state.selection.empty ? from : positions.nativeInputBoundary(view.state.selection.to, "right") };
  }
  if (ranges.length !== 1) return null;
  return exactNativeRange(view, ranges[0]!, positions);
}

export function nativeSourceTextTransaction(
  view: EditorView, event: InputEvent, positions: SourcePositionMap,
  text: string, origin: SourceTransaction["origin"],
): SourceTransaction | null {
  const target = nativeTextInputRange(view, event, positions);
  if (!target) return null;
  const from = positions.documentToSource(target.from, "right");
  const to = target.from === target.to ? from : positions.documentToSource(target.to, "left");
  const head = from + text.length;
  return { edits: [{ from, to, insert: text }], selection: { anchor: head, head },
    origin, reparseDerivedDocument: true };
}
