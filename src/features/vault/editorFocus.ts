import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export interface EditorFocusHandle {
  focus: () => void;
}

export function focusEditorFromTitle(
  event: ReactKeyboardEvent<HTMLInputElement>,
  editor: EditorFocusHandle | null
) {
  if (
    event.key !== "Enter"
    || event.repeat
    || event.nativeEvent.isComposing
    || event.defaultPrevented
  ) return false;

  event.preventDefault();
  event.currentTarget.blur();
  editor?.focus();
  return true;
}
