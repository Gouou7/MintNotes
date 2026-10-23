import { liveQuery } from "dexie";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { localDb } from "../../storage/database";
import { capacityLevel, claimCapacityNotice, lastSyncKey, readLocalStorageStatus, readPendingStorageStatus, type LocalStorageStatus } from "../../storage/storageStatus";
import { useI18n } from "../../i18n";
import type { ToastTone } from "../../components/Toast";

export interface AccountStorageUsage {
  totalBytes: number; contentBytes: number; noteBytes: number; attachmentBytes: number; historyBytes: number; profileBytes: number; trashBytes: number;
  quotaBytes: number | null; historyQuotaBytes: number | null; checkedAt: string;
}
export function useStorageStatus(options: { userId: string; endpointId: string; online: boolean; enabled: boolean;
  detailed?: boolean; getUnsavedCount: () => number; notify: (text: string, tone: ToastTone) => void }) {
  const { t } = useI18n();
  const current = useRef(options); current.current = options;
  const [usage, setUsage] = useState<AccountStorageUsage | null>(null);
  const [local, setLocal] = useState<LocalStorageStatus>({ bytes: 0, objects: 0, attachments: 0, history: 0 });
  const [localReady, setLocalReady] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState(0);
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [persistence, setPersistence] = useState<"unsupported" | "granted" | "best-effort" | "denied">("unsupported");
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!options.enabled) return;
    let active = true;
    const key = `storage-status:${options.userId}:server`;
    const subscription = liveQuery(async () => ({ local: options.detailed ? await readLocalStorageStatus(options.userId) : { bytes: 0, ...await readPendingStorageStatus(options.userId) },
      last: (await localDb.meta.get(lastSyncKey(options.userId, options.endpointId)))?.value ?? null,
      cached: (await localDb.meta.get(key))?.value })).subscribe({ next: (value) => {
        if (!active) return;
        setLocal((previous) => ({ ...value.local, bytes: options.detailed ? value.local.bytes : previous.bytes })); setLocalReady(true); setLastSync(value.last);
        if (value.cached) setUsage(JSON.parse(value.cached) as AccountStorageUsage);
      }, error: () => { if (active) setFailed(true); } });
    const poll = () => { if (active) setUnsaved(current.current.getUnsavedCount()); };
    poll(); const timer = window.setInterval(poll, 1000);
    return () => { active = false; subscription.unsubscribe(); window.clearInterval(timer); };
  }, [options.userId, options.endpointId, options.enabled, options.detailed]);
  useEffect(() => {
    if (!options.enabled) return;
    let active = true, busy = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (!active || busy) return;
      busy = true; setRefreshing(true);
      try {
        try {
          const value = await navigator.storage?.estimate?.();
          if (active) setEstimate(value ?? null);
          const persistent = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
          if (active) setPersistence((previous) => persistent === null ? "unsupported" : persistent ? "granted" : previous === "denied" ? "denied" : "best-effort");
        } catch { if (active) setEstimate(null); }
        if (!options.online || !navigator.onLine) return;
        const value = await api<AccountStorageUsage>("/api/account/storage", { signal: controller.signal });
        if (!active) return;
        setUsage(value); setFailed(false);
        await localDb.meta.put({ key: `storage-status:${options.userId}:server`, value: JSON.stringify(value) });
        const level = capacityLevel(value.totalBytes, value.quotaBytes);
        if (await claimCapacityNotice(options.userId, level) && active) {
          current.current.notify(t(level === "full" ? "storage.fullNotice" : level === "critical" ? "storage.criticalNotice" : "storage.warningNotice"), level === "warning" ? "info" : "warning");
        }
      } catch { if (active) setFailed(true); }
      finally { busy = false; if (active) setRefreshing(false); }
    };
    refreshRef.current = refresh;
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void refresh(); }, 60_000);
    let debounce: number | undefined;
    const onChange = () => { window.clearTimeout(debounce); debounce = window.setTimeout(() => { void refresh(); }, 750); };
    const wentOnline = () => { setBrowserOnline(true); onChange(); };
    const wentOffline = () => setBrowserOnline(false);
    const visible = () => { if (document.visibilityState !== "hidden") onChange(); };
    window.addEventListener("webmd:storage-refresh", onChange);
    window.addEventListener("online", wentOnline);
    window.addEventListener("offline", wentOffline);
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; controller.abort(); window.clearInterval(timer); window.clearTimeout(debounce);
      window.removeEventListener("webmd:storage-refresh", onChange); window.removeEventListener("online", wentOnline); window.removeEventListener("offline", wentOffline); document.removeEventListener("visibilitychange", visible); };
  }, [options.userId, options.online, options.enabled, t]);
  const requestPersistence = async () => {
    if (!navigator.storage?.persist) { setPersistence("unsupported"); return; }
    try { setPersistence(await navigator.storage.persist() ? "granted" : "denied"); }
    catch { setPersistence("denied"); }
  };
  return { usage, local, localReady, lastSync, unsaved, estimate, persistence, failed, refreshing,
    refresh: () => refreshRef.current(), requestPersistence, stale: !options.online || !browserOnline || failed };
}
export type StorageStatus = ReturnType<typeof useStorageStatus>;
