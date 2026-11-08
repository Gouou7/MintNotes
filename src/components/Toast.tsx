import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { useI18n } from "../i18n";
import { AppIcon } from "./AppIcon";
import { Alert, AlertAction, AlertDescription } from "./ui/alert";
import { ToastAction, ToastClose, ToastDescription, ToastPortal, ToastRoot, ToastViewport, useToastManager } from "./ui/toast";

export type ToastTone = "info" | "warning" | "critical";
export type ToastActionHandler = { label: string; run: () => void | Promise<void> };

const noticeIcons = { info: Info, warning: TriangleAlert, critical: CircleAlert };

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
      return <ToastRoot key={item.id} toast={item} swipeDirection={[]}
        render={<Alert variant={tone === "critical" ? "destructive" : "default"} />}
        role={tone === "critical" ? "alert" : "status"}
        aria-live={tone === "critical" ? "assertive" : "polite"}
        data-tone={tone} className="toast-notice border-border shadow-floating has-data-[slot=alert-action]:pr-11">
        <AppIcon icon={noticeIcons[tone]} size={16} />
        <ToastDescription data-slot="alert-description" render={<AlertDescription />} />
        {item.actionProps && <ToastAction className="toast-action" />}
        <AlertAction>
          <ToastClose className="toast-close after:content-none" aria-hidden={false} aria-label={t("app.closeNotification")} />
        </AlertAction>
      </ToastRoot>;
    })}
  </ToastViewport></ToastPortal>;
}
