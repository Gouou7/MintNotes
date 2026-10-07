import type { Node as PMNode, ResolvedPos } from "prosemirror-model";
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { splitBlock } from "prosemirror-commands";
import { closeHistory } from "prosemirror-history";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { MintContext } from "./context.ts";
import { focusCodeLanguage } from "../features/fenced-code.ts";

interface CalloutState { titleFocus: number | null; reveal: readonly number[]; drafts: Set<number> }
interface CalloutMeta { titleFocus?: number | null; reveal?: number | number[]; commit?: number }
interface HorizontalNavigation { direction: -1 | 1; origin: number }
export const calloutKey = new PluginKey<CalloutState>("mintCallout");
export const calloutLine = (node: PMNode) => node.firstChild?.type.name === "paragraph" ? node.firstChild.textContent.split("\n")[0] : "";
export const isCallout = (node: PMNode | null | undefined, context: MintContext) => node?.type.name === "blockquote" && !!context.parseCallout?.(calloutLine(node));
export const isCalloutDraft = (state: EditorState, pos: number) => calloutKey.getState(state)?.drafts.has(pos) ?? false;

function focusDocument(view: EditorView): void {
  // Selection routing may have focused a nested block's native title input.
  const active = view.dom?.ownerDocument.activeElement;
  if (!active?.matches("input:not([hidden])") || !view.dom.contains(active)) view.focus?.();
}

/** Both a shared marker/body paragraph and separate paragraphs remain valid. */
export function calloutBody(doc: PMNode, pos: number): { start: number; end: number } | null {
  const node = doc.nodeAt(pos), first = node?.firstChild;
  if (!node || !first) return null;
  const newline = first.textContent.indexOf("\n");
  if (newline < 0 && node.childCount === 1) return null;
  const start = newline >= 0 ? pos + 3 + newline : TextSelection.findFrom(doc.resolve(pos + 1 + first.nodeSize), 1, true)?.from;
  const end = TextSelection.findFrom(doc.resolve(pos + node.nodeSize - 1), -1, true)?.from;
  return start !== undefined && end !== undefined && start <= end ? { start, end } : null;
}

export function focusCalloutTitle(view: EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos); if (!node) return false;
  const parked = calloutBody(view.state.doc, pos)?.start ?? pos + 2 + calloutLine(node).length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, parked)).setMeta(calloutKey, { titleFocus: pos }));
  return true;
}

function horizontalBodySelection(doc: PMNode, pos: number, atEnd = false): Selection | null {
  const node = doc.nodeAt(pos), first = node?.firstChild; if (!node || !first) return null;
  const newline = first.textContent.indexOf("\n");
  const start = newline >= 0 ? TextSelection.create(doc, pos + 3 + newline) : Selection.findFrom(doc.resolve(pos + 1 + first.nodeSize), 1);
  if (!start || start.from >= pos + node.nodeSize - 1) return null;
  return atEnd ? Selection.findFrom(doc.resolve(pos + node.nodeSize - 1), -1) : start;
}

export function enterCalloutBody(view: EditorView, pos: number, atEnd = false, horizontal = false): boolean {
  const node = view.state.doc.nodeAt(pos); if (!node || view.editable === false) return false;
  const tr = view.state.tr;
  const bodySelection = () => {
    if (horizontal) return horizontalBodySelection(tr.doc, pos, atEnd);
    const body = calloutBody(tr.doc, pos);
    return body ? TextSelection.create(tr.doc, atEnd ? body.end : body.start) : null;
  };
  let target = bodySelection();
  if (!target) {
    const paragraph = view.state.schema.nodes.paragraph.createAndFill(); if (!paragraph) return false;
    tr.insert(pos + node.nodeSize - 1, paragraph).setMeta("addToHistory", false).setMeta("mint-presentation-only", true);
    target = bodySelection();
  }
  if (!target) return false;
  tr.setSelection(target);
  if (horizontal) tr.setMeta("mint-horizontal-navigation", { direction: atEnd ? -1 : 1, origin: pos });
  view.dispatch(tr.setMeta(calloutKey, { titleFocus: null, reveal: pos, commit: pos }).scrollIntoView());
  focusDocument(view); return true;
}

