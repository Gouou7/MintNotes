import MarkdownIt from "markdown-it";
import type { Node as PMNode, Schema } from "prosemirror-model";
import { Plugin, PluginKey, Selection, TextSelection } from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";

import type { SourceBlockPresentation } from "../extension";
import { SOURCE_BLOCK_PRESENTATION_META } from "../extension";
import { INLINE_PRESENTATION_META } from "../inline-parse";
import { SOURCE_TRANSACTION_META } from "../source-transaction";
import type { FeaturePluginContext, FeatureSpec } from "./_types";

// A Live blockquote owns its complete authored Markdown. The NodeView toggles
// between a non-editable rendered preview and the same node's literal source;
// it never swaps the source for rendered-only ProseMirror content.

const md = new MarkdownIt("commonmark", { html: false });
const QUOTE_PREFIX = /^(?: {0,3}>[\t ]?)+/;
const blockquotePresentationKey = new PluginKey<number>("blockquote-presentation");
const EDITABLE_BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "FOOTER", "HEADER",
  "H1", "H2", "H3", "H4", "H5", "H6", "LI", "MAIN", "NAV", "P", "PRE",
  "SECTION",
]);

function sourceFromEditableDom(root: HTMLElement): string {
  let output = "";
  let syntheticTrailingBreak = false;

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      output += node.textContent ?? "";
      syntheticTrailingBreak = false;
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      output += "\n";
      syntheticTrailingBreak = false;
      return;
    }

    const block = EDITABLE_BLOCK_TAGS.has(node.tagName);
    if (block && output && !output.endsWith("\n")) {
      output += "\n";
      syntheticTrailingBreak = true;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
    if (block && !output.endsWith("\n")) {
      output += "\n";
      syntheticTrailingBreak = true;
    }
  };

  for (const child of Array.from(root.childNodes)) visit(child);
  return syntheticTrailingBreak ? output.slice(0, -1) : output;
}

function sourceOffsetFromDomPoint(
  root: HTMLElement,
  node: Node | null,
  offset: number,
): number | null {
  if (!node || (node !== root && !root.contains(node))) return null;
  try {
    if (node.nodeType === Node.TEXT_NODE && node.parentNode === root) {
      const clone = root.ownerDocument.createElement("code");
      for (const sibling of Array.from(root.childNodes)) {
        if (sibling === node) break;
        clone.append(sibling.cloneNode(true));
      }
      return sourceFromEditableDom(clone).length + Math.min(offset, node.textContent?.length ?? 0);
    }
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    const fragment = range.cloneContents();
    const clone = root.ownerDocument.createElement("code");
    clone.append(fragment);
    return sourceFromEditableDom(clone).length;
  } catch {
    return null;
  }
}

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

function activateSource(
  view: EditorView,
  pos: number,
  offset: number,
  focusView = true,
): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "blockquote") return false;
  const sourceOffset = Math.max(0, Math.min(offset, node.content.size));
  const tr = view.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    sourceEditing: true,
  });
  tr.setSelection(TextSelection.create(tr.doc, pos + 1 + sourceOffset));
  tr.setMeta("addToHistory", false);
  tr.setMeta(SOURCE_BLOCK_PRESENTATION_META, true);
  view.dispatch(tr.scrollIntoView());
  if (focusView) view.focus();
  return true;
}

