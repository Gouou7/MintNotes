import type { EditorScrollViewport } from "./viewport";

/** Shared by navigation and the editor façade; CSS owns the measured insets. */
export function editorScrollViewport(element: HTMLElement): EditorScrollViewport {
  const style = getComputedStyle(element);
  return {
    element,
    top: parseFloat(style.scrollPaddingTop) || 0,
    bottom: parseFloat(style.scrollPaddingBottom) || 0
  };
}