export function leaveCallout(view: EditorView, pos: number, direction: -1 | 1, context: MintContext, horizontal = false): boolean {
  const node = view.state.doc.nodeAt(pos); if (!node) return false;
  const boundary = direction < 0 ? pos : pos + node.nodeSize, $boundary = view.state.doc.resolve(boundary);
  const neighbor = direction < 0 ? $boundary.nodeBefore : $boundary.nodeAfter;
  if (isCallout(neighbor, context)) {
    const nextPos = direction < 0 ? pos - neighbor!.nodeSize : boundary;
    return direction < 0 || horizontal ? enterCalloutBody(view, nextPos, direction < 0, horizontal) : focusCalloutTitle(view, nextPos);
  }
  if (!horizontal && direction > 0 && neighbor?.type.name === "code_block") return focusCodeLanguage(view, boundary);
  const tr = view.state.tr.setMeta(calloutKey, { titleFocus: null });
  if (horizontal) tr.setMeta("mint-horizontal-navigation", { direction, origin: pos });
  if (neighbor) tr.setSelection(TextSelection.near($boundary, direction));
  else {
    const paragraph = view.state.schema.nodes.paragraph.createAndFill();
    if (!paragraph || !$boundary.parent.canReplaceWith($boundary.index(), $boundary.index(), paragraph.type)) return false;
    tr.insert(boundary, paragraph); tr.setSelection(TextSelection.create(tr.doc, boundary + 1));
  }
  view.dispatch(tr.scrollIntoView()); focusDocument(view); return true;
}

function containingCallouts(state: EditorState, context: MintContext, $from: ResolvedPos = state.selection.$from): number[] {
  const positions: number[] = [];
  for (let depth = $from.parent.isTextblock ? $from.depth - 1 : $from.depth; depth > 0; depth--) {
    const pos = $from.before(depth);
    if (isCallout($from.node(depth), context) && !isCalloutDraft(state, pos)) positions.push(pos);
  }
  return positions;
}

function containingCallout(state: EditorState, context: MintContext): number | null {
  return containingCallouts(state, context)[0] ?? null;
}

function horizontalTarget(state: EditorState, tr: Transaction, target: Selection | null, direction: -1 | 1, context: MintContext): Selection | null {
  while (target instanceof TextSelection) {
    const nextPos = containingCallouts(state, context, target.$from)[0];
    if (nextPos === undefined) break;
    const node = tr.doc.nodeAt(nextPos)!;
    if (target.from > nextPos + 2 + calloutLine(node).length) break;
    if (direction < 0) target = Selection.findFrom(tr.doc.resolve(nextPos), direction);
    else {
      let body = horizontalBodySelection(tr.doc, nextPos);
      if (!body) {
        const paragraph = state.schema.nodes.paragraph.createAndFill(); if (!paragraph) return null;
        const presentationOnly = !tr.docChanged;
        tr.insert(nextPos + node.nodeSize - 1, paragraph);
        if (presentationOnly) tr.setMeta("addToHistory", false).setMeta("mint-presentation-only", true);
        body = horizontalBodySelection(tr.doc, nextPos);
      }
      if (!body) return null;
      target = body;
    }
  }
  return target;
}

/** Horizontal arrows cross visible bodies, including selected block atoms. */
function moveCalloutHorizontally(view: EditorView, direction: -1 | 1, context: MintContext): boolean {
  const state = view.state, selection = state.selection, $from = selection.$from;
  const text = selection instanceof TextSelection && selection.empty, block = selection instanceof NodeSelection && selection.node.isBlock;
  if ((!text && !block) || calloutKey.getState(state)?.titleFocus != null) return false;
  const source = containingCallouts(state, context), pos = source[0];
  const atBodyStart = text && direction < 0 && pos !== undefined && selection.from === horizontalBodySelection(state.doc, pos)?.from;
  const atTextEdge = text && $from.depth > 0 && $from.parentOffset === (direction < 0 ? 0 : $from.parent.content.size);
  if (!block && !atBodyStart && !atTextEdge) return false;
  const tr = state.tr, boundary = block ? direction < 0 ? selection.from : selection.to : atBodyStart ? pos : direction < 0 ? $from.before() : $from.after();
  const initial = Selection.findFrom(tr.doc.resolve(boundary), direction), target = horizontalTarget(state, tr, initial, direction, context);
  const skippedMarker = atBodyStart || target !== initial;
  // At the document start, keep the caret in the body rather than its marker.
  if (!target) return skippedMarker;
  const destination = containingCallouts(state, context, target.$from);
  if (!skippedMarker && source.length === destination.length && source.every(position => destination.includes(position))) return false;
  view.dispatch(tr.setSelection(target).setMeta(calloutKey, { titleFocus: null, reveal: destination }).scrollIntoView());
  focusDocument(view); return true;
}