function pointerSourceOffset(
  preview: HTMLElement,
  source: string,
  event: MouseEvent,
): number {
  if ((event.target as Element | null)?.closest(".markdown-callout, .callout-header")) {
    const lineEnd = source.indexOf("\n");
    return lineEnd < 0 ? source.length : lineEnd;
  }
  const lines = source.split("\n");
  const rect = preview.getBoundingClientRect();
  const ratio = rect.height > 0
    ? Math.max(0, Math.min(0.999, (event.clientY - rect.top) / rect.height))
    : 0;
  const lineIndex = Math.min(lines.length - 1, Math.floor(ratio * lines.length));
  let offset = 0;
  for (let index = 0; index < lineIndex; index += 1) offset += lines[index]!.length + 1;
  return offset + lines[lineIndex]!.length;
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
  private domNormalizationQueued = false;

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
    preview.addEventListener("mousedown", this.onPreviewMouseDown);
    sourceCode.addEventListener("beforeinput", this.onSourceBeforeInput);
    this.applyNode(node);
  }

  private sourceSelectionOffsets(): { anchor: number | null; head: number | null } {
    const selection = this.contentDOM.ownerDocument.getSelection();
    return {
      anchor: sourceOffsetFromDomPoint(
        this.contentDOM,
        selection?.anchorNode ?? null,
        selection?.anchorOffset ?? 0,
      ),
      head: sourceOffsetFromDomPoint(
        this.contentDOM,
        selection?.focusNode ?? null,
        selection?.focusOffset ?? 0,
      ),
    };
  }

  private replaceSource(source: string, anchor: number | null, head: number | null): void {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "blockquote") return;

    const fallback = Math.max(0, this.view.state.selection.head - pos - 1);
    const text = source ? this.view.state.schema.text(source) : undefined;
    const tr = this.view.state.tr.replaceWith(
      pos + 1,
      pos + 1 + node.content.size,
      text ?? [],
    );
    const maxOffset = tr.doc.nodeAt(pos)?.content.size ?? 0;
    const nextAnchor = Math.max(0, Math.min(anchor ?? fallback, maxOffset));
    const nextHead = Math.max(0, Math.min(head ?? nextAnchor, maxOffset));
    tr.setSelection(TextSelection.create(
      tr.doc,
      pos + 1 + nextAnchor,
      pos + 1 + nextHead,
    ));
    this.view.dispatch(tr);
  }

  private onSourceBeforeInput = (event: InputEvent): void => {
    if (event.isComposing || !event.cancelable) return;
    const { anchor, head } = this.sourceSelectionOffsets();
    if (anchor == null || head == null) return;
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    const source = this.node.textContent;
    let nextSource: string | null = null;
    let nextOffset = from;

    if (
      (event.inputType === "insertText" || event.inputType === "insertReplacementText")
      && event.data != null
    ) {
      nextSource = source.slice(0, from) + event.data + source.slice(to);
      nextOffset = from + event.data.length;
    } else if (event.inputType === "deleteContentBackward") {
      const deleteFrom = from === to ? Math.max(0, from - 1) : from;
      nextSource = source.slice(0, deleteFrom) + source.slice(to);
      nextOffset = deleteFrom;
    } else if (event.inputType === "deleteContentForward") {
      const deleteTo = from === to ? Math.min(source.length, to + 1) : to;
      nextSource = source.slice(0, from) + source.slice(deleteTo);
      nextOffset = from;
    } else if (event.inputType === "deleteByCut" && from !== to) {
      nextSource = source.slice(0, from) + source.slice(to);
      nextOffset = from;
    }

    if (nextSource == null) return;
    event.preventDefault();
    event.stopPropagation();
    this.replaceSource(nextSource, nextOffset, nextOffset);
  };

  private scheduleDomNormalization(): void {
    if (this.domNormalizationQueued) return;
    this.domNormalizationQueued = true;
    queueMicrotask(() => {
      this.domNormalizationQueued = false;
      if (!this.contentDOM.isConnected) return;
      const { anchor, head } = this.sourceSelectionOffsets();
      const source = sourceFromEditableDom(this.contentDOM);
      this.contentDOM.textContent = source;
      this.replaceSource(source, anchor, head);
    });
  }

  private onPreviewMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    const pos = this.getPos();
    if (pos == null) return;
    event.preventDefault();
    event.stopPropagation();
    activateSource(
      this.view,
      pos,
      pointerSourceOffset(this.preview, this.node.textContent, event),
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
    const editing = node.attrs.sourceEditing === true;
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
    return !this.node.attrs.sourceEditing && this.preview.contains(event.target as Node);
  }

  ignoreMutation(mutation: { target: Node }): boolean {
    if (this.preview.contains(mutation.target)) return true;
    if (this.contentDOM.querySelector("div, p, pre, blockquote, br")) {
      this.scheduleDomNormalization();
      return true;
    }
    return false;
  }

  destroy(): void {
    this.preview.removeEventListener("mousedown", this.onPreviewMouseDown);
    this.contentDOM.removeEventListener("beforeinput", this.onSourceBeforeInput);
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
      const selectionChanged = !oldState.selection.eq(newState.selection);
      let hasActive = false;
      newState.doc.descendants((node) => {
        if (node.type === schema.nodes.blockquote && node.attrs.sourceEditing) hasActive = true;
      });
      if (!selectionChanged && !hasActive) return null;

      const selected = selectedBlockquote(newState);
      const tr = newState.tr;
      newState.doc.descendants((node, pos) => {
        if (node.type !== schema.nodes.blockquote) return;
        const shouldEdit = selected?.pos === pos;
        if (node.attrs.sourceEditing === shouldEdit) return;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, sourceEditing: shouldEdit });
      });
      if (!tr.docChanged) return null;
      tr.setMeta("addToHistory", false);
      return tr;
    },
    props: {
      handleDOMEvents: {
        focus(view) {
          const selected = selectedBlockquote(view.state);
          if (!selected || selected.node.attrs.sourceEditing) return false;
          activateSource(
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
            { ...$from.parent.attrs, sourceEditing: true },
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

      if ($from.parent.type !== schema.nodes.blockquote || !$from.parent.attrs.sourceEditing) return false;
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
              { sourceEditing: false },
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
