import type { Node as PMNode, Schema } from "prosemirror-model";
import { Plugin, Selection, TextSelection } from "prosemirror-state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeView,
} from "prosemirror-view";

import { leaveLineDraft } from "../block-draft";
import type { FeatureSpec } from "./_types";

// Fenced code blocks have two Live-mode representations:
//
//   rendered: code_block(lang, sourceEditing=false) contains only the body.
//   source:   code_block(lang, sourceEditing=true) contains the complete
//             Markdown source, including both fences.
//
// Keeping the active source in the document makes every character a real
// ProseMirror position. The caret can therefore move through the opening
// fence, body, and closing fence using the browser's normal editing behavior.
// The serializer writes active source verbatim, so React still receives
// canonical Markdown rather than a private Live-mode representation.

const FENCE_RE = /^```(\w*)$/;
const COMPLETE_FENCE_RE = /^```([^\n]*)\n([\s\S]*)\n```$/;

type SourceTarget =
  | { edge: "open" | "close" }
  | { bodyOffset: number };

function textContent(schema: Schema, value: string) {
  return value.length > 0 ? schema.text(value) : null;
}

function sourceFor(node: PMNode): string {
  return `\`\`\`${String(node.attrs.lang ?? "")}\n${node.textContent}\n\`\`\``;
}

function parseCompleteSource(source: string): { lang: string; body: string } | null {
  const match = COMPLETE_FENCE_RE.exec(source);
  if (!match) return null;
  return { lang: match[1] ?? "", body: match[2] ?? "" };
}

function isSourceEditing(node: PMNode): boolean {
  return node.type.name === "code_block" && node.attrs.sourceEditing === true;
}

function sourceOffset(node: PMNode, target: SourceTarget): number {
  const source = sourceFor(node);
  if ("edge" in target) {
    return target.edge === "open" ? 0 : source.length;
  }
  const prefixLength = 3 + String(node.attrs.lang ?? "").length + 1;
  return Math.min(prefixLength + Math.max(0, target.bodyOffset), source.length - 4);
}

function activateSource(view: EditorView, pos: number, target: SourceTarget): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "code_block") return false;

  if (isSourceEditing(node)) {
    const offset = "edge" in target
      ? target.edge === "open" ? 0 : node.content.size
      : Math.min(Math.max(0, target.bodyOffset), node.content.size);
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1 + offset)),
    );
    (view as EditorView & { focus?: () => void }).focus?.();
    return true;
  }

  const source = sourceFor(node);
  const activeNode = node.type.create(
    { ...node.attrs, sourceEditing: true },
    textContent(view.state.schema, source),
  );
  const offset = sourceOffset(node, target);
  const tr = view.state.tr
    .replaceWith(pos, pos + node.nodeSize, activeNode)
    .setMeta("addToHistory", false);
  tr.setSelection(TextSelection.create(tr.doc, pos + 1 + offset));
  view.dispatch(tr);
  (view as EditorView & { focus?: () => void }).focus?.();
  return true;
}

function displayLanguage(lang: string): string {
  const normalized = lang.trim().toLowerCase();
  const names: Record<string, string> = {
    bash: "Shell",
    sh: "Shell",
    shell: "Shell",
    zsh: "Shell",
    js: "JavaScript",
    javascript: "JavaScript",
    ts: "TypeScript",
    typescript: "TypeScript",
    py: "Python",
    python: "Python",
    html: "HTML",
    css: "CSS",
    json: "JSON",
    yaml: "YAML",
    yml: "YAML",
    md: "Markdown",
    markdown: "Markdown",
  };
  return names[normalized] ?? lang.trim();
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

function codeCommentDecorations(state: EditorView["state"]): DecorationSet | null {
  const decorations: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "code_block") return;
    const source = node.textContent;
    const parsed = isSourceEditing(node) ? parseCompleteSource(source) : null;
    const lang = parsed?.lang ?? String(node.attrs.lang ?? "");
    const pattern = commentPattern(lang);
    let offset = 0;
    for (const line of source.split("\n")) {
      const isFenceLine = isSourceEditing(node)
        && (offset === 0 || offset + line.length === source.length);
      if (!isFenceLine && pattern.test(line) && line.length > 0) {
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

  constructor(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    this.view = view;
    this.getPos = getPos;
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
    label.addEventListener("mousedown", this.onLabelMouseDown);
  }

  private onLabelMouseDown = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const pos = this.getPos();
    if (pos != null) activateSource(this.view, pos, { edge: "open" });
  };

  private applyNode(node: PMNode): void {
    const lang = String(node.attrs.lang ?? "");
    const editing = isSourceEditing(node);
    if (lang) this.dom.setAttribute("data-lang", lang);
    else this.dom.removeAttribute("data-lang");
    if (editing) this.dom.setAttribute("data-source-editing", "1");
    else this.dom.removeAttribute("data-source-editing");
    this.dom.classList.toggle("cb-source-editing", editing);
    this.labelEl.textContent = displayLanguage(lang);
    this.labelEl.hidden = editing || lang.trim().length === 0;
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "code_block") return false;
    this.applyNode(node);
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.labelEl.contains(event.target as Node);
  }

  ignoreMutation(mutation: { target: Node }): boolean {
    return this.labelEl.contains(mutation.target);
  }

  destroy(): void {
    this.labelEl.removeEventListener("mousedown", this.onLabelMouseDown);
  }
}

