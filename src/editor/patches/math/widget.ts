import type { WidgetDecoration } from "../normalize.ts";
import type { MintContext } from "./context.ts";
import { mathPreview } from "./math-preview.ts";

export function mathWidget(widget: WidgetDecoration, context: MintContext): { element: HTMLElement; destroy(): void } | null {
  if (widget.kind !== "mint-math" && widget.kind !== "mint-display-math") return null;
  const element = document.createElement("span");
  element.className = widget.kind;
  const attrs = widget.attrs ?? {};
  const cleanup = mathPreview(element, attrs.source ?? "", widget.kind === "mint-display-math", context);
  // The widget is zero-width in the model. Enter the authoritative source
  // through its current mapped span, never through the rendered KaTeX DOM.
  const enter = (event: MouseEvent) => {
    if (context.readOnly || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    element.closest(".ProseMirror")?.dispatchEvent(new CustomEvent("mint-math-edit", { bubbles: true,
      detail: { from: widget.spanFrom, to: widget.spanTo, source: attrs.full, width: widget.kind === "mint-math" ? 1 : 2 } }));
  };
  const preserveSelection = (event: MouseEvent) => { if (!context.readOnly && event.button === 0 && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) event.preventDefault(); };
  element.addEventListener("mousedown", preserveSelection); element.addEventListener("click", enter);
  return { element, destroy() { element.removeEventListener("mousedown", preserveSelection); element.removeEventListener("click", enter); cleanup(); } };
}
