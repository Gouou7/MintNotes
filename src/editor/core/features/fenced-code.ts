import type { Node as PMNode, ResolvedPos, Schema } from "prosemirror-model";
import { Plugin, Selection, TextSelection } from "prosemirror-state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeView,
} from "prosemirror-view";

import { leaveLineDraft } from "../block-draft";
import { SOURCE_BLOCK_PRESENTATION_META } from "../extension";
import { displayCodeLanguage, parseFencedCodeSource } from "../fenced-code-source";
import {
  isLiveSyntaxEditing,
  LIVE_SYNTAX_EDITING,
  LIVE_SYNTAX_RENDERING,
  type LiveSyntaxState,
} from "../live-syntax-state";
import { SOURCE_FROM_ATTR, SOURCE_TO_ATTR } from "../source";
import {
  LIVE_POINTER_SELECTION_META,
  LIVE_PRESENTATION_SYNC_META,
  markLiveNavigation,
  selectionOutsideBlock,
} from "../source-navigation";
import { SOURCE_TRANSACTION_META } from "../source-transaction";
import type { FeatureSpec } from "./_types";

// A fenced code node always contains its complete Markdown source, including
// the opening fence and the closing fence when one exists. Live mode changes
// only presentation state: the editing state reveals the fence characters,
// while the rendering state hides them with decorations. Source positions
// never change merely because the caret enters or leaves the block.

