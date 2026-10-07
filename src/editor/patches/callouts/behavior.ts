import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "prosemirror-state";
import { splitBlock } from "prosemirror-commands";
import { closeHistory } from "prosemirror-history";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { MintContext } from "./context.ts";
import { focusCodeLanguage } from "../features/fenced-code.ts";

interface CalloutState { titleFocus: number | null; reveal: number | null; drafts: Set<number> }
interface CalloutMeta { titleFocus?: number | null; reveal?: number; commit?: number }
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

export function enterCalloutBody(view: EditorView, pos: number, atEnd = false): boolean {
  const node = view.state.doc.nodeAt(pos); if (!node || view.editable === false) return false;
  const tr = view.state.tr;
  let body = calloutBody(tr.doc, pos);
  if (!body) {
    const paragraph = view.state.schema.nodes.paragraph.createAndFill(); if (!paragraph) return false;
    tr.insert(pos + node.nodeSize - 1, paragraph);
    body = calloutBody(tr.doc, pos);
  }
  if (!body) return false;
  tr.setSelection(TextSelection.create(tr.doc, atEnd ? body.end : body.start));
  view.dispatch(tr.setMeta(calloutKey, { titleFocus: null, reveal: pos, commit: pos }).scrollIntoView());
  focusDocument(view); return true;
}

export function leaveCallout(view: EditorView, pos: number, direction: -1 | 1, context: MintContext): boolean {
  const node = view.state.doc.nodeAt(pos); if (!node) return false;
  const boundary = direction < 0 ? pos : pos + node.nodeSize, $boundary = view.state.doc.resolve(boundary);
  const neighbor = direction < 0 ? $boundary.nodeBefore : $boundary.nodeAfter;
  if (isCallout(neighbor, context)) {
    const nextPos = direction < 0 ? pos - neighbor!.nodeSize : boundary;
    return direction < 0 ? enterCalloutBody(view, nextPos, true) : focusCalloutTitle(view, nextPos);
  }
  if (direction > 0 && neighbor?.type.name === "code_block") return focusCodeLanguage(view, boundary);
  const tr = view.state.tr.setMeta(calloutKey, { titleFocus: null });
  if (neighbor) tr.setSelection(TextSelection.near($boundary, direction));
  else {
    const paragraph = view.state.schema.nodes.paragraph.createAndFill();
    if (!paragraph || !$boundary.parent.canReplaceWith($boundary.index(), $boundary.index(), paragraph.type)) return false;
    tr.insert(boundary, paragraph); tr.setSelection(TextSelection.create(tr.doc, boundary + 1));
  }
  view.dispatch(tr.scrollIntoView()); focusDocument(view); return true;
}

function containingCallout(state: EditorState, context: MintContext): number | null {
  const $from = state.selection.$from;
  for (let depth = $from.depth - 1; depth > 0; depth--) {
    const pos = $from.before(depth);
    if (isCallout($from.node(depth), context) && !isCalloutDraft(state, pos)) return pos;
  }
  return null;
}

export function calloutBehavior(context: MintContext): Plugin<CalloutState> {
  return new Plugin<CalloutState>({
    key: calloutKey,
    state: {
      init: () => ({ titleFocus: null, reveal: null, drafts: new Set() }),
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
        return { titleFocus, reveal: meta?.reveal ?? null, drafts };
      },
    },
    appendTransaction(_transactions, _oldState, state) {
      if (!_transactions.some(transaction => transaction.selectionSet) || state.selection.eq(_oldState.selection)) return null;
      if (context.readOnly || !(state.selection instanceof TextSelection) || !state.selection.empty || calloutKey.getState(state)?.titleFocus !== null) return null;
      const pos = containingCallout(state, context); if (pos === null) return null;
      const markerEnd = pos + 2 + calloutLine(state.doc.nodeAt(pos)!).length;
      if (state.selection.from > markerEnd) return null;
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
        if (event.key === "Backspace" && pos !== null && selection.from === calloutBody(state.doc, pos)?.start) return focusCalloutTitle(view, pos);
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
          decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: draft ? "mint-callout-draft" : "mint-callout-rendered", "data-mint-presentation": `${context.revision ?? 0}:${context.readOnly ? 1 : 0}` }, { calloutDraft: draft, calloutTitleFocus: mode?.titleFocus === pos, calloutReveal: mode?.reveal === pos }));
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
