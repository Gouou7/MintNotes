import type { Schema } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import type { EditorExtension } from "../core/lib";

export interface RichSyntaxOptions {
  renderMath?: (container: HTMLElement, source: string) => void | (() => void);
  renderMathBlock?: (container: HTMLElement, source: string) => void | (() => void);
  renderMermaid?: (container: HTMLElement, source: string) => void | (() => void);
  onWikiLink?: (target: string) => void;
}

export function createRichSyntaxExtension(options: RichSyntaxOptions = {}): EditorExtension {
  return {
    id: "mint-rich-syntax",
    createPlugins: ({ schema }) => [richSyntaxDecorationPlugin(schema, options)],
  };
}

function liveSyntaxWidget(
  position: number,
  className: string,
  render: (container: HTMLElement) => void | (() => void),
  key: string,
  block = false,
): Decoration {
  let reveal: (() => void) | null = null;
  let cleanup: (() => void) | null = null;
  return Decoration.widget(position, (view, getPosition) => {
    const container = document.createElement(block ? "div" : "span");
    container.className = className;
    container.contentEditable = "false";
    cleanup = render(container) ?? null;
    if (block) {
      reveal = () => {
        const target = getPosition();
        if (typeof target !== "number") return;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target + 1)));
        view.focus();
      };
      container.addEventListener("mousedown", preventDefault);
      container.addEventListener("click", reveal);
    }
    return container;
  }, {
    key,
    side: -1,
    destroy(container) {
      if (reveal) container.removeEventListener("click", reveal);
      if (block) container.removeEventListener("mousedown", preventDefault);
      cleanup?.();
    },
  });
}

function preventDefault(event: Event): void {
  event.preventDefault();
}

function inlineMathRanges(text: string): Array<{ from: number; to: number; source: string }> {
  const ranges: Array<{ from: number; to: number; source: string }> = [];
  for (let from = 0; from < text.length; from++) {
    if (
      text[from] !== "$" ||
      text[from + 1] === "$" ||
      (from > 0 && text[from - 1] === "\\") ||
      /\s/.test(text[from + 1] ?? "")
    ) continue;
    for (let to = from + 1; to < text.length; to++) {
      if (
        text[to] !== "$" ||
        text[to - 1] === "\\" ||
        text[to + 1] === "$" ||
        /\s/.test(text[to - 1] ?? "")
      ) continue;
      ranges.push({ from, to: to + 1, source: text.slice(from + 1, to) });
      from = to;
      break;
    }
  }
  return ranges;
}

function wikiLinkRanges(text: string): Array<{
  from: number;
  to: number;
  target: string;
  label: string;
}> {
  const ranges: Array<{ from: number; to: number; target: string; label: string }> = [];
  const pattern = /\[\[([^\]\n]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > 0 && text[match.index - 1] === "!") continue;
    const parts = match[1]!.split("|");
    const target = (parts.shift() ?? "").trim();
    const label = parts.join("|").trim() || target;
    if (target) ranges.push({
      from: match.index,
      to: match.index + match[0].length,
      target,
      label,
    });
  }
  return ranges;
}

function richSyntaxDecorationPlugin(schema: Schema, options: RichSyntaxOptions): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        const { selection } = state;
        state.doc.descendants((node, position, parent) => {
          if (node.type === schema.nodes.paragraph && options.renderMathBlock) {
            const match = /^\$\$([^\n]+)\$\$$/.exec(node.textContent);
            if (match) {
              const from = position + 1;
              const to = position + node.nodeSize - 1;
              const editing = selection.from >= from && selection.from <= to &&
                selection.to >= from && selection.to <= to;
              decorations.push(Decoration.node(position, position + node.nodeSize, {
                class: `live-math-block-source${editing ? " is-live-syntax-editing" : " is-live-syntax-rendered"}`,
              }));
              if (!editing) decorations.push(liveSyntaxWidget(
                position,
                "live-math-block-widget",
                (container) => options.renderMathBlock!(container, match[1]!),
                `math-block:${position}:${match[1]}`,
                true,
              ));
              return false;
            }
          }

          if (node.type === schema.nodes.code_block) {
            const language = String(node.attrs.lang ?? "").toLowerCase();
            const renderer = language === "mermaid"
              ? options.renderMermaid
              : language === "mint-math"
                ? options.renderMathBlock
                : null;
            if (!renderer) return;
            const from = position + 1;
            const to = position + node.nodeSize - 1;
            const editing = selection.from >= from && selection.to <= to;
            const kind = language === "mermaid" ? "mermaid" : "math-block";
            decorations.push(Decoration.node(position, position + node.nodeSize, {
              class: `live-${kind}-source${editing ? " is-live-syntax-editing" : " is-live-syntax-rendered"}`,
            }));
            if (!editing) decorations.push(liveSyntaxWidget(
              position,
              `live-${kind}-widget`,
              (container) => renderer(container, node.textContent),
              `${language}:${position}:${node.textContent}`,
              true,
            ));
            return false;
          }

          if (
            !node.isText ||
            node.marks.some((mark) => mark.type === schema.marks.code) ||
            parent?.type === schema.nodes.code_block
          ) return;

          const text = node.text ?? "";
          if (options.renderMath) {
            for (const range of inlineMathRanges(text)) {
              const from = position + range.from;
              const to = position + range.to;
              const editing = selection.from >= from && selection.from <= to &&
                selection.to >= from && selection.to <= to;
              if (!editing) decorations.push(Decoration.inline(from, to, {
                class: "live-inline-math-source",
              }));
              decorations.push(liveSyntaxWidget(
                to,
                "live-inline-math-widget",
                (container) => options.renderMath!(container, range.source),
                `math:${from}:${range.source}`,
              ));
            }
          }

          if (options.onWikiLink) {
            for (const range of wikiLinkRanges(text)) {
              const from = position + range.from;
              const to = position + range.to;
              const editing = selection.from >= from && selection.from <= to &&
                selection.to >= from && selection.to <= to;
              if (editing) continue;
              decorations.push(Decoration.inline(from, to, { class: "live-wikilink-source" }));
              decorations.push(liveSyntaxWidget(to, "live-wikilink-widget", (container) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "live-wikilink";
                button.textContent = range.label;
                button.setAttribute("aria-label", range.target);
                button.addEventListener("mousedown", preventDefault);
                button.addEventListener("click", () => options.onWikiLink!(range.target));
                container.appendChild(button);
                return () => button.replaceWith();
              }, `wiki:${from}:${range.target}:${range.label}`));
            }
          }
        });
        return decorations.length > 0
          ? DecorationSet.create(state.doc, decorations)
          : DecorationSet.empty;
      },
    },
  });
}
