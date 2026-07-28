import { useCallback, useState } from "react";
import type { Translate } from "../../i18n";
import { localDb } from "../../storage/database";

export type SaveState = "ready" | "saving" | "local" | "syncing" | "synced" | "offline" | "error";
export type VisibleSyncStatus = "synced" | "syncing" | "error" | "offline";
export type SyncFailure =
  | { kind: "unreachable" }
  | { kind: "server"; reason: string };

export interface SyncStatusState {
  phase: SaveState;
  visible: VisibleSyncStatus;
  failure: SyncFailure | null;
  failedLocalObjectIds: ReadonlySet<string>;
}

export type SyncStatusAction =
  | { type: "phase"; phase: Exclude<SaveState, "error"> }
  | { type: "sync-error"; failure: SyncFailure }
  | { type: "local-failure"; objectId: string }
  | { type: "local-success"; objectId: string };

export function createSyncStatus(online: boolean): SyncStatusState {
  return {
    phase: online ? "ready" : "offline",
    visible: online ? "synced" : "offline",
    failure: null,
    failedLocalObjectIds: new Set()
  };
}

export function reduceSyncStatus(current: SyncStatusState, action: SyncStatusAction): SyncStatusState {
  if (action.type === "local-failure") {
    const failedLocalObjectIds = new Set(current.failedLocalObjectIds);
    failedLocalObjectIds.add(action.objectId);
    return { ...current, failedLocalObjectIds };
  }
  if (action.type === "local-success") {
    if (!current.failedLocalObjectIds.has(action.objectId)) return current;
    const failedLocalObjectIds = new Set(current.failedLocalObjectIds);
    failedLocalObjectIds.delete(action.objectId);
    return { ...current, failedLocalObjectIds };
  }
  if (action.type === "sync-error") {
    return {
      ...current,
      phase: "error",
      visible: "error",
      failure: action.failure
    };
  }

  const visible = action.phase === "saving"
    ? current.visible
    : action.phase === "ready" || action.phase === "synced"
      ? "synced"
      : action.phase === "local" || action.phase === "syncing"
        ? "syncing"
        : "offline";
  return {
    ...current,
    phase: action.phase,
    visible,
    failure: action.phase === "saving" ? current.failure : null
  };
}

export function visibleSyncStatusText(status: VisibleSyncStatus, t: Translate): string {
  return ({
    synced: t("app.save.synced"),
    syncing: t("app.save.syncing"),
    error: t("app.save.error"),
    offline: t("app.save.offline")
  } satisfies Record<VisibleSyncStatus, string>)[status];
}

export function syncStatusDetailText(status: SyncStatusState, t: Translate): string {
  if (status.failedLocalObjectIds.size) return t("app.save.localFailureDetail");
  if (status.phase === "saving") return t("app.save.saving");
  if (status.phase === "local") return t("app.save.local");
  if (status.phase === "syncing") return t("app.save.syncingDetail");
  if (status.phase === "error") {
    return status.failure?.kind === "server"
      ? t("app.save.serverErrorDetail", { reason: status.failure.reason })
      : t("app.save.unreachableDetail");
  }
  if (status.phase === "offline") return t("app.save.offlineDetail");
  return t("app.save.synced");
}

export async function countPendingSyncEntries(userId: string): Promise<number> {
  const [objects, attachments, history] = await Promise.all([
    localDb.outbox.where("userId").equals(userId).count(),
    localDb.attachmentOutbox.where("userId").equals(userId).count(),
    localDb.historyOutbox.where("userId").equals(userId).count()
  ]);
  return objects + attachments + history;
}

export function settledSyncPhase(online: boolean, pendingCount: number): "offline" | "local" | "synced" {
  if (!online) return "offline";
  return pendingCount > 0 ? "local" : "synced";
}

export function useSyncStatus(initialOnline: boolean) {
  const [status, setStatus] = useState<SyncStatusState>(() => createSyncStatus(initialOnline));
  const setPhase = useCallback((phase: Exclude<SaveState, "error">) => {
    setStatus((current) => reduceSyncStatus(current, { type: "phase", phase }));
  }, []);
  const setSyncError = useCallback((failure: SyncFailure) => {
    setStatus((current) => reduceSyncStatus(current, { type: "sync-error", failure }));
  }, []);
  const markLocalFailure = useCallback((objectId: string) => {
    setStatus((current) => reduceSyncStatus(current, { type: "local-failure", objectId }));
  }, []);
  const markLocalSuccess = useCallback((objectId: string) => {
    setStatus((current) => reduceSyncStatus(current, { type: "local-success", objectId }));
  }, []);

  return {
    status,
    setPhase,
    setSyncError,
    markLocalFailure,
    markLocalSuccess
  };
}
