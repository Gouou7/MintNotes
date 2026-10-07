import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { literalFeature, literals } from "./syntax.ts";
import { rawBlockFeature, blockPreviewPlugin } from "./blocks.ts";
import type { FeatureSpec } from "../features/_types.ts";
import type { MintContext } from "./context.ts";
import type { Node as PMNode } from "prosemirror-model";
function footnotesPlugin(context: MintContext): Plugin {
  const backlinkCleanup = new Map<HTMLElement, () => void>();
  const backlinks = (id: string, note: { number: number; positions: number[] }) => {
    const host = document.createElement("span"), disposers: (() => void)[] = [];
    host.className = "mint-footnote-backlinks"; host.contentEditable = "false";
    for (const at of note.positions) {
      const link = document.createElement("a"); link.href = `#footnote-ref-${encodeURIComponent(id)}-${at}`;
      link.setAttribute("aria-label", context.label?.("backToFootnote") ?? "Back to footnote reference");
      const icon = context.icon?.("footnote-back");
      if (icon) { link.append(icon.element); disposers.push(icon.destroy); } else link.textContent = String(note.number);
      link.addEventListener("click", event => { event.preventDefault();
        const root = host.closest(".typora-web-editor-host");
        [...root?.querySelectorAll<HTMLElement>("[id]") ?? []].find(element => element.id === link.hash.slice(1))?.scrollIntoView({ block: "nearest" });
      }); host.append(link);
    }
    return { host, destroy: () => disposers.forEach(dispose => dispose()) };
  };
  const index = (doc: PMNode) => {
    const notes: NonNullable<MintContext["footnotes"]> = new Map();
    doc.descendants((node, pos) => {
      if (node.type.spec.code) return false;
      if (!node.isTextblock) return true;
      for (const literal of literals(node.textContent)) {
        if (literal.kind !== "footnote-ref" && literal.kind !== "inline-footnote") continue;
        const at = pos + 1 + literal.from, id = literal.kind === "inline-footnote" ? `inline-${at}` : literal.target!;
        const note = notes.get(id) ?? { number: notes.size + 1, positions: [], body: literal.kind === "inline-footnote" ? literal.body : undefined };
        note.positions.push(at); notes.set(id, note);
      }
      return false;
    }); context.footnotes = notes; return notes;
  };
  return new Plugin({
    state: { init: (_, state) => index(state.doc), apply: (tr, notes) => tr.docChanged ? index(tr.doc) : notes },
    props: { decorations(state) {
      const decos: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== "mint_footnote") return true;
        const id = /^\[\^([^\]]+)\]:/.exec(node.textContent)?.[1] ?? node.attrs.id;
        const note = context.footnotes?.get(id);
        decos.push(Decoration.node(pos, pos + node.nodeSize, { id: `footnote-${encodeURIComponent(id)}`, "data-footnote-number": String(note?.number ?? id) }));
        if (note) decos.push(Decoration.widget(pos + node.nodeSize, () => {
          const links = backlinks(id, note); backlinkCleanup.set(links.host, links.destroy); return links.host;
        }, { side: -1, key: `footnote-back-${id}-${note.positions.join()}`,
          destroy: element => { backlinkCleanup.get(element as HTMLElement)?.(); backlinkCleanup.delete(element as HTMLElement); }
        })); return false;
      }); return DecorationSet.create(state.doc, decos);
    } },
    view(view) {
      const footer = document.createElement("div"); footer.className = "mint-inline-footnotes"; footer.contentEditable = "false";
      view.dom.parentElement?.append(footer); let last = "", cleanups: (() => void)[] = [];
      const update = () => {
        const notes = [...context.footnotes ?? []].filter(([, note]) => note.body !== undefined);
        const key = JSON.stringify(notes); if (key === last) return; last = key;
        cleanups.forEach(dispose => dispose()); cleanups = []; footer.replaceChildren();
        for (const [id, note] of notes) {
          const item = document.createElement("div"), label = document.createElement("span"), body = document.createElement("div"); item.id = `footnote-${encodeURIComponent(id)}`;
          label.textContent = String(note.number) + ". "; item.append(label, body); footer.append(item);
          const cleanup = context.renderMarkdown?.(body, note.body!); if (cleanup) cleanups.push(cleanup); else body.textContent = note.body!;
          const links = backlinks(id, note); item.append(links.host); cleanups.push(links.destroy);
        }
      }; update(); return { update, destroy() { cleanups.forEach(dispose => dispose()); backlinkCleanup.forEach(dispose => dispose()); backlinkCleanup.clear(); footer.remove(); } };
    }
  });
}
export const footnoteReference: FeatureSpec = { ...literalFeature("mint-footnote-reference", ["footnote-ref", "inline-footnote"]), plugins: (_schema, context = {}) => [footnotesPlugin(context)] };
export const footnoteDefinition: FeatureSpec = { ...rawBlockFeature("mint_footnote", /^\[\^([^\]]+)\]:/),
  plugins: (_schema, context = {}) => [blockPreviewPlugin("mint_footnote", (host, source) => {
    const body = source.replace(/^\[\^[^\]]+\]:\s*/, "").replace(/\n {2,4}/g, "\n");
    if (context.renderMarkdown) return context.renderMarkdown(host, body); host.textContent = body;
  }, context)]
};
