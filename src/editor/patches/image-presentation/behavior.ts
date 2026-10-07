import { Plugin, TextSelection, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { parseInline } from "../inline-parse.ts";
import type { MintContext } from "./context.ts";

function imageSourceAt(state: EditorState, pos: number): { from: number; to: number } | null {
  if (!Number.isInteger(pos) || pos < 0 || pos > state.doc.content.size) return null;
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return null;
  // Reuse the feature scanner for the current textblock. Importing normalize
  // here would create a feature registry → schema initialization cycle.
  const spans = parseInline($pos.parent.textContent, $pos.node($pos.depth - 1)).filter(span => span.type === "image");
  const span = spans.find(span => span.closeTo === $pos.parentOffset) ?? spans.find(span => $pos.parentOffset >= span.openFrom && $pos.parentOffset <= span.closeTo);
  return span ? { from: $pos.start() + span.openFrom, to: $pos.start() + span.closeTo } : null;
}

function sourceSelected(state: EditorState, from: number, to: number): boolean {
  const selection = state.selection;
  return selection.empty ? selection.from >= from && selection.from <= to : selection.from < to && selection.to > from;
}

export function imageInteractionPlugin(context: MintContext): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos, parent) => {
          if (!node.isTextblock) return true;
          if (node.type.name !== "paragraph") return false;
          const spans = parseInline(node.textContent, parent).filter(span => span.type === "image" && span.widgetDecorations?.some(widget => widget.kind === "image-render"));
          if (spans.length !== 1) return false;
          const span = spans[0];
          if (node.textContent.slice(0, span.openFrom).trim() || node.textContent.slice(span.closeTo).trim()) return false;
          const visible = !context.readOnly && sourceSelected(state, pos + 1 + span.openFrom, pos + 1 + span.closeTo);
          decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: `mint-image-paragraph${visible ? " mint-image-source-visible" : ""}` }));
          return false;
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
    view(view) {
      const update = () => {
        for (const image of view.dom.querySelectorAll<HTMLImageElement>("img.image-render[data-image-source-end]")) {
          if (image.closest(".ProseMirror") !== view.dom) continue;
          const source = imageSourceAt(view.state, Number(image.dataset.imageSourceEnd));
          const active = !context.readOnly && view.editable && source && sourceSelected(view.state, source.from, source.to);
          // Applying the outline only changes a class, preserving the
          // preview's current load/retry state.
          image.classList.toggle("mint-image-selected", !!active);
        }
      };
      const click = (event: MouseEvent) => {
        if (context.readOnly || !view.editable || view.composing || event.button !== 0 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
        const image = event.target instanceof Element ? event.target.closest<HTMLImageElement>("img.image-render[data-image-source-end]") : null;
        if (!image || image.closest(".ProseMirror") !== view.dom) return;
        const tail = Number(image.dataset.imageSourceEnd), source = imageSourceAt(view.state, tail);
        if (!source || source.to !== tail) return;
        event.preventDefault();
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, source.to)).setMeta("addToHistory", false).scrollIntoView());
        view.focus();
      };
      view.dom.addEventListener("click", click);
      update();
      return { update, destroy() { view.dom.removeEventListener("click", click); } };
    },
  });
}