const FENCE_RE = /^```(\w*)$/;

type SourceTarget =
  | { edge: "open" | "close" }
  | { bodyOffset: number };

function parseCompleteSource(source: string): { lang: string; body: string } | null {
  const parsed = parseFencedCodeSource(source);
  if (!parsed || parsed.closingFrom === null) return null;
  return { lang: parsed.lang, body: parsed.body };
}

function isFencedCodeEditing(node: PMNode): boolean {
  return node.type.name === "code_block" && isLiveSyntaxEditing(node.attrs.liveSyntaxState);
}

function sourceOffset(node: PMNode, target: SourceTarget): number {
  const source = node.textContent;
  const parsed = parseFencedCodeSource(source);
  if ("edge" in target) {
    return target.edge === "open" ? 0 : source.length;
  }
  const bodyFrom = parsed?.bodyFrom ?? 0;
  const bodyTo = parsed?.bodyTo ?? source.length;
  return Math.min(bodyFrom + Math.max(0, target.bodyOffset), bodyTo);
}

function enterEditingState(
  view: EditorView,
  pos: number,
  target: SourceTarget,
  extendSelection = false,
): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "code_block") return false;

  if (isFencedCodeEditing(node)) {
    const offset = "edge" in target
      ? target.edge === "open" ? 0 : node.content.size
      : Math.min(Math.max(0, target.bodyOffset), node.content.size);
    const sourceFrom = Number(node.attrs.sourceFrom);
    view.dispatch(markLiveNavigation(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1 + offset)),
      {
        ...(Number.isInteger(sourceFrom) ? { anchor: sourceFrom + offset, head: sourceFrom + offset } : {}),
        scroll: true,
      },
    ));
    (view as EditorView & { focus?: () => void }).focus?.();
    return true;
  }

  const offset = sourceOffset(node, target);
  const headPosition = pos + 1 + offset;
  const tr = view.state.tr.setSelection(TextSelection.create(
    view.state.doc,
    extendSelection ? view.state.selection.anchor : headPosition,
    headPosition,
  ));
  const sourceFrom = Number(node.attrs.sourceFrom);
  view.dispatch(markLiveNavigation(tr, {
    ...(Number.isInteger(sourceFrom)
      ? extendSelection
        ? { head: sourceFrom + offset }
        : { anchor: sourceFrom + offset, head: sourceFrom + offset }
      : {}),
    scroll: true,
  }));
  (view as EditorView & { focus?: () => void }).focus?.();
  return true;
}

function pointerSourceTarget(
  view: EditorView,
  node: PMNode,
  nodePos: number,
  dom: HTMLElement,
  event: MouseEvent,
): SourceTarget {
  if ((event.target as HTMLElement | null)?.closest(".cb-language-label")) {
    return { edge: "open" };
  }

  const rect = dom.getBoundingClientRect();
  if (rect.height > 0) {
    const edgeZone = Math.min(28, rect.height / 3);
    if (event.clientY <= rect.top + edgeZone) return { edge: "open" };
    if (event.clientY >= rect.bottom - edgeZone) return { edge: "close" };
  }

  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  const parsed = parseFencedCodeSource(node.textContent);
  const bodyFrom = parsed?.bodyFrom ?? 0;
  const bodySize = parsed ? parsed.bodyTo - parsed.bodyFrom : node.content.size;
  const bodyOffset = coords ? coords.pos - nodePos - 1 - bodyFrom : 0;
  return {
    bodyOffset: Math.min(Math.max(0, bodyOffset), bodySize),
  };
}

function pointerIsAtSourceEnd(
  view: EditorView,
  node: PMNode,
  nodePos: number,
  event: MouseEvent,
): boolean {
  try {
    const caret = view.coordsAtPos(nodePos + 1 + node.content.size);
    const verticalTolerance = Math.max(3, (caret.bottom - caret.top) * 0.35);
    return event.clientX >= Math.min(caret.left, caret.right) - 1
      && event.clientY >= caret.top - verticalTolerance
      && event.clientY <= caret.bottom + verticalTolerance;
  } catch {
    return false;
  }
}

function commentPattern(lang: string): RegExp {
  const normalized = lang.trim().toLowerCase();
  if (["bash", "sh", "shell", "zsh", "py", "python", "rb", "ruby", "yaml", "yml"].includes(normalized)) {
    return /^\s*#/;
  }
  if (["sql", "lua", "hs", "haskell"].includes(normalized)) return /^\s*--/;
  if (["html", "xml", "svg"].includes(normalized)) return /^\s*<!--/;
  return /^\s*(?:\/\/|\/\*)/;
}

function fencedCodeDecorations(state: EditorView["state"]): DecorationSet | null {
  const decorations: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "code_block") return;
    const source = node.textContent;
    const parsed = parseFencedCodeSource(source);
    if (!parsed) return;
    const fenceClass = isFencedCodeEditing(node) ? "syntax-hint" : "syntax-hidden";
    decorations.push(Decoration.inline(
      pos + 1 + parsed.openingFrom,
      pos + 1 + parsed.openingTo,
      { class: fenceClass },
    ));
    if (parsed.closingFrom !== null && parsed.closingTo !== null) {
      decorations.push(Decoration.inline(
        pos + 1 + parsed.closingFrom,
        pos + 1 + parsed.closingTo,
        { class: fenceClass },
      ));
    }

    const lang = parsed.lang || String(node.attrs.lang ?? "");
    const pattern = commentPattern(lang);
    let offset = parsed.bodyFrom;
    for (const line of parsed.body.split("\n")) {
      if (pattern.test(line) && line.length > 0) {
        decorations.push(
          Decoration.inline(pos + 1 + offset, pos + 1 + offset + line.length, {
            class: "cb-code-comment",
          }),
        );
      }
      offset += line.length + 1;
    }
  });
  return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : null;
}

class CodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private labelEl: HTMLElement;
  private view: EditorView;
  private getPos: () => number | undefined;
  private node: PMNode;

  constructor(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    this.view = view;
    this.getPos = getPos;
    this.node = node;
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    const label = document.createElement("span");
    label.className = "cb-language-label";
    label.setAttribute("contenteditable", "false");
    label.setAttribute("aria-hidden", "true");
    pre.append(code, label);

    this.dom = pre;
    this.contentDOM = code;
    this.labelEl = label;
    this.applyNode(node);
    pre.addEventListener("mouseup", this.onMouseUp);
  }

  private onMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    const pos = this.getPos();
    if (pos == null) return;

    if (isFencedCodeEditing(this.node)) {
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!pointerIsAtSourceEnd(this.view, this.node, pos, event)) return;
      event.preventDefault();
      event.stopPropagation();
      enterEditingState(this.view, pos, { edge: "close" });
      return;
    }

    // Handle the pointer before ProseMirror performs its native selection
    // update so hidden fence decorations do not produce an intermediate
    // painted caret and the stable source coordinates are mapped exactly once.
    event.preventDefault();
    event.stopPropagation();
    enterEditingState(
      this.view,
      pos,
      pointerSourceTarget(this.view, this.node, pos, this.dom, event),
      event.shiftKey,
    );
  };

  private applyNode(node: PMNode): void {
    this.node = node;
    const lang = parseFencedCodeSource(node.textContent)?.lang
      || String(node.attrs.lang ?? "");
    const editing = isFencedCodeEditing(node);
    if (lang) this.dom.setAttribute("data-lang", lang);
    else this.dom.removeAttribute("data-lang");
    this.dom.setAttribute(
      "data-live-syntax-state",
      editing ? LIVE_SYNTAX_EDITING : LIVE_SYNTAX_RENDERING,
    );
    this.dom.classList.toggle("cb-source-editing", editing);
    this.labelEl.textContent = displayCodeLanguage(lang);
    this.labelEl.hidden = editing || lang.trim().length === 0;
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "code_block") return false;
    this.applyNode(node);
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.labelEl.contains(event.target as Node)
      || (event.type === "mousedown" && !isFencedCodeEditing(this.node));
  }

  ignoreMutation(mutation: { target: Node }): boolean {
    return this.labelEl.contains(mutation.target);
  }

  destroy(): void {
    this.dom.removeEventListener("mouseup", this.onMouseUp);
  }
}

function siblingCodeBlock(
  state: EditorView["state"],
  direction: -1 | 1,
): { pos: number; node: PMNode } | null {
  const selection = state.selection;
  if (!selection.empty || selection.$from.depth < 1) return null;
  const $from = selection.$from;
  const parentPos = $from.before();
  const $parent = state.doc.resolve(parentPos);
  const index = $parent.index();
  if (direction < 0) {
    if (index === 0) return null;
    const node = $parent.parent.child(index - 1);
    return node.type.name === "code_block"
      ? { pos: parentPos - node.nodeSize, node }
      : null;
  }

  const current = $parent.parent.child(index);
  const node = $parent.parent.maybeChild(index + 1);
  return node?.type.name === "code_block"
    ? { pos: parentPos + current.nodeSize, node }
    : null;
}

function adjacentCodeBlock(
  state: EditorView["state"],
  direction: -1 | 1,
): { pos: number; node: PMNode } | null {
  const selection = state.selection;
  if (!selection.empty) return null;
  const $from = selection.$from;
  const atBoundary = direction < 0
    ? $from.parentOffset === 0
    : $from.parentOffset === $from.parent.content.size;
  return atBoundary ? siblingCodeBlock(state, direction) : null;
}

function codeBlockAtResolvedPos($pos: ResolvedPos): {
  pos: number;
  node: PMNode;
  offset: number;
} | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "code_block") {
      return {
        pos: $pos.before(depth),
        node,
        offset: $pos.pos - $pos.start(depth),
      };
    }
  }
  return null;
}

function codeBlockAtSelection(state: EditorView["state"]): {
  pos: number;
  node: PMNode;
  offset: number;
} | null {
  const from = codeBlockAtResolvedPos(state.selection.$from);
  const to = codeBlockAtResolvedPos(state.selection.$to);
  if (!from || !to || from.pos !== to.pos) return null;
  const head = codeBlockAtResolvedPos(state.selection.$head);
  return head?.pos === from.pos ? head : from;
}

function moveSourceVertically(view: EditorView, direction: -1 | 1): boolean {
  const { state } = view;
  const selection = state.selection;
  if (!selection.empty || selection.$from.parent.type.name !== "code_block") return false;
  const node = selection.$from.parent;
  if (!isFencedCodeEditing(node)) return false;

  const text = node.textContent;
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
      // The closing fence is rendered as its own syntax-hint span. A caret at
      // the preceding text node's trailing newline is painted on the body line
      // by Chromium, making the fence look skipped. Use the stable outer edge
      // when entering the final source line from above.
      targetOffset = nextEnd === text.length
        ? nextEnd
        : nextStart + Math.min(column, nextEnd - nextStart);
    }
  }

  const blockPos = selection.$from.before();
  if (targetOffset !== null) {
    view.dispatch(
      state.tr.setSelection(TextSelection.create(state.doc, blockPos + 1 + targetOffset)),
    );
    return true;
  }

  const boundary = direction < 0 ? blockPos : blockPos + node.nodeSize;
  const outside = selectionOutsideBlock(state, blockPos, node, direction);
  const tr = state.tr;
  if (outside) {
    tr.setSelection(outside);
  } else if (direction > 0) {
    const paragraph = state.schema.nodes.paragraph?.createAndFill();
    if (!paragraph) return false;
    tr.insert(boundary, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, boundary + 1));
  } else {
    return false;
  }
  tr.setMeta(SOURCE_BLOCK_PRESENTATION_META, true);
  const navigation = markLiveNavigation(tr, {
    direction,
    scroll: true,
  });
  view.dispatch(tr.docChanged ? navigation.scrollIntoView() : navigation);
  return true;
}

function fencedCodeSourcePlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, oldState, newState) {
      if (transactions.some((transaction) => (
        transaction.getMeta(LIVE_POINTER_SELECTION_META)
        || transaction.getMeta(LIVE_PRESENTATION_SYNC_META)
      ))) return null;
      if (!transactions.some((tr) => tr.selectionSet || tr.docChanged)) return null;

      const oldCode = codeBlockAtSelection(oldState);
      const newCode = codeBlockAtSelection(newState);
      const presentationUpdates: Array<{
        pos: number;
        node: PMNode;
        liveSyntaxState: LiveSyntaxState;
        lang: string;
      }> = [];
      newState.doc.descendants((node, pos) => {
        if (node.type.name !== "code_block") return;
        const parsed = parseFencedCodeSource(node.textContent);
        if (!parsed) return;
        const nodeFrom = pos + 1;
        const nodeTo = pos + node.nodeSize - 1;
        const selected = newState.selection.from <= nodeTo
          && newState.selection.to >= nodeFrom;
        const liveSyntaxState = selected || parsed.closingFrom === null
          ? LIVE_SYNTAX_EDITING
          : LIVE_SYNTAX_RENDERING;
        if (
          isLiveSyntaxEditing(liveSyntaxState) !== isFencedCodeEditing(node)
          || parsed.lang !== String(node.attrs.lang ?? "")
        ) presentationUpdates.push({
          pos,
          node,
          liveSyntaxState,
          lang: parsed.lang,
        });
      });
      if (presentationUpdates.length === 0) return null;

      const tr = newState.tr.setMeta("addToHistory", false);
      for (const item of presentationUpdates.reverse()) {
        tr.setNodeMarkup(
          item.pos,
          undefined,
          { ...item.node.attrs, lang: item.lang, liveSyntaxState: item.liveSyntaxState },
        );
      }
      tr.setSelection(Selection.fromJSON(tr.doc, newState.selection.toJSON()));
      return tr;
    },
    props: {
      decorations: fencedCodeDecorations,
      nodeViews: {
        code_block: (node, view, getPos) => new CodeBlockView(node, view, getPos),
      },
      handleClickOn(view, _pos, node, nodePos, event, direct) {
        if (!direct || node.type.name !== "code_block" || isFencedCodeEditing(node)) return false;
        const dom = (event.target as HTMLElement | null)?.closest("pre");
        if (!dom) return false;
        return enterEditingState(
          view,
          nodePos,
          pointerSourceTarget(view, node, nodePos, dom, event),
        );
      },
      handleKeyDown(view, event) {
        if (
          event.key === "Backspace"
          && !event.shiftKey
          && !event.metaKey
          && !event.ctrlKey
          && !event.altKey
        ) {
          const adjacent = adjacentCodeBlock(view.state, -1);
          return adjacent
            ? enterEditingState(view, adjacent.pos, { edge: "close" })
            : false;
        }
        if (
          event.key === "Delete"
          && !event.shiftKey
          && !event.metaKey
          && !event.ctrlKey
          && !event.altKey
        ) {
          const adjacent = adjacentCodeBlock(view.state, 1);
          return adjacent
            ? enterEditingState(view, adjacent.pos, { edge: "open" })
            : false;
        }
        if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) {
          return false;
        }
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
        const state = view.state;
        if (!state.selection.empty) return false;
        const $from = state.selection.$from;

        if ($from.parent.type.name === "code_block") {
          if (isFencedCodeEditing($from.parent)) {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              return moveSourceVertically(view, event.key === "ArrowUp" ? -1 : 1);
            }
            return false;
          } else {
            if (event.key === "ArrowUp" && $from.parentOffset === 0) {
              return enterEditingState(view, $from.before(), { edge: "open" });
            }
            if (
              event.key === "ArrowDown"
              && $from.parentOffset === $from.parent.content.size
            ) {
              return enterEditingState(view, $from.before(), { edge: "close" });
            }
            return enterEditingState(view, $from.before(), {
              bodyOffset: $from.parentOffset,
            });
          }
        }

        const direction = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
        let adjacent = adjacentCodeBlock(state, direction);
        if (
          !adjacent
          && (event.key === "ArrowUp" || event.key === "ArrowDown")
          && $from.parent.isTextblock
          && view.endOfTextblock(event.key === "ArrowUp" ? "up" : "down", state)
        ) {
          adjacent = siblingCodeBlock(state, direction);
        }
        if (!adjacent) return false;
        return enterEditingState(
          view,
          adjacent.pos,
          { edge: direction < 0 ? "close" : "open" },
        );
      },
    },
  });
}

function makeFencedPlugin(schema: Schema) {
  return leaveLineDraft<{ lang: string }>({
    match: (text) => {
      const match = FENCE_RE.exec(text);
      if (!match) return null;
      return { data: { lang: match[1] ?? "" }, prefixLen: 3 };
    },
    draftClass: () => "fenced-code-draft",
    commit: (tr, pos, paragraph, data) => {
      const source = `\`\`\`${data.lang}\n\n\`\`\``;
      const codeBlock = schema.nodes.code_block.create(
        { lang: data.lang, liveSyntaxState: LIVE_SYNTAX_RENDERING },
        schema.text(source),
      );
      tr.replaceWith(pos, pos + paragraph.nodeSize, codeBlock);
    },
  });
}

