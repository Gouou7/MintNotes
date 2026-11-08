import { useCallback, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { toast, Toaster } from "sonner";
import { useI18n } from "../i18n";
import { AppIcon } from "./AppIcon";

export type ToastTone = "info" | "warning" | "critical";
export type ToastActionHandler = { label: string; run: () => void | Promise<void> };

type ToastContent = {
  text: string;
  action?: ToastActionHandler;
  onClose: (entry: ToastEntry) => void;
};

export type ToastEntry = {
  id: number;
  tone: ToastTone;
  content: ToastContent | null;
  listeners: Set<() => void>;
};

let nextId = 0;
const showByTone = { info: toast.info, warning: toast.warning, critical: toast.error };
const durationByTone = { info: 4000, warning: 7000, critical: Infinity };

export function dismissToast(entry: ToastEntry) {
  const content = entry.content;
  if (!content) return;
  entry.content = null;
  content.onClose(entry);
  for (const listener of entry.listeners) listener();
  entry.listeners.clear();
  toast.dismiss(entry.id);
}

function useToastContent(entry: ToastEntry) {
  const subscribe = useCallback((listener: () => void) => {
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }, [entry]);
  const snapshot = () => entry.content;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// Sonner retains dismissed toast descriptors. They reference an entry whose
// message and callbacks are released on close or when the workspace goes away.
function ToastText({ entry }: { entry: ToastEntry }) {
  const content = useToastContent(entry);
  return <span data-toast-cleared={!content || undefined} role={entry.tone === "critical" ? "alert" : undefined}>{content?.text}</span>;
}

function ToastActionLabel({ entry }: { entry: ToastEntry }) {
  const content = useToastContent(entry);
  return <>{content?.action?.label}</>;
}

function ToastDismissLabel() {
  const { t } = useI18n();
  return <>{t("common.close")}</>;
}

function publishToast(entry: ToastEntry) {
  const onClose = () => dismissToast(entry);
  showByTone[entry.tone](<ToastText entry={entry} />, {
    id: entry.id,
    duration: durationByTone[entry.tone],
    onAutoClose: onClose,
    onDismiss: onClose,
    cancel: { label: <ToastDismissLabel />, onClick: onClose },
    action: entry.content?.action ? {
      label: <ToastActionLabel entry={entry} />,
      onClick: (event) => {
        event.preventDefault();
        const action = entry.content?.action;
        if (action) void Promise.resolve().then(action.run).then(() => dismissToast(entry), () => undefined);
      }
    } : undefined
  });
}

export function showToast(tone: ToastTone, content: ToastContent): ToastEntry {
  const entry: ToastEntry = { id: ++nextId, tone, content, listeners: new Set() };
  publishToast(entry);
  return entry;
}

const edgeInset = "max(16px, var(--safe-area-left), var(--safe-area-right))";
const offset = { bottom: "calc(40px + var(--safe-area-bottom))", left: edgeInset, right: edgeInset };
const style = {
  "--width": "min(356px, calc(100vw - 2 * var(--toast-edge-inset)))",
  "--toast-edge-inset": edgeInset,
  "--normal-bg": "var(--surface-raised)",
  "--normal-border": "var(--border)",
  "--normal-text": "var(--text)",
  "--border-radius": "var(--radius-xl)"
} as CSSProperties;
const icons = {
  info: <AppIcon icon={Info} />,
  warning: <AppIcon icon={TriangleAlert} />,
  error: <AppIcon icon={CircleAlert} />
};

export function ToastStack() {
  const { t } = useI18n();
  return createPortal(<Toaster
    className="app-sonner"
    position="bottom-center"
    offset={offset}
    mobileOffset={offset}
    style={style}
    icons={icons}
    containerAriaLabel={t("app.notifications")}
    toastOptions={{ className: "toast-notice" }}
  />, document.body);
}
