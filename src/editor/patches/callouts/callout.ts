import { Plugin, TextSelection } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { Decoration, DecorationSet } from "prosemirror-view";
import { literalFeature } from "./syntax.ts";
import { inlineTextEditor } from "./inline-edit.ts";
import type { FeatureSpec } from "../features/_types.ts";

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
      let node = initial, folded: boolean | null = null, disposed = false, drawnFold: string | undefined;
      let drawnMarker = "", drawnRevision: number | undefined;
      const dom = document.createElement("blockquote"), header = document.createElement("div"), content = document.createElement("div");
      header.className = "callout-header"; header.contentEditable = "false"; content.className = "callout-content"; dom.append(header, content);
      const editable = () => !disposed && view.editable && !context.readOnly && !!context.editCalloutMarker;
      const commit = (change: { type?: string; title?: string }) => {
        if (!editable()) return;
        const pos = getPos(); if (pos === undefined || view.state.doc.nodeAt(pos)?.type.name !== "blockquote") return;
        const line = markerText(node), next = context.editCalloutMarker?.(line, change);
        if (next === null || next === undefined || next === line) return;
        view.dispatch(closeHistory(view.state.tr.insertText(next, pos + 2, pos + 2 + line.length)));
        view.dispatch(closeHistory(view.state.tr));
      };
      const icon = document.createElement("span"), iconHost = document.createElement("span"), types = document.createElement("select"), title = document.createElement("strong"), toggle = document.createElement("button");
      icon.className = "callout-icon"; iconHost.className = "callout-type-icon"; types.className = "callout-type-select"; toggle.className = "callout-toggle"; toggle.type = "button";
      types.setAttribute("aria-label", context.label?.("calloutType") ?? "Callout type");
      const titleEditor = inlineTextEditor({ value: appearance(node)!.title, display: appearance(node)!.title,
        label: context.label?.("calloutTitle") ?? "Callout title", readOnly: () => !editable(), commit: value => commit({ title: value }),
        confirm() {
          const pos = getPos(); if (disposed || pos === undefined) return;
          const first = node.firstChild!, line = markerText(node);
          const body = first.textContent.includes("\n") ? pos + 3 + line.length : node.childCount > 1 ? pos + 2 + first.nodeSize : undefined;
          if (body === undefined) { titleEditor.element.querySelector("button")?.focus(); return; }
          view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(body)))); view.focus();
        },
      });
      titleEditor.element.classList.add("callout-title-editor"); title.append(titleEditor.element); icon.append(iconHost, types); header.append(icon, title, toggle);
      let typeIcon: { element: HTMLElement; destroy(): void } | undefined, foldIcon: typeof typeIcon;
      let typeIconName = "", foldIconName = "";
      types.addEventListener("change", () => { if (editable()) commit({ type: types.value }); });
      toggle.addEventListener("mousedown", event => event.preventDefault());
      toggle.addEventListener("click", event => { event.stopPropagation(); titleEditor.finish(); folded = !folded; draw(); });
      const draw = () => {
        const current = appearance(node);
        if (!current) return;
        drawnMarker = markerText(node); drawnRevision = context.revision;
        if (folded === null || current.fold !== drawnFold) folded = current.fold === "-";
        drawnFold = current.fold;
        const presentation = ["mint-callout-editing", "mint-callout-rendered"].filter(name => dom.classList.contains(name)).join(" ");
        dom.className = `${presentation} markdown-callout callout-${current.kind}${current.color ? ` callout-color-${current.color}` : ""}${folded ? " mint-callout-folded" : ""}`;
        const nextTypeIcon = `callout-${current.icon ?? current.kind}`;
        if (nextTypeIcon !== typeIconName) {
          typeIcon?.destroy(); typeIcon = context.icon?.(nextTypeIcon); typeIconName = nextTypeIcon; iconHost.replaceChildren(); if (typeIcon) iconHost.append(typeIcon.element);
        }
        const rawType = current.rawType ?? current.kind, choices = [...context.calloutTypes ?? []];
        if (!choices.some(option => option.value === rawType)) choices.unshift({ value: rawType, label: current.title });
        const nextChoices = JSON.stringify(choices);
        if (types.dataset.choices !== nextChoices) {
          types.replaceChildren(...choices.map(choice => { const option = document.createElement("option"); option.value = choice.value; option.textContent = choice.label; return option; })); types.dataset.choices = nextChoices;
        }
        types.value = rawType; types.disabled = !editable(); types.setAttribute("aria-label", context.label?.("calloutType") ?? "Callout type");
        titleEditor.update(current.title, current.title, { label: context.label?.("calloutTitle") ?? "Callout title" });
        toggle.hidden = !current.fold; toggle.setAttribute("aria-label", context.label?.("toggleCallout") ?? current.title); toggle.setAttribute("aria-expanded", String(!folded));
        const nextFoldIcon = folded ? "chevron-right" : "chevron-down";
        if (current.fold && nextFoldIcon !== foldIconName) {
          foldIcon?.destroy(); foldIcon = context.icon?.(nextFoldIcon); foldIconName = nextFoldIcon; toggle.replaceChildren(); if (foldIcon) toggle.append(foldIcon.element);
        }
      };
      draw();
      return {
        dom, contentDOM: content,
        update(next) {
          if (next.type !== node.type || !appearance(next)) return false;
          node = next;
          // Keep focused native controls and the body caret mounted during edits.
          if (markerText(node) !== drawnMarker || context.revision !== drawnRevision) draw();
          return true;
        },
        stopEvent: event => header.contains(event.target as Node),
        ignoreMutation: mutation => header.contains(mutation.target) || mutation.target === dom && mutation.type === "attributes",
        destroy() { disposed = true; titleEditor.destroy(); typeIcon?.destroy(); foldIcon?.destroy(); }
      };
    } },
    decorations(state) {
      const decorations: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== "blockquote" || node.firstChild?.type.name !== "paragraph" || !context.parseCallout?.(node.firstChild.textContent.split("\n")[0])) return true;
        const line = node.firstChild.textContent.split("\n")[0], markerStart = pos + 2, markerEnd = markerStart + line.length;
        const editingMarker = !context.readOnly && state.selection.from <= markerEnd && state.selection.to >= markerStart;
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: editingMarker ? "mint-callout-editing" : "mint-callout-rendered", "data-mint-presentation": `${context.revision ?? 0}:${context.readOnly ? 1 : 0}` }));
        if (line.length === node.firstChild.textContent.length) decorations.push(Decoration.node(pos + 1, pos + 1 + node.firstChild.nodeSize, { class: "callout-source-marker" }));
        else decorations.push(Decoration.inline(markerStart, markerEnd + 1, { class: "callout-marker-source" }));
        return true;
      });
      return DecorationSet.create(state.doc, decorations);
    }
  } })]
};
