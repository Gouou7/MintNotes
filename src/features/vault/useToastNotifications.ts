import { useCallback, useRef } from "react";
import { toastDuration, type ToastActionHandler, type ToastTone } from "../../components/Toast";
import { useToastManager } from "../../components/ui/toast";

/** Refresh repeated feedback in place, while keeping action notices independent. */
export function useToastNotifications() {
  const { add, close } = useToastManager<{ tone: ToastTone }>();
  const repeated = useRef(new Map<string, string>());
  const showMessage = useCallback((text: string, tone: ToastTone = "warning", action?: ToastActionHandler): void => {
    const key = action ? undefined : JSON.stringify([text, tone]);
    const id = key === undefined ? undefined : repeated.current.get(key);
    const next = add({
      id,
      description: text,
      timeout: toastDuration(tone) ?? 0,
      data: { tone },
      onClose: () => {
        if (key !== undefined && repeated.current.get(key) === next) repeated.current.delete(key);
      },
      actionProps: action && {
        children: action.label,
        onClick: () => { void Promise.resolve().then(action.run).then(() => close(next), () => undefined); }
      }
    });
    if (key !== undefined) repeated.current.set(key, next);
  }, [add, close]);
  return { showMessage };
}
