import MarkdownIt from "markdown-it";
import type { Node as PMNode, Schema } from "prosemirror-model";
import { Plugin, PluginKey, Selection, TextSelection } from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";

import type { SourceBlockPresentation } from "../extension";
import { SOURCE_BLOCK_PRESENTATION_META } from "../extension";
import { INLINE_PRESENTATION_META } from "../inline-parse";
import {
  isLiveSyntaxEditing,
  LIVE_SYNTAX_EDITING,
  LIVE_SYNTAX_RENDERING,
} from "../live-syntax-state";
import { SOURCE_FROM_ATTR } from "../source";
import {
  LIVE_POINTER_SELECTION_META,
  LIVE_PRESENTATION_SYNC_META,
  markLiveNavigation,
  hasVisualLineInDirection,
  selectionOutsideBlock,
} from "../source-navigation";
import { SOURCE_TRANSACTION_META } from "../source-transaction";
import type { FeaturePluginContext, FeatureSpec } from "./_types";

// A Live blockquote owns its complete authored Markdown. The NodeView toggles
// between a non-editable rendered preview and the same node's literal source;
// it never swaps the source for rendered-only ProseMirror content.

const md = new MarkdownIt("commonmark", { html: false });
const QUOTE_PREFIX = /^(?: {0,3}>[\t ]?)+/;
const blockquotePresentationKey = new PluginKey<number>("blockquote-presentation");
function selectedBlockquote(state: EditorView["state"]): {
  node: PMNode;
  pos: number;
} | null {
  const { $from, $to } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "blockquote") continue;
    const pos = $from.before(depth);
    if ($to.pos <= pos + node.nodeSize) return { node, pos };
  }
  return null;
}

function enterEditingState(
  view: EditorView,
  pos: number,
  offset: number,
  focusView = true,
  extendSelection = false,
): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "blockquote") return false;
  const sourceOffset = Math.max(0, Math.min(offset, node.content.size));
  const headPosition = pos + 1 + sourceOffset;
  const tr = view.state.tr.setSelection(TextSelection.create(
    view.state.doc,
    extendSelection ? view.state.selection.anchor : headPosition,
    headPosition,
  ));
  const sourceFrom = Number(node.attrs.sourceFrom);
  view.dispatch(markLiveNavigation(tr, {
    ...(Number.isInteger(sourceFrom)
      ? extendSelection
        ? { head: sourceFrom + sourceOffset }
        : { anchor: sourceFrom + sourceOffset, head: sourceFrom + sourceOffset }
      : {}),
    scroll: true,
  }));
  if (focusView) view.focus();
  return true;
}

function siblingBlockquote(
  state: EditorView["state"],
  direction: -1 | 1,
): { pos: number; node: PMNode } | null {
  const { selection } = state;
  if (!selection.empty || selection.$from.depth < 1) return null;
  const $from = selection.$from;
  const parentPos = $from.before();
  const $parent = state.doc.resolve(parentPos);
  const index = $parent.index();
  if (direction < 0) {
    if (index === 0) return null;
    const node = $parent.parent.child(index - 1);
    return node.type.name === "blockquote"
      ? { pos: parentPos - node.nodeSize, node }
      : null;
  }

  const current = $parent.parent.child(index);
  const node = $parent.parent.maybeChild(index + 1);
  return node?.type.name === "blockquote"
    ? { pos: parentPos + current.nodeSize, node }
    : null;
}

function adjacentBlockquote(
  state: EditorView["state"],
  direction: -1 | 1,
): { pos: number; node: PMNode } | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  const atBoundary = direction < 0
    ? $from.parentOffset === 0
    : $from.parentOffset === $from.parent.content.size;
  return atBoundary ? siblingBlockquote(state, direction) : null;
}

function moveOutsideBlockquote(view: EditorView, direction: -1 | 1): boolean {
  const { state } = view;
  const selected = selectedBlockquote(state);
  if (!selected) return false;
  const outside = selectionOutsideBlock(
    state,
    selected.pos,
    selected.node,
    direction,
  );
  if (!outside) return false;
  view.dispatch(
    markLiveNavigation(state.tr
      .setSelection(outside)
      .setMeta(SOURCE_BLOCK_PRESENTATION_META, true), {
      direction,
      scroll: true,
    }),
  );
  return true;
}

