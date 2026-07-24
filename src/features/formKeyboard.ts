import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export function submitFormOnEnter(event: ReactKeyboardEvent<HTMLInputElement>) {
  if (event.key !== "Enter" || event.repeat || event.defaultPrevented || event.nativeEvent.isComposing) return;
  const form = event.currentTarget.form;
  const submitter = form?.querySelector<HTMLButtonElement>('button[type="submit"]:not(:disabled)');
  if (!form || !submitter) return;
  event.preventDefault();
  form.requestSubmit(submitter);
}
