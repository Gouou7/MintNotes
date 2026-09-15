/** Measure the native textarea's visual line without changing its value/selection. */
export function textareaCaretRect(textarea: HTMLTextAreaElement, offset: number): { top: number; bottom: number } | null {
  const rect = textarea.getBoundingClientRect();
  if (!textarea.isConnected || rect.width <= 0) return null;
  const style = getComputedStyle(textarea);
  const mirror = textarea.ownerDocument.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  for (const property of [
    "box-sizing", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-style", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "font-family", "font-size", "font-weight", "font-style", "font-variant", "font-stretch",
    "line-height", "letter-spacing", "word-spacing", "text-indent", "text-align", "text-transform",
    "direction", "white-space", "word-break", "overflow-wrap", "tab-size"
  ]) mirror.style.setProperty(property, style.getPropertyValue(property));
  Object.assign(mirror.style, {
    position: "fixed", left: "0", top: "0", visibility: "hidden", pointerEvents: "none",
    width: `${rect.width}px`, height: "auto", margin: "0"
  });
  const at = Math.max(0, Math.min(offset, textarea.value.length));
  const marker = textarea.ownerDocument.createElement("span");
  marker.textContent = textarea.value.slice(at, at + 1) || "\u200b";
  mirror.append(textarea.value.slice(0, at), marker, textarea.value.slice(at + 1));
  textarea.ownerDocument.body.append(mirror);
  try {
    const line = marker.getClientRects()[0];
    if (!line) return null;
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const top = rect.top + line.top - mirror.getBoundingClientRect().top - textarea.scrollTop;
    return { top, bottom: top + lineHeight };
  } finally {
    mirror.remove();
  }
}
