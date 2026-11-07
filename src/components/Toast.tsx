import { BellRing, CircleAlert, X } from "lucide-react";
import { cn } from "cn";
import { useI18n } from "../i18n";
import { AppIcon } from "./AppIcon";
import { Toast, ToastAction, ToastClose, ToastDescription, ToastPortal, ToastViewport, useToastManager } from "./ui/toast";

export type ToastTone = "info" | "warning" | "critical";
export type ToastActionHandler = { label: string; run: () => void | Promise<void> };

export function toastDuration(tone: ToastTone): number | null {
  if (tone === "critical") return null;
  return tone === "warning" ? 7000 : 4000;
}

export function ToastStack() {
  const { t } = useI18n();
  const { toasts } = useToastManager<{ tone: ToastTone }>();
  const hasActive = toasts.some((item) => item.transitionStatus !== "ending");
  return <ToastPortal><ToastViewport className={hasActive ? "toast-stack" : "toast-stack-empty"} aria-label={t("app.notifications")} aria-live="off">
    {[...toasts].reverse().map((item) => {
      const tone = item.data?.tone ?? "info";
      return <Toast key={item.id} toast={item} swipeDirection={[]} role={tone === "critical" ? "alert" : "status"}
        aria-live={tone === "critical" ? "assertive" : "polite"}
        className={cn("toast-notice", `toast-${tone}`, item.actionProps && "has-action")}>
        <span className="toast-indicator"><AppIcon icon={tone === "info" ? BellRing : CircleAlert} size={16} strokeWidth={2} /></span>
        <ToastDescription render={<p />} />
        {item.actionProps && <ToastAction className="toast-action" />}
        <ToastClose className="toast-close" aria-hidden={false} aria-label={t("app.closeNotification")}><AppIcon icon={X} /></ToastClose>
      </Toast>;
    })}
  </ToastViewport></ToastPortal>;
}