function shouldCompleteOpeningFence(
  parentNodeType: string,
  before: string,
  after: string,
  text: string,
): boolean {
  return parentNodeType === "paragraph"
    && before + text === "```"
    && after.length === 0;
}

function fencedCodeAutocompletePlugin(schema: Schema): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (from !== to) return false;
        const $from = view.state.doc.resolve(from);
        const paragraph = $from.parent;
        if (!shouldCompleteOpeningFence(
          paragraph.type.name,
          paragraph.textBetween(0, $from.parentOffset),
          paragraph.textBetween($from.parentOffset, paragraph.content.size),
          text,
        )) return false;
        const source = "```\n```";
        const pos = $from.before();
        const codeBlock = schema.nodes.code_block.create(
          { lang: "", liveSyntaxState: LIVE_SYNTAX_EDITING },
          schema.text(source),
        );
        const tr = view.state.tr.replaceWith(pos, pos + paragraph.nodeSize, codeBlock);
        tr.setSelection(TextSelection.create(tr.doc, pos + 1 + 3));
        view.dispatch(tr);
        return true;
      },
    },
  });
}

export const fencedCode: FeatureSpec = {
  name: "code_block",

  plugins: (schema) => [
    fencedCodeAutocompletePlugin(schema),
    makeFencedPlugin(schema).plugin,
    fencedCodeSourcePlugin(),
  ],

  sourceTextInput: ({ source, from, to, text, parentNodeType }) => {
    if (from !== to) return null;
    const lineFrom = Math.max(
      source.lastIndexOf("\n", from - 1),
      source.lastIndexOf("\r", from - 1),
    ) + 1;
    let lineTo = from;
    while (lineTo < source.length && source[lineTo] !== "\r" && source[lineTo] !== "\n") {
      lineTo += 1;
    }
    if (!shouldCompleteOpeningFence(
      parentNodeType,
      source.slice(lineFrom, from),
      source.slice(to, lineTo),
      text,
    )) return null;
    const insert = `${text}\n\`\`\``;
    const head = from + text.length;
    return {
      edits: [{ from, to, insert }],
      selection: { anchor: head, head },
      origin: "input",
      reparseDerivedDocument: true,
    };
  },

  sourceKey: ({ source, selection, key, shiftKey }) => {
    if (
      key !== "Backspace"
      || shiftKey
      || selection.anchor !== selection.head
    ) return null;
    const head = selection.head;
    const blockFrom = head - 3;
    const blockTo = head + 4;
    if (
      blockFrom < 0
      || source.slice(blockFrom, blockTo) !== "```\n```"
      || (blockFrom > 0 && source[blockFrom - 1] !== "\n" && source[blockFrom - 1] !== "\r")
      || (blockTo < source.length && source[blockTo] !== "\n" && source[blockTo] !== "\r")
    ) return null;
    const nextHead = head - 1;
    return {
      edits: [{ from: nextHead, to: blockTo, insert: "" }],
      selection: { anchor: nextHead, head: nextHead },
      origin: "delete",
      reparseDerivedDocument: true,
    };
  },

  keymap: (schema) => ({
    Backspace: (state, dispatch) => {
      const selection = state.selection;
      if (!selection.empty) return false;
      const $from = selection.$from;
      const codeBlock = $from.parent;
      if (
        codeBlock.type.name !== "code_block"
        || !isFencedCodeEditing(codeBlock)
        || codeBlock.textContent !== "```\n```"
        || $from.parentOffset !== 3
      ) return false;

      if (dispatch) {
        const pos = $from.before();
        const paragraph = schema.nodes.paragraph.create(null, schema.text("``"));
        const tr = state.tr.replaceWith(pos, pos + codeBlock.nodeSize, paragraph);
        tr.setSelection(TextSelection.create(tr.doc, pos + 1 + 2));

        const sourceFrom = codeBlock.attrs[SOURCE_FROM_ATTR];
        const sourceTo = codeBlock.attrs[SOURCE_TO_ATTR];
        if (
          typeof sourceFrom === "number"
          && typeof sourceTo === "number"
          && sourceTo - sourceFrom === codeBlock.textContent.length
        ) {
          const head = sourceFrom + 2;
          tr.setMeta(SOURCE_TRANSACTION_META, {
            edits: [{ from: head, to: sourceTo, insert: "" }],
            selection: { anchor: head, head },
            origin: "delete",
            reparseDerivedDocument: true,
          });
        }
        dispatch(tr);
      }
      return true;
    },

    Enter: (state, dispatch) => {
      const selection = state.selection;
      if (!selection.empty) return false;
      const $from = selection.$from;
      if (
        $from.parent.type.name === "code_block"
        && isFencedCodeEditing($from.parent)
        && $from.parentOffset === 0
      ) {
        if (dispatch) {
          const pos = $from.before();
          const paragraph = schema.nodes.paragraph.createAndFill();
          if (!paragraph) return false;
          const tr = state.tr.insert(pos, paragraph);
          tr.setSelection(TextSelection.create(tr.doc, pos + 1));
          dispatch(tr);
        }
        return true;
      }
      if (
        $from.parent.type.name === "code_block"
        && isFencedCodeEditing($from.parent)
        && $from.parentOffset === $from.parent.content.size
      ) {
        const parsed = parseCompleteSource($from.parent.textContent);
        if (!parsed) return false;
        if (dispatch) {
          const pos = $from.before();
          const tr = state.tr.setNodeMarkup(pos, undefined, {
            ...$from.parent.attrs,
            lang: parsed.lang,
            liveSyntaxState: LIVE_SYNTAX_RENDERING,
          });
          const afterBlock = pos + $from.parent.nodeSize;
          const paragraph = schema.nodes.paragraph.createAndFill();
          if (paragraph) {
            tr.insert(afterBlock, paragraph);
            tr.setSelection(TextSelection.create(tr.doc, afterBlock + 1));
          }
          dispatch(tr);
        }
        return true;
      }
      const paragraph = $from.parent;
      if (paragraph.type.name !== "paragraph") return false;
      const match = FENCE_RE.exec(paragraph.textContent);
      if (!match) return false;
      if (dispatch) {
        const lang = match[1] ?? "";
        const source = `\`\`\`${lang}\n\n\`\`\``;
        const pos = $from.before();
        const codeBlock = schema.nodes.code_block.create(
          { lang, liveSyntaxState: LIVE_SYNTAX_EDITING },
          schema.text(source),
        );
        const bodyStart = pos + 1 + 3 + lang.length + 1;
        const tr = state.tr.replaceWith(pos, pos + paragraph.nodeSize, codeBlock);
        tr.setSelection(TextSelection.create(tr.doc, bodyStart));
        dispatch(tr);
      }
      return true;
    },
  }),
};
