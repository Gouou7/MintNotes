import { Plugin, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { literalFeature } from "./syntax.ts";
import type { FeatureSpec } from "../features/_types.ts";
export const callout: FeatureSpec = { ...literalFeature("mint-callout", ["callout-marker"]),
  plugins: (_schema, context = {}) => [new Plugin({ props: {
    nodeViews: { blockquote: (initial, view, getPos) => {
      const appearance = (node: typeof initial) => context.parseCallout?.(node.firstChild?.type.name === "paragraph" ? node.firstChild.textContent.split("\n")[0] : "");
      if (!appearance(initial)) {
        const dom = document.createElement("blockquote");
        return { dom, contentDOM: dom, update: next => next.type === initial.type && !appearance(next) };
      }
      let node = initial, folded: boolean | null = null;
      let icons: (() => void)[] = [];
      const dom = document.createElement("blockquote"), header = document.createElement("div"), content = document.createElement("div");
      header.className = "callout-header"; header.contentEditable = "false"; content.className = "callout-content"; dom.append(header, content);
      const draw = () => {
        icons.forEach(dispose => dispose()); icons = []; header.replaceChildren();
        const marker = node.firstChild?.type.name === "paragraph" ? node.firstChild.textContent.split("\n")[0] : "";
        const appearance = context.parseCallout?.(marker ?? "");
        if (!appearance) { dom.className = ""; header.hidden = true; folded = null; return; }
        header.hidden = false;
        if (folded === null) folded = appearance.fold === "-";
        const presentation = ["mint-callout-editing", "mint-callout-rendered"].filter(name => dom.classList.contains(name)).join(" ");
        dom.className = `${presentation} markdown-callout callout-${appearance.kind}${appearance.color ? ` callout-color-${appearance.color}` : ""}${folded ? " mint-callout-folded" : ""}`;
        const addIcon = (parent: HTMLElement, name: string) => { const icon = context.icon?.(name); if (icon) { parent.append(icon.element); icons.push(icon.destroy); } };
        if (appearance.fold) {
          const toggle = document.createElement("button"); toggle.type = "button"; toggle.setAttribute("aria-label", context.label?.("toggleCallout") ?? appearance.title); toggle.setAttribute("aria-expanded", String(!folded));
          addIcon(toggle, folded ? "chevron-right" : "chevron-down");
          toggle.addEventListener("click", event => { event.stopPropagation(); folded = !folded; draw(); }); header.append(toggle);
        }
        addIcon(header, `callout-${appearance.icon ?? appearance.kind}`);
        const title = document.createElement("strong"); title.textContent = appearance.title; header.append(title);
      };
      draw();
      header.addEventListener("mousedown", event => event.preventDefault());
      header.addEventListener("click", () => { const pos = getPos(); if (context.readOnly || pos === undefined) return; folded = false; draw(); view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos + 2)))); view.focus(); });
      return { dom, contentDOM: content, update(next) { if (next.type !== node.type || !appearance(next)) return false; node = next; draw(); return true; }, ignoreMutation: mutation => header.contains(mutation.target) || mutation.target === dom && mutation.type === "attributes", destroy() { icons.forEach(dispose => dispose()); } };
    } },
    decorations(state) {
      const decorations: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== "blockquote" || !node.firstChild || !context.parseCallout?.(node.firstChild.textContent.split("\n")[0])) return true;
        const active = !context.readOnly && state.selection.from >= pos && state.selection.to <= pos + node.nodeSize;
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: active ? "mint-callout-editing" : "mint-callout-rendered" }));
        const line = node.firstChild.textContent.split("\n")[0];
        if (line.length === node.firstChild.textContent.length) decorations.push(Decoration.node(pos + 1, pos + 1 + node.firstChild.nodeSize, { class: "callout-source-marker" }));
        else decorations.push(Decoration.inline(pos + 2, pos + 2 + line.length + 1, { class: "callout-marker-source" })); return true;
      });
      return DecorationSet.create(state.doc, decorations);
    }
  } })]
};
