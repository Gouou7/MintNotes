/** A display label and a native input share the same compact header slot. */
export interface InlineTextEditor {
  element: HTMLElement;
  input: HTMLInputElement;
  begin(): void;
  finish(): boolean;
  update(value: string, display: string, presentation?: { label?: string; placeholder?: string }): void;
  destroy(): void;
}

export function inlineTextEditor(options: {
  value: string; display: string; label: string; placeholder?: string;
  readOnly(): boolean;
  validate?(value: string): string;
  commit(value: string): void;
  confirm?(event: KeyboardEvent): void;
  keyDown?(event: KeyboardEvent): boolean;
}): InlineTextEditor {
  const element = document.createElement("span"), label = document.createElement("button"), input = document.createElement("input"), measure = document.createElement("span");
  element.className = "mint-inline-editor"; label.className = "mint-inline-editor-label"; input.className = "mint-inline-editor-input"; measure.className = "mint-inline-editor-measure";
  label.type = "button"; label.setAttribute("aria-label", options.label); input.setAttribute("aria-label", options.label); measure.setAttribute("aria-hidden", "true");
  input.type = "text"; input.spellcheck = false; input.autocomplete = "off"; input.placeholder = options.placeholder ?? ""; input.hidden = measure.hidden = true; element.append(label, input, measure);
  let value = options.value, display = options.display, editing = false, composing = false, finishAfterComposition = false, disposed = false;
  const resize = () => { measure.textContent = input.value || input.placeholder || "\u00a0"; };
  const close = () => { editing = false; finishAfterComposition = false; input.hidden = measure.hidden = true; label.hidden = false; element.classList.remove("is-editing"); input.setCustomValidity(""); measure.textContent = ""; };
  const finish = () => {
    if (disposed) return false;
    if (!editing) return true;
    if (composing) { finishAfterComposition = true; return false; }
    const draft = input.value, error = options.validate?.(draft) ?? "";
    if (!options.readOnly() && error) { input.setCustomValidity(error); input.reportValidity(); return false; }
    close();
    if (!options.readOnly() && draft !== value) options.commit(draft);
    return true;
  };
  const begin = () => {
    if (disposed || options.readOnly() || editing) return;
    editing = true; input.value = value; label.hidden = true; input.hidden = measure.hidden = false; element.classList.add("is-editing"); resize();
    input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  };
  label.addEventListener("mousedown", event => event.preventDefault()); label.addEventListener("click", begin);
  input.addEventListener("input", () => { input.setCustomValidity(""); resize(); });
  input.addEventListener("blur", finish);
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; if (finishAfterComposition) finish(); });
  input.addEventListener("keydown", event => {
    if (disposed || composing || event.isComposing || event.keyCode === 229) return;
    if (options.keyDown?.(event)) return;
    if (event.key === "Enter") { event.preventDefault(); finish(); if (!editing) options.confirm?.(event); }
    else if (event.key === "Escape") { event.preventDefault(); close(); label.focus(); }
  });
  const update = (next: string, nextDisplay: string, presentation?: { label?: string; placeholder?: string }) => {
    if (disposed) return;
    if (editing && (next !== value || options.readOnly())) close();
    value = next; display = nextDisplay; label.textContent = display; label.disabled = options.readOnly(); input.disabled = options.readOnly();
    if (presentation?.label) { label.setAttribute("aria-label", presentation.label); input.setAttribute("aria-label", presentation.label); }
    if (presentation?.placeholder !== undefined) input.placeholder = presentation.placeholder;
    if (editing) resize();
  };
  update(value, display);
  return { element, input, begin, finish, update, destroy() { disposed = true; close(); } };
}
