import { Plugin, TextSelection } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { Decoration, DecorationSet } from "prosemirror-view";
import { literalFeature } from "./syntax.ts";
import type { FeatureSpec } from "../features/_types.ts";

/** Resolve a click on the rendered title before exposing its source text. */
function titleOffsetAtPoint(title: HTMLElement, x: number, y: number): number {
  const doc = title.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const caret = doc.caretPositionFromPoint?.(x, y);
  const range = caret ? undefined : doc.caretRangeFromPoint?.(x, y);
  const node = caret?.offsetNode ?? range?.startContainer;
  const offset = caret?.offset ?? range?.startOffset;
  if (node && offset !== undefined && title.contains(node)) {
    const prefix = doc.createRange(); prefix.selectNodeContents(title); prefix.setEnd(node, offset);
    return prefix.toString().length;
  }
  return x <= title.getBoundingClientRect().left ? 0 : title.textContent?.length ?? 0;
}

export const callout: FeatureSpec = {
  ...literalFeature("mint-callout", ["callout-marker"]),
  plugins: (_schema, context = {}) => [new Plugin({ props: {
    handleKeyDown(view, event) {
      if (context.readOnly || view.composing || event.isComposing || event.key !== "Backspace" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
      const { selection } = view.state, { $from } = selection;
      if (!selection.empty || $from.parent.type.name !== "paragraph" || $from.parent.content.size || $from.parentOffset || $from.depth < 2) return false;
      const quote = $from.node(-1);
      // Only remove the sole empty body paragraph; never swallow a nested or nonempty body.
      if (quote.type.name !== "blockquote" || quote.childCount !== 2 || $from.index(-1) !== 1 || !context.parseCallout?.(quote.firstChild?.textContent ?? "")) return false;
      const markerEnd = $from.before() - 1;
      const transaction = closeHistory(view.state.tr.delete($from.before(), $from.after()));
      view.dispatch(transaction.setSelection(TextSelection.create(transaction.doc, markerEnd)).scrollIntoView());
      return true;
    },
    nodeViews: { blockquote: (initial, view, getPos) => {
      const markerText = (node: typeof initial) => node.firstChild?.type.name === "paragraph" ? node.firstChild.textContent.split("\n")[0] : "";
      const appearance = (node: typeof initial) => context.parseCallout?.(markerText(node));
      if (!appearance(initial)) {
        const dom = document.createElement("blockquote");
        return { dom, contentDOM: dom, update: next => next.type === initial.type && !appearance(next) };
      }
      let node = initial, folded: boolean | null = null;
      let drawnMarker = "", drawnRevision: number | undefined;
      let icons: (() => void)[] = [];
      const dom = document.createElement("blockquote"), header = document.createElement("div"), content = document.createElement("div");
      header.className = "callout-header"; header.contentEditable = "false"; content.className = "callout-content"; dom.append(header, content);
      const draw = () => {
        icons.forEach(dispose => dispose()); icons = []; header.replaceChildren();
        const current = appearance(node);
        if (!current) return;
        drawnMarker = markerText(node); drawnRevision = context.revision;
        if (folded === null) folded = current.fold === "-";
        const presentation = ["mint-callout-editing", "mint-callout-rendered"].filter(name => dom.classList.contains(name)).join(" ");
        dom.className = `${presentation} markdown-callout callout-${current.kind}${current.color ? ` callout-color-${current.color}` : ""}${folded ? " mint-callout-folded" : ""}`;
        const addIcon = (parent: HTMLElement, name: string) => { const icon = context.icon?.(name); if (icon) { parent.append(icon.element); icons.push(icon.destroy); } };
        if (current.fold) {
          const toggle = document.createElement("button"); toggle.type = "button"; toggle.setAttribute("aria-label", context.label?.("toggleCallout") ?? current.title); toggle.setAttribute("aria-expanded", String(!folded));
          addIcon(toggle, folded ? "chevron-right" : "chevron-down");
          toggle.addEventListener("click", event => { event.stopPropagation(); folded = !folded; draw(); }); header.append(toggle);
        }
        const icon = document.createElement("span"); icon.className = "callout-icon"; addIcon(icon, `callout-${current.icon ?? current.kind}`); header.append(icon);
        const title = document.createElement("strong"); title.textContent = current.title; header.append(title);
      };
      draw();
      header.addEventListener("mousedown", event => event.preventDefault());
      header.addEventListener("click", event => {
        const pos = getPos(), current = appearance(node);
        if (context.readOnly || pos === undefined || !current) return;
        const title = event.target instanceof Element ? event.target.closest("strong") : null;
        const titleSource = current.titleSource;
        const offset = title instanceof HTMLElement && titleSource
          ? Math.min(titleSource.to, titleSource.from + titleOffsetAtPoint(title, event.clientX, event.clientY))
          : markerText(node).length;
        folded = false; draw();
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 2 + offset)).scrollIntoView()); view.focus();
      });
      return {
        dom, contentDOM: content,
        update(next) {
          if (next.type !== node.type || !appearance(next)) return false;
          node = next;
          // Preserve the header DOM during body input. Replacing it can move the
          // native Firefox caret when an empty paragraph has just been restored.
          if (markerText(node) !== drawnMarker || context.revision !== drawnRevision) draw();
          return true;
        },
        stopEvent: event => header.contains(event.target as Node),
        ignoreMutation: mutation => header.contains(mutation.target) || mutation.target === dom && mutation.type === "attributes",
        destroy() { icons.forEach(dispose => dispose()); }
      };
    } },
    decorations(state) {
      const decorations: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== "blockquote" || node.firstChild?.type.name !== "paragraph" || !context.parseCallout?.(node.firstChild.textContent.split("\n")[0])) return true;
        const line = node.firstChild.textContent.split("\n")[0], markerStart = pos + 2, markerEnd = markerStart + line.length;
        const editingMarker = !context.readOnly && state.selection.from <= markerEnd && state.selection.to >= markerStart;
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: editingMarker ? "mint-callout-editing" : "mint-callout-rendered" }));
        if (line.length === node.firstChild.textContent.length) decorations.push(Decoration.node(pos + 1, pos + 1 + node.firstChild.nodeSize, { class: "callout-source-marker" }));
        else decorations.push(Decoration.inline(markerStart, markerEnd + 1, { class: "callout-marker-source" }));
        return true;
      });
      return DecorationSet.create(state.doc, decorations);
    }
  } })]
};
