import { Plugin } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import type { Decoration } from "prosemirror-view";
import { calloutBehavior, calloutBody, calloutKey, calloutLine, enterCalloutBody, leaveCallout } from "./callout-behavior.ts";
import { literalFeature } from "./syntax.ts";
import { inlineArrowDirection, inlineTextEditor } from "./inline-edit.ts";
import type { FeatureSpec } from "../features/_types.ts";

export const callout: FeatureSpec = {
  ...literalFeature("mint-callout", ["callout-marker"]),
  plugins: (_schema, context = {}) => [calloutBehavior(context), new Plugin({ props: {
    nodeViews: { blockquote: (initial, view, getPos, decorations) => {
      const markerText = calloutLine;
      const appearance = (node: typeof initial) => context.parseCallout?.(markerText(node));
      const draft = (decorations: readonly Decoration[]) => decorations.some(decoration => decoration.spec.calloutDraft);
      if (!appearance(initial) || draft(decorations)) {
        const dom = document.createElement("blockquote");
        return { dom, contentDOM: dom, update: (next, decorations) => next.type === initial.type && (!appearance(next) || draft(decorations)) };
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
        view.dispatch(closeHistory(view.state.tr.insertText(next, pos + 2, pos + 2 + line.length)).setMeta(calloutKey, { titleFocus: null }));
        view.dispatch(closeHistory(view.state.tr));
      };
      const icon = document.createElement("span"), iconHost = document.createElement("span"), types = document.createElement("select"), title = document.createElement("strong"), toggle = document.createElement("button");
      icon.className = "callout-icon"; iconHost.className = "callout-type-icon"; types.className = "callout-type-select"; toggle.className = "callout-toggle"; toggle.type = "button";
      types.setAttribute("aria-label", context.label?.("calloutType") ?? "Callout type");
      const titleEditor = inlineTextEditor({ value: appearance(node)!.title, display: appearance(node)!.title,
        label: context.label?.("calloutTitle") ?? "Callout title", readOnly: () => !editable(), commit: value => commit({ title: value }),
        endEditing() {
          const pos = getPos();
          if (pos !== undefined && calloutKey.getState(view.state)?.titleFocus === pos) view.dispatch(view.state.tr.setMeta(calloutKey, { titleFocus: null }));
        },
        confirm(event) {
          const pos = getPos();
          if (editable() && pos !== undefined && !event.shiftKey) enterCalloutBody(view, pos);
        },
        keyDown(event) {
          const direction = inlineArrowDirection(titleEditor.input, event); if (direction === null) return false;
          event.preventDefault();
          if (titleEditor.finish()) {
            const pos = getPos(), horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
            if (editable() && pos !== undefined) direction < 0 ? leaveCallout(view, pos, -1, context, horizontal) : enterCalloutBody(view, pos, false, horizontal);
          }
          return true;
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
        dom.className = `mint-callout-rendered markdown-callout callout-${current.kind}${current.color ? ` callout-color-${current.color}` : ""}${folded ? " mint-callout-folded" : ""}`;
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
      const applyDecorations = (decorations: readonly Decoration[]) => {
        if (!context.readOnly && decorations.some(decoration => decoration.spec.calloutReveal)) { folded = false; draw(); }
        if (decorations.some(decoration => decoration.spec.calloutTitleFocus)) titleEditor.begin();
      };
      content.addEventListener("mousedown", event => {
        const pos = getPos();
        if (editable() && pos !== undefined && !calloutBody(view.state.doc, pos)) { event.preventDefault(); event.stopPropagation(); enterCalloutBody(view, pos); }
      });
      draw(); applyDecorations(decorations);
      return {
        dom, contentDOM: content,
        update(next, decorations) {
          if (next.type !== node.type || !appearance(next) || draft(decorations)) return false;
          node = next;
          // Keep focused native controls and the body caret mounted during edits.
          if (markerText(node) !== drawnMarker || context.revision !== drawnRevision) draw();
          applyDecorations(decorations); return true;
        },
        stopEvent: event => header.contains(event.target as Node),
        ignoreMutation: mutation => header.contains(mutation.target) || mutation.target === dom && mutation.type === "attributes",
        destroy() { disposed = true; titleEditor.destroy(); typeIcon?.destroy(); foldIcon?.destroy(); }
      };
    } },
  } })]
};
