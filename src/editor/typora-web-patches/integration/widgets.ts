import type { WidgetDecoration } from "../normalize.ts";
import type { MintContext } from "./context.ts";
const cleanups = new WeakMap<HTMLElement, () => void>();
export function destroyMintWidget(element: HTMLElement): void { cleanups.get(element)?.(); cleanups.delete(element); }
export function mintWidget(widget: WidgetDecoration, context: MintContext): HTMLElement | null {
  if (!widget.kind.startsWith("mint-")) return null;
  const attrs = widget.attrs ?? {}, kind = widget.kind.slice(5), host = document.createElement("span");
  host.className = widget.kind;
  if (kind === "math" || kind === "display-math") {
    const cleanup = context.renderMath?.(host, attrs.source, kind === "display-math"); if (cleanup) cleanups.set(host, cleanup);
  } else if (kind === "wikilink" || kind === "wiki-embed") {
    const button = document.createElement("button"); button.type = "button"; button.className = "wiki-link"; button.textContent = attrs.source; button.dataset.wikilinkTarget = attrs.target;
    button.addEventListener("mousedown", event => event.preventDefault()); button.addEventListener("click", () => context.onNavigate?.(attrs.target)); host.append(button);
  } else if (kind === "footnote-ref" || kind === "inline-footnote") {
    const sup = document.createElement("sup"), link = document.createElement("a");
    const id = kind === "inline-footnote" ? `inline-${widget.pos}` : attrs.target;
    const note = context.footnotes?.get(id);
    link.textContent = String(note?.number ?? attrs.target ?? "*");
    link.id = `footnote-ref-${encodeURIComponent(id)}-${widget.pos}`;
    link.href = `#footnote-${encodeURIComponent(id)}`; link.title = attrs.source;
    link.addEventListener("click", event => { event.preventDefault();
      const root = host.closest(".typora-web-editor-host");
      [...root?.querySelectorAll<HTMLElement>("[id]") ?? []].find(element => element.id === `footnote-${encodeURIComponent(id)}`)?.scrollIntoView({ block: "nearest" });
    });
    sup.append(link); host.append(sup);
  }
  return host;
}
