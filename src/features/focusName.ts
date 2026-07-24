export function focusAndSelectName(input: HTMLInputElement | null): boolean {
  if (!input) return false;
  input.focus();
  input.select();
  return document.activeElement === input;
}
