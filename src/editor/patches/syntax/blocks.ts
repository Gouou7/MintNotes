import type { Node as PMNode } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, type NodeView } from "prosemirror-view";
import type { FeatureSpec } from "../features/_types.ts";
import type { MintContext } from "./context.ts";

export function rawBlockFeature(name: string, opening: RegExp, close?: string): FeatureSpec {
  return { name, nodes: { [name]: { group: "block", content: "text*", code: true, marks: "", attrs: { id: { default: "" } },
    toDOM: node => ["pre", { class: name, id: node.attrs.id ? `footnote-${encodeURIComponent(node.attrs.id)}` : undefined }, ["code", 0]] } },
    mdItPlugins: [md => md.block.ruler.before("reference", name, (state, start, end, silent) => {
      const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
      const match = opening.exec(line); if (!match || state.sCount[start] - state.blkIndent >= 4) return false;
      if (silent) return true;
      let next = start + 1;
      if (close && line.trim() === close) {
        while (next < end) { const text = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]); next++; if (text.trim() === close) break; }
      } else if (!close) {
        while (next < end && (state.sCount[next] - state.blkIndent >= 2 || state.isEmpty(next) && next + 1 < end && state.sCount[next + 1] - state.blkIndent >= 2)) next++;
      }
      const token = state.push(name, "", 0); token.block = true; token.content = state.getLines(start, next, state.blkIndent, false); token.meta = { id: match[1] ?? "" }; token.map = [start, next]; state.line = next; return true;
    }, { alt: ["paragraph", "blockquote", "list"] })],
    parserTokens: { [name]: (state, token, schema) => state.push(schema.nodes[name].create({ id: token.meta?.id ?? "" }, token.content ? schema.text(token.content) : undefined)) },
    blockHandlers: { [name]: (state, node) => { state.write(node.textContent.replace(/\n/g, "\n" + state.delim)); state.advance(node.content.size); state.closeBlock(node); } }
  };
}
export function blockPreviewPlugin(name: string, render: (host: HTMLElement, source: string, context: MintContext) => void | (() => void), context: MintContext, matches: (node: PMNode) => boolean = () => true): Plugin {
  return new Plugin({ props: {
    nodeViews: { [name]: (initial, view, getPos): NodeView => {
      let node: PMNode = initial, cleanup: void | (() => void);
      const dom = document.createElement("div"), pre = document.createElement("pre"), code = document.createElement("code"), preview = document.createElement("div");
      dom.className = `mint-block ${name}`; pre.append(code); preview.className = "mint-block-preview"; preview.contentEditable = "false"; dom.append(pre, preview);
      const redraw = () => { cleanup?.(); cleanup = render(preview, node.textContent, context); if (node.attrs.id) dom.id = `footnote-${encodeURIComponent(node.attrs.id)}`; };
      redraw();
      preview.addEventListener("click", () => { const pos = getPos(); if (!context.readOnly && pos !== undefined) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1))); view.focus(); } });
      return { dom, contentDOM: code, update(next) { if (next.type !== node.type) return false; if (next.textContent !== node.textContent || next.attrs.id !== node.attrs.id) { node = next; redraw(); } return true; }, ignoreMutation: mutation => !pre.contains(mutation.target), destroy() { cleanup?.(); } };
    } },
    decorations(state) { const result: Decoration[] = []; state.doc.descendants((node, pos) => {
      if (node.type.name === name && matches(node)) { const active = !context.readOnly && state.selection.from >= pos && state.selection.to <= pos + node.nodeSize;
        result.push(Decoration.node(pos, pos + node.nodeSize, { class: active ? "mint-block-editing" : "mint-block-rendered" })); return false; } return true;
    }); return DecorationSet.create(state.doc, result); }
  } });
}
