import { useCallback, useRef, useState } from "react";
import type { ToastNotice, ToastTone } from "../../components/Toast";

/** Keep feedback in arrival order, without allowing a later notice to hide an error. */
export function useToastNotifications() {
  const [notices, setNotices] = useState<ToastNotice[]>([]);
  const sequence = useRef(0);
  const dismissMessage = useCallback((id: number) => {
    setNotices(current => current.filter(notice => notice.id !== id));
  }, []);
  const showMessage = useCallback((text: string, tone: ToastTone = "warning", action?: ToastNotice["action"]): void => {
    const id = ++sequence.current;
    const notice: ToastNotice = {
      id, text, tone,
      action: action && { label: action.label, run: async () => { await action.run(); dismissMessage(id); } },
    };
    setNotices(current => {
      // Repeated background failures refresh their existing notice rather than filling the screen.
      const repeated = action ? -1 : current.findIndex(item => !item.action && item.text === text && item.tone === tone);
      return repeated < 0 ? [...current, notice] : current.map((item, index) => index === repeated ? notice : item);
    });
  }, [dismissMessage]);
  return { notices, showMessage, dismissMessage };
}