function emptyCalloutBody(node: PMNode): boolean {
  const first = node.firstChild!;
  if (first.textContent.includes("\n")) return node.childCount === 1 && first.content.size === calloutLine(node).length + 1;
  return node.childCount === 1 || node.childCount === 2 && node.child(1).type.name === "paragraph" && node.child(1).content.size === 0;
}

function dispatchCalloutBackspace(view: EditorView, tr: Transaction, context: MintContext, target = tr.selection): boolean {
  const edited = tr.docChanged;
  const visible = horizontalTarget(view.state, tr, target, 1, context); if (!visible) return false;
  tr.setSelection(visible).setMeta(calloutKey, { titleFocus: null, reveal: containingCallouts(view.state, context, visible.$from) }).scrollIntoView();
  view.dispatch(edited ? closeHistory(tr) : tr);
  if (edited) view.dispatch(closeHistory(view.state.tr));
  focusDocument(view); return true;
}

function deleteCallout(view: EditorView, pos: number, context: MintContext): boolean {
  const node = view.state.doc.nodeAt(pos); if (!node) return false;
  return dispatchCalloutBackspace(view, view.state.tr.delete(pos, pos + node.nodeSize), context);
}

function backspaceCallout(view: EditorView, context: MintContext): boolean {
  const state = view.state, selection = state.selection, $from = selection.$from;
  if (!(selection instanceof TextSelection) || !selection.empty || !$from.depth || calloutKey.getState(state)?.titleFocus != null) return false;
  if ($from.parent.type.name === "code_block") return false;
  const pos = containingCallout(state, context);
  if (pos !== null && selection.from > pos + 2 + calloutLine(state.doc.nodeAt(pos)!).length) {
    if (emptyCalloutBody(state.doc.nodeAt(pos)!)) return deleteCallout(view, pos, context);
    // The first body boundary must not delete the hidden marker or enter its title.
    if ($from.node(-1) === state.doc.nodeAt(pos) && selection.from === horizontalBodySelection(state.doc, pos)?.from) return true;
  }
  if ($from.parentOffset !== 0) return false;
  const boundary = $from.before(), previous = state.doc.resolve(boundary).nodeBefore;
  if (!isCallout(previous, context)) return false;
  const previousPos = boundary - previous!.nodeSize;
  if (isCalloutDraft(state, previousPos)) return false;
  if (emptyCalloutBody(previous!)) return deleteCallout(view, previousPos, context);
  const tr = state.tr;
  if ($from.parent.type.name === "paragraph" && !$from.parent.content.size) tr.delete(boundary, $from.after());
  const end = horizontalBodySelection(tr.doc, previousPos, true);
  return end ? dispatchCalloutBackspace(view, tr, context, end) : false;
}

