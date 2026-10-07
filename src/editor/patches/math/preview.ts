import type { MintContext } from "./context.ts";

/** Presentation only: no parsing, document mutation or shared TeX state. */
export function mathPreview(host: HTMLElement, body: string, display: boolean, context: MintContext): () => void {
  let cleanup: void | (() => void);
  host.replaceChildren();
  try {
    if (context.renderMath) cleanup = context.renderMath(host, body, display);
    else host.textContent = body;
  } catch {
    host.textContent = body;
  }
  return () => { cleanup?.(); host.replaceChildren(); };
}
