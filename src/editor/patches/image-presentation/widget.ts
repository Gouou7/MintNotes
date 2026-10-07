import type { WidgetDecoration } from "../normalize.ts";
import { safeImage, type MintContext } from "./context.ts";

export function imageWidget(widget: WidgetDecoration, context: MintContext): HTMLImageElement {
  const image = document.createElement("img"), attrs = widget.attrs ?? {};
  image.className = "image-render";
  image.contentEditable = "false";
  image.referrerPolicy = "no-referrer";
  image.alt = attrs.alt ?? "";
  if (attrs.title) image.title = attrs.title;
  image.dataset.imageSourceEnd = String(widget.spanTo);
  const url = safeImage(attrs.src ?? "", context);
  if (url) image.src = url; else image.classList.add("image-unavailable");
  image.addEventListener("error", () => { image.dataset.imageFailed = "true"; });
  image.addEventListener("load", () => { delete image.dataset.imageFailed; });
  // Keep the browser from selecting the preview before the click enters
  // the authoritative Markdown source. Modified clicks retain native behavior.
  image.addEventListener("mousedown", event => {
    if (!context.readOnly && event.button === 0 && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) event.preventDefault();
  });
  return image;
}
