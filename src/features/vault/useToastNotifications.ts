import { useCallback, useLayoutEffect, useRef } from "react";
import { dismissToast, showToast, type ToastActionHandler, type ToastEntry, type ToastTone } from "../../components/Toast";

export function useToastNotifications(visible = true) {
  const active = useRef(new Set<ToastEntry>());
  const visibleRef = useRef(visible);
  const clearMessages = useCallback(() => {
    for (const entry of active.current) dismissToast(entry);
  }, []);

  useLayoutEffect(() => {
    visibleRef.current = visible;
    return () => {
      visibleRef.current = false;
      clearMessages();
    };
  }, [visible, clearMessages]);

  const showMessage = useCallback((text: string, tone: ToastTone = "warning", action?: ToastActionHandler): void => {
    if (!visibleRef.current) return;
    const entries = active.current;
    if (!action) {
      for (const entry of entries) {
        if (entry.tone === tone && entry.content?.text === text && !entry.content.action) {
          // A fresh Sonner entry gives a repeated message a new timeout.
          dismissToast(entry);
          break;
        }
      }
    }
    entries.add(showToast(tone, { text, action, onClose: (entry) => entries.delete(entry) }));
  }, []);

  return { showMessage, clearMessages };
}
