export type EditingShortcut = "select-all" | "copy" | "cut" | "paste" | "undo" | "redo";

/** Both editing surfaces share the platform's document commands. Clipboard
 * commands still use the browser's trusted copy/cut/paste events. */
export function editingShortcut(event: KeyboardEvent, platform: string): EditingShortcut | null {
  const mac = /Mac|iPhone|iPad/.test(platform);
  if (!(mac ? event.metaKey : event.ctrlKey) || event.altKey
    || event.getModifierState?.("AltGraph") || event.isComposing || event.keyCode === 229) return null;
  // Prefer the active layout's Latin letter. Physical codes also admit these
  // shortcuts on non-Latin layouts without interpreting an IME candidate key.
  const key = /^[a-z]$/i.test(event.key) ? event.key.toLowerCase()
    : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : "";
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "v") return "paste";
  if (event.shiftKey) return null;
  if (key === "a") return "select-all";
  if (key === "c") return "copy";
  if (key === "x") return "cut";
  if (key === "y") return "redo";
  return null;
}