function adjacentCodeBlock(
  state: EditorView["state"],
  direction: -1 | 1,
): { pos: number; node: PMNode } | null {
  const selection = state.selection;
  if (!selection.empty || selection.$from.depth < 1) return null;
  const $from = selection.$from;
  const atBoundary = direction < 0
    ? $from.parentOffset === 0
    : $from.parentOffset === $from.parent.content.size;
  if (!atBoundary) return null;

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

function codeBlockAtSelection(state: EditorView["state"]): {
  pos: number;
  node: PMNode;
  offset: number;
} | null {
  if (!state.selection.empty) return null;
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "code_block") {
      return {
        pos: $from.before(depth),
        node,
        offset: $from.pos - $from.start(depth),
      };
    }
  }
  return null;
}

function moveSourceVertically(view: EditorView, direction: -1 | 1): boolean {
  const { state } = view;
  const selection = state.selection;
  if (!selection.empty || selection.$from.parent.type.name !== "code_block") return false;
  const node = selection.$from.parent;
  if (!isSourceEditing(node)) return false;

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
      targetOffset = nextStart + Math.min(column, nextEnd - nextStart);
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
  const outside = Selection.findFrom(state.doc.resolve(boundary), direction, true);
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
  view.dispatch(tr);
  return true;
}

function fencedCodeSourcePlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.selectionSet || tr.docChanged)) return null;

      const oldCode = codeBlockAtSelection(oldState);
      const newCode = codeBlockAtSelection(newState);
      if (
        newCode
        && !isSourceEditing(newCode.node)
        && !oldState.selection.eq(newState.selection)
        && oldCode?.pos !== newCode.pos
      ) {
        const source = sourceFor(newCode.node);
        const activeNode = newCode.node.type.create(
          { ...newCode.node.attrs, sourceEditing: true },
          textContent(newState.schema, source),
        );
        let offset: number;
        if (oldState.doc.eq(newState.doc) && oldState.selection.from <= newCode.pos) {
          offset = 0;
        } else if (
          oldState.doc.eq(newState.doc)
          && oldState.selection.from >= newCode.pos + newCode.node.nodeSize
        ) {
          offset = source.length;
        } else {
          const prefixLength = 3 + String(newCode.node.attrs.lang ?? "").length + 1;
          offset = prefixLength + newCode.offset;
        }
        const tr = newState.tr
          .replaceWith(newCode.pos, newCode.pos + newCode.node.nodeSize, activeNode)
          .setMeta("addToHistory", false);
        tr.setSelection(TextSelection.create(tr.doc, newCode.pos + 1 + offset));
        return tr;
      }

      const activePos = newCode?.pos ?? null;

      const collapsible: Array<{
        pos: number;
        node: PMNode;
        parsed: { lang: string; body: string };
      }> = [];
      newState.doc.descendants((node, pos) => {
        if (!isSourceEditing(node) || pos === activePos) return;
        const parsed = parseCompleteSource(node.textContent);
        if (parsed) collapsible.push({ pos, node, parsed });
      });
      if (collapsible.length === 0) return null;

      const tr = newState.tr.setMeta("addToHistory", false);
      for (const item of collapsible.reverse()) {
        const rendered = item.node.type.create(
          { ...item.node.attrs, lang: item.parsed.lang, sourceEditing: false },
          textContent(newState.schema, item.parsed.body),
        );
        tr.replaceWith(item.pos, item.pos + item.node.nodeSize, rendered);
      }
      return tr;
    },
    props: {
      decorations: codeCommentDecorations,
      nodeViews: {
        code_block: (node, view, getPos) => new CodeBlockView(node, view, getPos),
      },
      handleClickOn(view, pos, node, nodePos, event, direct) {
        if (!direct || node.type.name !== "code_block" || isSourceEditing(node)) return false;
        const target = event.target as HTMLElement | null;
        if (target?.closest(".cb-language-label")) {
          return activateSource(view, nodePos, { edge: "open" });
        }

        const rect = target?.closest("pre")?.getBoundingClientRect();
        if (rect && rect.height > 0) {
          const edgeZone = Math.min(28, rect.height / 3);
          if (event.clientY <= rect.top + edgeZone) {
            return activateSource(view, nodePos, { edge: "open" });
          }
          if (event.clientY >= rect.bottom - edgeZone) {
            return activateSource(view, nodePos, { edge: "close" });
          }
        }
        return activateSource(view, nodePos, {
          bodyOffset: Math.min(Math.max(0, pos - nodePos - 1), node.content.size),
        });
      },
      handleKeyDown(view, event) {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return false;
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
        const state = view.state;
        if (!state.selection.empty) return false;
        const $from = state.selection.$from;

        if ($from.parent.type.name === "code_block") {
          if (isSourceEditing($from.parent)) {
            return moveSourceVertically(view, event.key === "ArrowUp" ? -1 : 1);
          } else {
            if (event.key === "ArrowUp" && $from.parentOffset === 0) {
              return activateSource(view, $from.before(), { edge: "open" });
            }
            if (
              event.key === "ArrowDown"
              && $from.parentOffset === $from.parent.content.size
            ) {
              return activateSource(view, $from.before(), { edge: "close" });
            }
          }
        }

        const direction = event.key === "ArrowUp" ? -1 : 1;
        const adjacent = adjacentCodeBlock(state, direction);
        if (!adjacent) return false;
        return activateSource(
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
      const codeBlock = schema.nodes.code_block.create(
        { lang: data.lang, sourceEditing: false },
        null,
      );
      tr.replaceWith(pos, pos + paragraph.nodeSize, codeBlock);
    },
  });
}

