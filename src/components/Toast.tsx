import { useEffect, useRef } from "react";
import { CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { useI18n } from "../i18n";
import { AppIcon } from "./AppIcon";

export type ToastTone = "info" | "warning" | "critical";
export type ToastNotice = {
  id: number;
  text: string;
  tone: ToastTone;
  action?: { label: string; run: () => void | Promise<void> };
};

export function toastDuration(tone: ToastTone): number | null {
  if (tone === "critical") return null;
  return tone === "warning" ? 7000 : 4000;
}

export function Toast({ notice, onDismiss }: { notice: ToastNotice; onDismiss: () => void }) {
  const { t } = useI18n();
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const duration = toastDuration(notice.tone);
    if (duration === null) return;
    const timer = window.setTimeout(() => dismissRef.current(), duration);
    return () => window.clearTimeout(timer);
  }, [notice.id, notice.tone]);

  const NoticeIcon = notice.tone === "critical" ? CircleAlert : notice.tone === "warning" ? TriangleAlert : Info;

  return (
    <aside
      className={`toast-notice toast-${notice.tone}${notice.action ? " has-action" : ""}`}
      role={notice.tone === "critical" ? "alert" : "status"}
      aria-live={notice.tone === "critical" ? "assertive" : "polite"}
    >
      <span className="toast-indicator"><AppIcon icon={NoticeIcon} size={19} /></span>
      <p>{notice.text}</p>
      {notice.action && <button className="toast-action" onClick={() => void notice.action?.run()}>{notice.action.label}</button>}
      <button onClick={onDismiss} aria-label={t("app.closeNotification")}><AppIcon icon={X} size={16} /></button>
    </aside>
  );
}
