import { Fragment, Slice, type Node as PMNode } from "prosemirror-model";
import { closeHistory } from "prosemirror-history";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { MintContext } from "./context.ts";
import { mathBlockSource, mathBodySelection } from "./math-syntax.ts";

export const mathBehaviorKey = new PluginKey("mintMathBehavior");

function mathReplacement(doc: PMNode, pos: number, block: PMNode): Fragment | null {
  const $pos = doc.resolve(pos), index = $pos.index();
  const filler = $pos.parent.type.name === "list_item" && index === 0 ? doc.type.schema.nodes.paragraph.create() : null;
  const content = Fragment.fromArray(filler ? [filler, block] : [block]);
  return $pos.parent.canReplace(index, index + 1, content) ? content : null;
}

function leaveMath(view: EditorView, pos: number, direction: -1 | 1): boolean {
  const node = view.state.doc.nodeAt(pos); if (!node) return false;
  const boundary = direction < 0 ? pos : pos + node.nodeSize;
  const $boundary = view.state.doc.resolve(boundary);
  const neighbor = direction < 0 ? $boundary.nodeBefore : $boundary.nodeAfter;
  const tr = view.state.tr;
  if (neighbor?.type.name === "mint_math_block") {
    const target = direction < 0 ? boundary - neighbor.nodeSize : boundary;
    const body = mathBodySelection(neighbor.textContent);
    tr.setSelection(TextSelection.create(tr.doc, target + 1 + (direction < 0 ? body.end : body.start)));
  } else if (neighbor) {
    tr.setSelection(TextSelection.near($boundary, direction));
  } else {
    const paragraph = view.state.schema.nodes.paragraph.createAndFill();
    if (!paragraph || !$boundary.parent.canReplaceWith($boundary.index(), $boundary.index(), paragraph.type)) return false;
    tr.insert(boundary, paragraph).setSelection(TextSelection.create(tr.doc, boundary + 1));
  }
  view.dispatch(tr.scrollIntoView()); view.focus(); return true;
}

export function mathBehavior(context: MintContext): Plugin {
  let currentView: EditorView | undefined, composing = false, timer: ReturnType<typeof setTimeout> | undefined;
  return new Plugin({
    key: mathBehaviorKey,
    view(view) {
      currentView = view;
      return { destroy() { currentView = undefined; if (timer) clearTimeout(timer); } };
    },
    appendTransaction(transactions, _oldState, state) {
      if (context.readOnly || composing || currentView?.composing || !transactions.some(tr => tr.docChanged || tr.getMeta("mint-math-normalize"))) return null;
      const tr = state.tr;
      state.doc.descendants((node, pos) => {
        if (node.type.name !== "paragraph" || !node.childCount || !node.content.content.every(child => child.isText && !child.marks.some(mark => mark.type.name === "code"))) return true;
        if (!mathBlockSource(node.textContent)?.body.trim()) return false;
        const mapped = tr.mapping.map(pos);
        const block = state.schema.nodes.mint_math_block.create(null, state.schema.text(node.textContent));
        const anchor = state.selection.anchor, head = state.selection.head;
        const content = mathReplacement(tr.doc, mapped, block);
        if (!content) return false;
        const formulaPos = mapped + content.size - block.nodeSize;
        tr.replaceWith(mapped, mapped + node.nodeSize, content);
        if (state.selection instanceof TextSelection && anchor >= pos + 1 && anchor <= pos + node.nodeSize - 1 && head >= pos + 1 && head <= pos + node.nodeSize - 1) {
          tr.setSelection(TextSelection.create(tr.doc, formulaPos + anchor - pos, formulaPos + head - pos));
        }
        return false;
      });
      return tr.docChanged ? tr : null;
    },
    props: {
      handleDOMEvents: {
        compositionstart: () => { composing = true; return false; },
        compositionend: () => {
          composing = false;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => { timer = undefined; if (currentView && !currentView.composing) currentView.dispatch(currentView.state.tr.setMeta("mint-math-normalize", true)); }, 25);
          return false;
        },
        "mint-math-edit": (view, event) => {
          if (context.readOnly || composing || view.composing) return false;
          const { from, to, source, width } = (event as CustomEvent<{ from: number; to: number; source: string; width: number }>).detail;
          if (from < 0 || to > view.state.doc.content.size || view.state.doc.textBetween(from, to) !== source) return false;
          event.preventDefault();
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from + width)).scrollIntoView());
          view.focus(); return true;
        },
      },
      handlePaste(view, event) {
        if (context.readOnly || composing || view.composing || view.state.selection.$from.parent.type.spec.code || event.clipboardData?.getData("text/html")) return false;
        const source = event.clipboardData?.getData("text/plain").replace(/\r\n?/g, "\n");
        if (!source || !mathBlockSource(source)?.body.trim()) return false;
        const block = view.state.schema.nodes.mint_math_block.create(null, view.state.schema.text(source));
        const $from = view.state.selection.$from;
        if (!$from.depth || !mathReplacement(view.state.doc, $from.before(), block)) return false;
        view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(block), 0, 0)).scrollIntoView());
        return true;
      },
      handleKeyDown(view, event) {
        if (context.readOnly || composing || view.composing || event.isComposing || event.shiftKey || event.altKey) return false;
        const { state } = view, selection = state.selection;
        if (!(selection instanceof TextSelection)) return false;
        const $from = selection.$from, parent = $from.parent;
        if (event.key === "Enter") {
          if (parent.type.name === "mint_math_block") {
            const math = mathBlockSource(parent.textContent);
            if (event.ctrlKey || event.metaKey || selection.empty && math && $from.parentOffset > math.contentTo) return leaveMath(view, $from.before(), 1);
            if (selection.$to.parent !== parent) return false;
            view.dispatch(state.tr.insertText("\n").scrollIntoView()); return true;
          }
          if (event.ctrlKey || event.metaKey || !selection.empty || parent.type.name !== "paragraph" || !/^\$\$[ \t]*$/.test(parent.textContent)) return false;
          const pos = $from.before(), source = "$$\n\n$$";
          const node = state.schema.nodes.mint_math_block.create(null, state.schema.text(source));
          const content = mathReplacement(state.doc, pos, node); if (!content) return false;
          const tr = closeHistory(state.tr).replaceWith(pos, pos + parent.nodeSize, content);
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + content.size - node.nodeSize + 4)).scrollIntoView()); return true;
        }
        if (event.ctrlKey || event.metaKey || !selection.empty || event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
        const direction = event.key === "ArrowUp" ? -1 : 1;
        if (parent.type.name === "mint_math_block") {
          const body = mathBodySelection(parent.textContent);
          if (direction < 0 ? $from.parentOffset <= body.start : $from.parentOffset >= body.end) return leaveMath(view, $from.before(), direction);
          return false;
        }
        if (!$from.depth || !parent.isTextblock || parent.type.spec.code) return false;
        const atEdge = direction < 0 ? $from.parentOffset === 0 : $from.parentOffset === parent.content.size;
        if (!atEdge && !view.endOfTextblock(direction < 0 ? "up" : "down")) return false;
        const boundary = direction < 0 ? $from.before() : $from.after(), $boundary = state.doc.resolve(boundary);
        const neighbor = direction < 0 ? $boundary.nodeBefore : $boundary.nodeAfter;
        if (neighbor?.type.name !== "mint_math_block") return false;
        const pos = direction < 0 ? boundary - neighbor.nodeSize : boundary, body = mathBodySelection(neighbor.textContent);
        view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos + 1 + (direction < 0 ? body.end : body.start))).scrollIntoView());
        return true;
      },
    },
  });
}