export const fencedCode: FeatureSpec = {
  name: "code_block",

  plugins: (schema) => [makeFencedPlugin(schema).plugin, fencedCodeSourcePlugin()],

  keymap: (schema) => ({
    Enter: (state, dispatch) => {
      const selection = state.selection;
      if (!selection.empty) return false;
      const $from = selection.$from;
      if (
        $from.parent.type.name === "code_block"
        && isSourceEditing($from.parent)
        && $from.parentOffset === $from.parent.content.size
      ) {
        const parsed = parseCompleteSource($from.parent.textContent);
        if (!parsed) return false;
        if (dispatch) {
          const pos = $from.before();
          const rendered = $from.parent.type.create(
            { ...$from.parent.attrs, lang: parsed.lang, sourceEditing: false },
            textContent(schema, parsed.body),
          );
          const tr = state.tr.replaceWith(pos, pos + $from.parent.nodeSize, rendered);
          const afterBlock = pos + rendered.nodeSize;
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
          { lang, sourceEditing: true },
          schema.text(source),
        );
        const bodyStart = pos + 1 + 3 + lang.length + 1;
        const tr = state.tr.replaceWith(pos, pos + paragraph.nodeSize, codeBlock);
        tr.setSelection(TextSelection.create(tr.doc, bodyStart));
        dispatch(tr);
      }
      return true;
    },

    Backspace: (state, dispatch) => {
      const selection = state.selection;
      if (!selection.empty) return false;
      const $from = selection.$from;
      if ($from.parent.type.name !== "code_block") return false;
      if ($from.parent.content.size > 0) return false;
      if (dispatch) {
        const pos = $from.before();
        const tr = state.tr.delete(pos, pos + $from.parent.nodeSize);
        if (tr.doc.content.size === 0) {
          const paragraph = schema.nodes.paragraph.createAndFill();
          if (paragraph) tr.insert(0, paragraph);
        }
        dispatch(tr);
      }
      return true;
    },
  }),
};