function moveBlockquoteSourceVertically(view: EditorView, direction: -1 | 1): boolean {
  const { state } = view;
  const { selection } = state;
  if (
    !selection.empty
    || selection.$from.parent.type.name !== "blockquote"
    || !isLiveSyntaxEditing(selection.$from.parent.attrs.liveSyntaxState)
  ) return false;

  if (hasVisualLineInDirection(view, direction)) return false;
  const text = selection.$from.parent.textContent;
  const offset = selection.$from.parentOffset;
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const column = offset - lineStart;
  let targetOffset: number | null = null;

  if (direction < 0 && lineStart > 0) {
    const previousEnd = lineStart - 1;
    const previousStart = text.lastIndexOf("\n", previousEnd - 1) + 1;
    targetOffset = previousStart + Math.min(column, previousEnd - previousStart);
  } else if (direction > 0) {
    const currentEnd = text.indexOf("\n", lineStart);
    if (currentEnd >= 0) {
      const nextStart = currentEnd + 1;
      const nextBreak = text.indexOf("\n", nextStart);
      const nextEnd = nextBreak >= 0 ? nextBreak : text.length;
      targetOffset = nextStart + Math.min(column, nextEnd - nextStart);
    }
  }

  if (targetOffset === null) return moveOutsideBlockquote(view, direction);
  const blockPos = selection.$from.before();
  view.dispatch(state.tr.setSelection(TextSelection.create(
    state.doc,
    blockPos + 1 + targetOffset,
  )).scrollIntoView());
  return true;
}

class BlockquoteView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly sourceSurface: HTMLElement;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly presentations: readonly SourceBlockPresentation[];
  private node: PMNode;
  private renderedSource = "";
  private destroyPreview: (() => void) | undefined;

  constructor(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    presentations: readonly SourceBlockPresentation[],
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.presentations = presentations;

    const dom = document.createElement("div");
    dom.className = "source-blockquote-node";
    const preview = document.createElement("div");
    preview.className = "source-blockquote-preview";
    preview.setAttribute("contenteditable", "false");
    const source = document.createElement("pre");
    source.className = "source-blockquote-source";
    source.setAttribute("data-source-blockquote", "1");
    const sourceCode = document.createElement("code");
    sourceCode.className = "source-blockquote-source-code";
    source.append(sourceCode);
    dom.append(preview, source);

    this.dom = dom;
    this.contentDOM = sourceCode;
    this.preview = preview;
    this.sourceSurface = source;
    preview.addEventListener("mouseup", this.onPreviewMouseUp);
    this.applyNode(node);
  }

  private onPreviewMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    const pos = this.getPos();
    if (pos == null) return;
    event.preventDefault();
    event.stopPropagation();
    enterEditingState(
      this.view,
      pos,
      this.node.textContent.split("\n", 1)[0]!.length,
      true,
      event.shiftKey,
    );
  };

  private renderPreview(source: string, force = false): void {
    if (!force && source === this.renderedSource) return;
    this.destroyPreview?.();
    this.destroyPreview = undefined;
    this.preview.replaceChildren();
    this.preview.classList.remove("live-presentation-fallback");
    const presentation = this.presentations.find((candidate) => (
      candidate.nodeType === "blockquote" && candidate.matches(source)
    ));
    if (presentation) {
      try {
        const cleanup = presentation.render(this.preview, source);
        if (cleanup) this.destroyPreview = cleanup;
      } catch {
        this.preview.classList.add("live-presentation-fallback");
        this.preview.textContent = source;
      }
    } else {
      this.preview.innerHTML = md.render(source);
      for (const child of Array.from(this.preview.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()) child.remove();
      }
    }
    this.renderedSource = source;
  }

  private applyNode(node: PMNode): void {
    this.node = node;
    const editing = isLiveSyntaxEditing(node.attrs.liveSyntaxState);
    this.dom.classList.toggle("is-source-editing", editing);
    this.sourceSurface.hidden = !editing;
    this.sourceSurface.setAttribute("aria-hidden", editing ? "false" : "true");
    this.preview.hidden = editing;
    this.preview.setAttribute("aria-hidden", editing ? "true" : "false");
    this.renderPreview(node.textContent);
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "blockquote") return false;
    this.applyNode(node);
    return true;
  }

  refreshPresentation(): void {
    this.renderPreview(this.node.textContent, true);
  }

  stopEvent(event: Event): boolean {
    return !isLiveSyntaxEditing(this.node.attrs.liveSyntaxState) && this.preview.contains(event.target as Node);
  }

  ignoreMutation(mutation: { target: Node }): boolean {
    if (this.preview.contains(mutation.target)) return true;
    return false;
  }

  destroy(): void {
    this.preview.removeEventListener("mouseup", this.onPreviewMouseUp);
    this.destroyPreview?.();
  }
}

