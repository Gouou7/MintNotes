import { Plugin, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, type NodeView } from "prosemirror-view";
import type { MintContext } from "./context.ts";
import { mathBlockSource, mathBodySelection } from "./math-syntax.ts";
import { mathPreview } from "./math-preview.ts";

export function mathBlockView(context: MintContext): Plugin {
  return new Plugin({ props: {
    nodeViews: { mint_math_block: (initial, view, getPos): NodeView => {
      let node = initial, revision = context.revision, cleanup: (() => void) | undefined;
      const dom = document.createElement("div"), pre = document.createElement("pre"), code = document.createElement("code"), preview = document.createElement("div");
      dom.className = "mint-math-block mint_math_block"; pre.append(code);
      preview.className = "mint-math-preview"; preview.contentEditable = "false"; dom.append(pre, preview);
      const redraw = () => {
        cleanup?.(); cleanup = undefined;
        const math = mathBlockSource(node.textContent);
        const renderable = !!math?.body.trim();
        dom.classList.toggle("mint-math-incomplete", !renderable);
        if (math && renderable) cleanup = mathPreview(preview, math.body, true, context);
        else preview.replaceChildren();
      };
      const enter = (event: MouseEvent) => {
        if (context.readOnly || view.composing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
        const pos = getPos(); if (pos === undefined) return;
        event.preventDefault();
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1 + mathBodySelection(node.textContent).start)).scrollIntoView());
        view.focus();
      };
      const preserveSelection = (event: MouseEvent) => { if (!context.readOnly && event.button === 0 && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) event.preventDefault(); };
      preview.addEventListener("mousedown", preserveSelection);
      preview.addEventListener("click", enter);
      redraw();
      return { dom, contentDOM: code,
        update(next) {
          if (next.type !== node.type) return false;
          const changed = next.textContent !== node.textContent || revision !== context.revision;
          node = next; revision = context.revision; if (changed) redraw();
          return true;
        },
        ignoreMutation: mutation => mutation.type === "selection" ? false : !code.contains(mutation.target),
        destroy() { preview.removeEventListener("mousedown", preserveSelection); preview.removeEventListener("click", enter); cleanup?.(); },
      };
    } },
    decorations(state) {
      const decorations: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== "mint_math_block") return true;
        const active = !context.readOnly && state.selection.from <= pos + node.nodeSize - 1 && state.selection.to >= pos + 1;
        decorations.push(Decoration.node(pos, pos + node.nodeSize, {
          class: active ? "mint-math-editing" : "mint-math-rendered",
          "data-mint-presentation": `${context.revision ?? 0}:${context.readOnly ? 1 : 0}`,
        }));
        const math = mathBlockSource(node.textContent, true);
        if (math) {
          decorations.push(Decoration.inline(pos + 1 + math.from, pos + 1 + math.contentFrom, { class: "syntax-hint" }));
          if (math.complete) decorations.push(Decoration.inline(pos + 1 + math.contentTo, pos + 1 + math.to, { class: "syntax-hint" }));
        }
        return false;
      });
      return DecorationSet.create(state.doc, decorations);
    },
  } });
}