export function calloutBehavior(context: MintContext): Plugin<CalloutState> {
  return new Plugin<CalloutState>({
    key: calloutKey,
    state: {
      init: () => ({ titleFocus: null, reveal: [], drafts: new Set() }),
      apply(tr, previous, oldState) {
        const meta = tr.getMeta(calloutKey) as CalloutMeta | undefined;
        const drafts = new Set<number>();
        for (const oldPos of previous.drafts) {
          const mapped = tr.mapping.mapResult(oldPos, 1);
          if (!mapped.deleted && isCallout(tr.doc.nodeAt(mapped.pos), context)) drafts.add(mapped.pos);
        }
        if (tr.docChanged) tr.doc.descendants((node, pos) => {
          if (!isCallout(node, context) || calloutBody(tr.doc, pos)) return true;
          const oldPos = tr.mapping.invert().map(pos, 1);
          if (!isCallout(oldState.doc.nodeAt(oldPos), context)) drafts.add(pos);
          return true;
        });
        if (meta?.commit !== undefined) drafts.delete(meta.commit);
        if (tr.selectionSet) for (const pos of drafts) {
          const node = tr.doc.nodeAt(pos)!;
          if (tr.selection.from < pos + 1 || tr.selection.to > pos + node.nodeSize - 1) drafts.delete(pos);
        }
        let titleFocus = tr.selectionSet ? null : previous.titleFocus === null ? null : tr.mapping.map(previous.titleFocus);
        if (meta?.titleFocus !== undefined) titleFocus = meta.titleFocus;
        if (context.readOnly || titleFocus !== null && !isCallout(tr.doc.nodeAt(titleFocus), context)) titleFocus = null;
        const reveal = meta?.reveal;
        return { titleFocus, reveal: reveal === undefined ? [] : Array.isArray(reveal) ? reveal : [reveal], drafts };
      },
    },
    appendTransaction(_transactions, _oldState, state) {
      const horizontal = _transactions.map(transaction => transaction.getMeta("mint-horizontal-navigation") as HorizontalNavigation | undefined).find(request => request?.direction === -1 || request?.direction === 1);
      if (!context.readOnly && horizontal !== undefined) {
        const tr = state.tr;
        let target = horizontalTarget(state, tr, state.selection, horizontal.direction, context);
        // At a document edge, leave the input into its own visible body.
        if (!target) {
          const node = tr.doc.nodeAt(horizontal.origin);
          const fallback = node?.type.name === "code_block" ? horizontal.origin + 1 : isCallout(node, context) ? horizontal.origin + 2 + calloutLine(node!).length : null;
          if (fallback !== null) target = horizontalTarget(state, tr, TextSelection.create(tr.doc, fallback), 1, context);
        }
        if (!target) return null;
        const reveal = containingCallouts(state, context, target.$from);
        if (!tr.docChanged && target.eq(state.selection) && !reveal.length) return null;
        return tr.setSelection(target).setMeta(calloutKey, { titleFocus: null, reveal }).scrollIntoView();
      }
      if (!_transactions.some(transaction => transaction.selectionSet || transaction.docChanged) || state.selection.eq(_oldState.selection)) return null;
      if (context.readOnly || !(state.selection instanceof TextSelection) || !state.selection.empty || calloutKey.getState(state)?.titleFocus !== null) return null;
      const pos = containingCallout(state, context); if (pos === null) return null;
      const markerEnd = pos + 2 + calloutLine(state.doc.nodeAt(pos)!).length;
      if (state.selection.from > markerEnd) return null;
      let oldPos = pos;
      for (let index = _transactions.length - 1; index >= 0; index--) oldPos = _transactions[index].mapping.invert().map(oldPos, 1);
      const oldNode = _oldState.doc.nodeAt(oldPos);
      if (_transactions.some(transaction => transaction.docChanged) && isCallout(oldNode, context) && _oldState.selection.from > oldPos + 2 + calloutLine(oldNode!).length) {
        const tr = state.tr, target = horizontalTarget(state, tr, state.selection, 1, context);
        if (!target) return null;
        // The placeholder belongs to the same undo event as the body deletion.
        return tr.setSelection(target).setMeta("addToHistory", true).setMeta(calloutKey, { titleFocus: null, reveal: containingCallouts(state, context, target.$from) });
      }
      const parked = calloutBody(state.doc, pos)?.start ?? markerEnd;
      return state.tr.setSelection(TextSelection.create(state.doc, parked)).setMeta(calloutKey, { titleFocus: pos });
    },
    props: {
      handleDOMEvents: {
        focus(view) {
          if (context.readOnly || view.editable === false || !view.state.selection.empty) return false;
          const pos = containingCallout(view.state, context);
          if (pos === null || view.state.selection.from > pos + 2 + calloutLine(view.state.doc.nodeAt(pos)!).length) return false;
          focusCalloutTitle(view, pos); return true;
        },
      },
      handleKeyDown(view, event) {
        if (context.readOnly || view.editable === false || view.composing || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
        const state = view.state, selection = state.selection, $from = selection.$from;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") return moveCalloutHorizontally(view, event.key === "ArrowLeft" ? -1 : 1, context);
        if (event.key === "Backspace" && backspaceCallout(view, context)) return true;
        // Code blocks keep their own language/body navigation, even inside a Callout.
        if ($from.parent.type.name === "code_block") return false;
        if (event.key === "Enter" && selection.empty && $from.parent.type.name === "paragraph") {
          // Batched input/paste may still have the initial quote prefix.
          const candidate = /^>\s+(.+)$/.exec($from.parent.textContent);
          if (candidate && context.parseCallout?.(candidate[1])) {
            const marker = state.schema.nodes.paragraph.create(null, state.schema.text(candidate[1]));
            const body = state.schema.nodes.paragraph.create(), quote = state.schema.nodes.blockquote.create(null, [marker, body]), pos = $from.before();
            const tr = closeHistory(state.tr.replaceWith(pos, $from.after(), quote));
            tr.setSelection(TextSelection.create(tr.doc, pos + marker.nodeSize + 2));
            view.dispatch(tr.setMeta(calloutKey, { commit: pos, reveal: pos }).scrollIntoView());
            view.dispatch(closeHistory(view.state.tr)); return true;
          }
          if ($from.depth >= 2 && isCallout($from.node(-1), context) && $from.index(-1) === 0 && !$from.parent.textContent.includes("\n")) {
            return enterCalloutBody(view, $from.before($from.depth - 1));
          }
        }
        const pos = containingCallout(state, context);
        if (event.key === "Enter" && pos !== null && $from.parent.type.name === "paragraph" && $from.node(-1) === state.doc.nodeAt(pos)) {
          return splitBlock(state, view.dispatch, view);
        }
        if (!(selection instanceof TextSelection) || !selection.empty || $from.depth < 1) return false;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
        const up = event.key === "ArrowUp", titleFocus = calloutKey.getState(state)?.titleFocus;
        if (titleFocus != null) return up ? leaveCallout(view, titleFocus, -1, context) : enterCalloutBody(view, titleFocus);
        if (pos !== null) {
          const body = calloutBody(state.doc, pos);
          if (body) {
            const edge = up ? body.start : body.end, $edge = state.doc.resolve(edge);
            const sameBlock = $from.parent === $edge.parent && $from.start() === $edge.start();
            if (selection.from === edge || sameBlock && view.endOfTextblock(up ? "up" : "down")) {
              return up ? focusCalloutTitle(view, pos) : leaveCallout(view, pos, 1, context);
            }
          }
        }
        const boundary = up ? $from.before() : $from.after(), $boundary = state.doc.resolve(boundary);
        const neighbor = up ? $boundary.nodeBefore : $boundary.nodeAfter;
        if (!isCallout(neighbor, context)) return false;
        const atEdge = up ? $from.parentOffset === 0 : $from.parentOffset === $from.parent.content.size;
        if (!atEdge && !view.endOfTextblock(up ? "up" : "down")) return false;
        const nextPos = up ? boundary - neighbor!.nodeSize : boundary;
        if (isCalloutDraft(state, nextPos)) return false;
        return up ? enterCalloutBody(view, nextPos, true) : focusCalloutTitle(view, nextPos);
      },
      decorations(state) {
        const decorations: Decoration[] = [], mode = calloutKey.getState(state);
        state.doc.descendants((node, pos) => {
          if (!isCallout(node, context)) return true;
          const draft = mode?.drafts.has(pos);
          decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: draft ? "mint-callout-draft" : "mint-callout-rendered", "data-mint-presentation": `${context.revision ?? 0}:${context.readOnly ? 1 : 0}` }, { calloutDraft: draft, calloutTitleFocus: mode?.titleFocus === pos, calloutReveal: mode?.reveal.includes(pos) }));
          if (draft) return true;
          const line = calloutLine(node), markerStart = pos + 2;
          if (line.length === node.firstChild!.textContent.length) decorations.push(Decoration.node(pos + 1, pos + 1 + node.firstChild!.nodeSize, { class: "callout-source-marker" }));
          else decorations.push(Decoration.inline(markerStart, markerStart + line.length + 1, { class: "callout-marker-source" }));
          return true;
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