function blockquotePlugin(
  schema: Schema,
  context: FeaturePluginContext,
): Plugin {
  const presentations = context.sourceBlockPresentations ?? [];
  const mountedViews = new Set<BlockquoteView>();
  return new Plugin<number>({
    key: blockquotePresentationKey,
    state: {
      init: () => 0,
      apply: (tr, value) => tr.getMeta(INLINE_PRESENTATION_META) ? value + 1 : value,
    },
    appendTransaction(transactions, oldState, newState) {
      if (transactions.some((transaction) => transaction.getMeta(LIVE_POINTER_SELECTION_META))) return null;
      const synchronized = transactions.some((transaction) => transaction.getMeta(LIVE_PRESENTATION_SYNC_META));
      const selectionChanged = !oldState.selection.eq(newState.selection);
      let hasActive = false;
      newState.doc.descendants((node) => {
        if (node.type === schema.nodes.blockquote && isLiveSyntaxEditing(node.attrs.liveSyntaxState)) hasActive = true;
      });
      if (!selectionChanged && !hasActive) return null;

      const tr = newState.tr;
      newState.doc.descendants((node, pos) => {
        if (node.type !== schema.nodes.blockquote) return;
        // Top-level blocks are already synchronized by the controller.
        if (synchronized && newState.doc.resolve(pos).depth === 0) return;
        const nodeFrom = pos + 1;
        const nodeTo = pos + node.nodeSize - 1;
        const shouldEdit = newState.selection.from <= nodeTo && newState.selection.to >= nodeFrom;
        if (isLiveSyntaxEditing(node.attrs.liveSyntaxState) === shouldEdit) return;
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          liveSyntaxState: shouldEdit ? LIVE_SYNTAX_EDITING : LIVE_SYNTAX_RENDERING,
        });
      });
      if (!tr.docChanged) return null;
      // setNodeMarkup uses a replace-around mapping even though this update
      // changes attributes only. Preserve the selection from newState
      // explicitly so leaving a quote is not mapped back into its source.
      tr.setSelection(Selection.fromJSON(tr.doc, newState.selection.toJSON()));
      tr.setMeta("addToHistory", false);
      return tr;
    },
    props: {
      handleKeyDown(view, event) {
        if (view.composing || event.isComposing || event.keyCode === 229) return false;
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
          return false;
        }
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
        const { state } = view;
        const { selection } = state;
        if (!selection.empty) return false;
        const $from = selection.$from;

        if (
          $from.parent.type.name === "blockquote"
          && isLiveSyntaxEditing($from.parent.attrs.liveSyntaxState)
        ) {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            return moveBlockquoteSourceVertically(view, event.key === "ArrowUp" ? -1 : 1);
          }
          if (event.key === "ArrowLeft" && $from.parentOffset === 0) {
            return moveOutsideBlockquote(view, -1);
          }
          if (
            event.key === "ArrowRight"
            && $from.parentOffset === $from.parent.content.size
          ) return moveOutsideBlockquote(view, 1);
          return false;
        }

        const direction = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
        let adjacent = adjacentBlockquote(state, direction);
        if (
          !adjacent
          && (event.key === "ArrowUp" || event.key === "ArrowDown")
          && $from.parent.isTextblock
          && view.endOfTextblock(event.key === "ArrowUp" ? "up" : "down", state)
        ) adjacent = siblingBlockquote(state, direction);
        if (!adjacent) return false;
        return enterEditingState(
          view,
          adjacent.pos,
          direction < 0 ? adjacent.node.content.size : 0,
        );
      },
      handleDOMEvents: {
        focus(view) {
          const selected = selectedBlockquote(view.state);
          if (!selected || isLiveSyntaxEditing(selected.node.attrs.liveSyntaxState)) return false;
          enterEditingState(
            view,
            selected.pos,
            view.state.selection.head - selected.pos - 1,
            false,
          );
          return false;
        },
      },
      nodeViews: {
        blockquote: (node, view, getPos) => {
          const blockquoteView = new BlockquoteView(node, view, getPos, presentations);
          mountedViews.add(blockquoteView);
          const destroy = blockquoteView.destroy.bind(blockquoteView);
          blockquoteView.destroy = () => {
            mountedViews.delete(blockquoteView);
            destroy();
          };
          return blockquoteView;
        },
      },
    },
    view: () => ({
      update(view, previousState) {
        if (
          blockquotePresentationKey.getState(view.state)
          === blockquotePresentationKey.getState(previousState)
        ) return;
        for (const mounted of mountedViews) mounted.refreshPresentation();
      },
      destroy() {
        mountedViews.clear();
      },
    }),
  });
}

function sourceLineAt(source: string, offset: number): {
  from: number;
  to: number;
  prefix: string;
  content: string;
} {
  const from = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const nextBreak = source.indexOf("\n", offset);
  const to = nextBreak < 0 ? source.length : nextBreak;
  const line = source.slice(from, to);
  const prefix = QUOTE_PREFIX.exec(line)?.[0] ?? "> ";
  return { from, to, prefix, content: line.slice(prefix.length) };
}

export const blockquote: FeatureSpec = {
  name: "blockquote",

  plugins: (schema, context) => [blockquotePlugin(schema, context)],

  keymap: (schema) => ({
    Enter: (state, dispatch) => {
      const { selection } = state;
      if (!selection.empty) return false;
      const $from = selection.$from;

      if ($from.parent.type === schema.nodes.paragraph && $from.depth === 1) {
        const prefix = QUOTE_PREFIX.exec($from.parent.textContent)?.[0];
        if (!prefix) return false;
        if (dispatch) {
          const pos = $from.before();
          const source = `${$from.parent.textContent}\n${prefix}`;
          const quote = schema.nodes.blockquote.create(
            { ...$from.parent.attrs, liveSyntaxState: LIVE_SYNTAX_EDITING },
            schema.text(source),
          );
          const tr = state.tr.replaceWith(pos, pos + $from.parent.nodeSize, quote);
          tr.setSelection(TextSelection.create(tr.doc, pos + 1 + source.length));
          const sourceFrom = Number($from.parent.attrs.sourceFrom);
          if (Number.isInteger(sourceFrom) && sourceFrom >= 0) {
            const head = sourceFrom + source.length;
            tr.setMeta(SOURCE_TRANSACTION_META, {
              edits: [{
                from: sourceFrom + $from.parent.textContent.length,
                to: sourceFrom + $from.parent.textContent.length,
                insert: `\n${prefix}`,
              }],
              selection: { anchor: head, head },
              origin: "input",
            });
          }
          dispatch(tr.scrollIntoView());
        }
        return true;
      }

      if (
        $from.parent.type !== schema.nodes.blockquote
        || !isLiveSyntaxEditing($from.parent.attrs.liveSyntaxState)
      ) return false;
      const node = $from.parent;
      const pos = $from.before();
      const offset = $from.parentOffset;
      const line = sourceLineAt(node.textContent, offset);
      if (!line.content.trim() && line.to === node.textContent.length) {
        if (dispatch) {
          const remaining = node.textContent.slice(0, Math.max(0, line.from - 1));
          const paragraph = schema.nodes.paragraph.create();
          if (!remaining) {
            const tr = state.tr.replaceWith(pos, pos + node.nodeSize, paragraph);
            tr.setSelection(TextSelection.create(tr.doc, pos + 1));
            dispatch(tr.scrollIntoView());
          } else {
            const quote = schema.nodes.blockquote.create(
              { liveSyntaxState: LIVE_SYNTAX_RENDERING },
              schema.text(remaining),
            );
            const tr = state.tr.replaceWith(pos, pos + node.nodeSize, [quote, paragraph]);
            tr.setSelection(TextSelection.create(tr.doc, pos + quote.nodeSize + 1));
            dispatch(tr.scrollIntoView());
          }
        }
        return true;
      }

      if (dispatch) dispatch(state.tr.insertText(`\n${line.prefix}`).scrollIntoView());
      return true;
    },

    Backspace: (state, dispatch) => {
      const { selection } = state;
      if (!selection.empty || selection.$from.parent.type !== schema.nodes.blockquote) return false;
      if (selection.$from.parentOffset !== 0) return false;

      const previous = Selection.findFrom(
        state.doc.resolve(selection.$from.before()),
        -1,
        true,
      );
      if (previous && dispatch) {
        dispatch(state.tr.setSelection(previous).scrollIntoView());
      }
      return true;
    },
  }),
};
