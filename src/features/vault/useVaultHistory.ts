import { liveQuery } from "dexie";
import { pinCache } from "../../storage/cache";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import { cryptoClient } from "../../crypto/client";
import { translateError, type Translate } from "../../i18n";
import { historySettingsKey, localDb, type LocalHistorySnapshot } from "../../storage/database";
import type {
  EncryptedHistorySnapshot,
  HistoryCaptureKind,
  HistoryListItem,
  HistorySettings,
  NoteHistoryPayload,
  OpenDocument,
  UiPreferences
} from "../../types";
import { attachmentIdsIn } from "../attachments";
import {
  DEFAULT_HISTORY_SETTINGS,
  historyContentChanged,
  historyContentSignature,
  localHistoryListItem,
  makeHistoryPayload,
  mergeHistoryItems,
  shouldCaptureHistoryBaseline
} from "../history";
import { VaultHistoryController, type HistoryIndexEnvelope } from "./historyController";
import type { useToastNotifications } from "./useToastNotifications";
import type { useVaultModel } from "./useVaultModel";
import type { useWorkspaceSelection } from "./useWorkspaceSelection";

interface Options {
  model: ReturnType<typeof useVaultModel>;
  selection: ReturnType<typeof useWorkspaceSelection>;
  userId: string;
  generation: RefObject<number>;
  logoutStarted: RefObject<boolean>;
  serverSessionVerified: boolean;
  t: Translate;
  requestPush: (kind?: "editor" | "structural") => void;
  showMessage: ReturnType<typeof useToastNotifications>["showMessage"];
  setOutlineOpen: Dispatch<SetStateAction<boolean>>;
  flushDocument: (objectId: string) => Promise<void>;
  activeDocument: OpenDocument | null;
  preferences: UiPreferences;
}

/** 历史列表、预览与自动快照会话。 */
export function useVaultHistory(options: Options) {
  const {
    model,
    selection,
    userId,
    generation,
    logoutStarted,
    serverSessionVerified,
    t,
    requestPush,
    showMessage,
    setOutlineOpen,
    flushDocument,
    activeDocument,
    preferences
  } = options;
  const { documentIndexRef } = model;
  const { activeIdRef } = selection;

  const [historySettings, setHistorySettings] = useState<HistorySettings>(DEFAULT_HISTORY_SETTINGS);

  const historySettingsRef = useRef<HistorySettings>(DEFAULT_HISTORY_SETTINGS);

  const [historyItems, setHistoryItems] = useState<HistoryListItem[]>([]);

  const [historyCursor, setHistoryCursor] = useState<string | null>(null);

  const [historyHasMore, setHistoryHasMore] = useState(false);

  const [historyLoading, setHistoryLoading] = useState(false);

  const [historyPreview, setHistoryPreview] = useState<{ item: HistoryListItem; payload: NoteHistoryPayload } | null>(null);

  useEffect(() => pinCache(userId, "history", historyPreview ? [historyPreview.item.historyId] : []), [userId, historyPreview?.item.historyId]);

  useEffect(() => {
    const noteId = activeDocument?.objectId;
    if (!noteId) return;
    const subscription = liveQuery(() => localDb.historySnapshots.where("[userId+noteId]").equals([userId, noteId]).primaryKeys()).subscribe({
      next: (keys) => {
        if (logoutStarted.current) return;
        const cached = new Set(keys);
        setHistoryItems((items) => items.map((item) => ({ ...item, offlineAvailable: cached.has(`${userId}:${noteId}:${item.historyId}`) })));
      }
    });
    return () => subscription.unsubscribe();
  }, [userId, activeDocument?.objectId]);

  const [renamingHistoryId, setRenamingHistoryId] = useState<string | null>(null);

  const historyLastSignature = useRef(new Map<string, string>());

  const historyLastCapturedAt = useRef(new Map<string, number>());

  const historyQuotaPaused = useRef(false);

  const historyIdleTimer = useRef<number | null>(null);

  const historyPeriodicTimer = useRef<number | null>(null);

  const historySession = useRef<{ noteId: string; active: boolean } | null>(null);

  const historyController = useMemo(() => new VaultHistoryController({
    userId,
    nextGeneration: () => Date.now() * 1000 + ++generation.current,
    isActive: () => !logoutStarted.current
  }), [userId]);

  const applyHistorySettings = (settings: HistorySettings) => {
    historySettingsRef.current = settings;
    historyQuotaPaused.current = false;
    setHistorySettings(settings);
    void localDb.meta.put({ key: historySettingsKey(userId), value: JSON.stringify(settings) });
  };

  const refreshHistorySettings = async (): Promise<HistorySettings> => {
    if (!serverSessionVerified) throw new Error(t("notice.onlineSessionRequired"));
    const settings = await api<HistorySettings>("/api/account/note-history-settings");
    applyHistorySettings(settings);
    return settings;
  };

  useEffect(() => {
    let cancelled = false;
    void localDb.meta.get(historySettingsKey(userId))
      .then((stored) => {
        if (!stored || cancelled) return;
        const parsed = JSON.parse(stored.value) as Partial<HistorySettings>;
        applyHistorySettings({ ...DEFAULT_HISTORY_SETTINGS, ...parsed });
      })
      .catch(() => undefined)
      .then(() => serverSessionVerified ? refreshHistorySettings() : undefined)
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [serverSessionVerified, userId]);

  useEffect(() => {
    if (historySettings.enabled) return;
    if (historyIdleTimer.current !== null) window.clearTimeout(historyIdleTimer.current);
    if (historyPeriodicTimer.current !== null) window.clearTimeout(historyPeriodicTimer.current);
    historyIdleTimer.current = null;
    historyPeriodicTimer.current = null;
    if (historySession.current) historySession.current.active = false;
  }, [historySettings.enabled]);

  const localHistoryForNote = (noteId: string) => historyController.localForNote(noteId);

  const localHistoryIndexesForNote = (noteId: string) => historyController.localIndexesForNote(noteId);

  const metadataForSnapshot = (snapshot: LocalHistorySnapshot, payload?: NoteHistoryPayload) => (
    historyController.metadataForSnapshot(snapshot, payload)
  );

  const localHistoryListItems = (
    snapshots: LocalHistorySnapshot[],
    indexes = [] as Awaited<ReturnType<typeof localHistoryIndexesForNote>>
  ) => historyController.localListItems(snapshots, indexes);

  const remoteHistoryListItems = (items: HistoryIndexEnvelope[]) => historyController.remoteListItems(items);

  const saveHistorySnapshot = async (
    document: OpenDocument,
    captureKind: HistoryCaptureKind,
    options: { force?: boolean; name?: string | null; protected?: boolean } = {}
  ): Promise<LocalHistorySnapshot | null> => {
    if (logoutStarted.current || document.kind !== "note" || document.deleted) return null;
    const capturedAt = new Date().toISOString();
    const payload = makeHistoryPayload({
      ...document,
      attachmentIds: attachmentIdsIn(document.markdown)
    }, capturedAt);
    const signature = historyContentSignature(payload);
    let latestSignature = historyLastSignature.current.get(document.objectId);
    if (latestSignature === undefined) {
      const latest = (await localHistoryForNote(document.objectId))[0];
      if (latest) {
        try {
          const decrypted = await cryptoClient.decryptHistory(
            userId,
            latest.noteId,
            latest.historyId,
            latest.capturedAt,
            latest.captureKind,
            latest.ciphertext,
            latest.nonce
          );
          latestSignature = historyContentSignature(decrypted);
          historyLastSignature.current.set(document.objectId, latestSignature);
          historyLastCapturedAt.current.set(document.objectId, new Date(latest.capturedAt).getTime());
        } catch {
          // A damaged cached snapshot must not block a new valid checkpoint.
        }
      }
    }
    if (!options.force && latestSignature === signature) return null;

    const localPendingBytes = (await localDb.historyOutbox.where("userId").equals(userId).toArray()).reduce((sum, item) => sum + item.byteSize, 0);
    const pendingBudget = Math.min(historySettingsRef.current.quotaBytes ?? Infinity, historySettingsRef.current.totalQuotaBytes ?? Infinity);
    if (localPendingBytes >= pendingBudget) {
      if (captureKind === "manual" || captureKind === "restore-safety") throw new Error(t("notice.historyQuotaReached"));
      historyQuotaPaused.current = true;
      showMessage(t("notice.historyQuotaReached"), "warning");
      return null;
    }
    const created = await historyController.createSnapshot(
      { ...document, attachmentIds: payload.attachmentIds },
      captureKind,
      { capturedAt, name: options.name, protected: options.protected, quotaBytes: Number.isFinite(pendingBudget) ? pendingBudget : null }
    ).catch((error: unknown) => {
      if (error instanceof Error && error.message === "HISTORY_LOCAL_BUDGET_EXCEEDED" && captureKind !== "manual" && captureKind !== "restore-safety") {
        historyQuotaPaused.current = true; showMessage(t("notice.historyQuotaReached"), "warning"); return null;
      }
      throw error;
    });
    if (!created) return null;
    const { metadata, snapshot } = created;
    historyLastSignature.current.set(document.objectId, signature);
    historyLastCapturedAt.current.set(document.objectId, new Date(capturedAt).getTime());
    setHistorySettings((current) => {
      const next = {
        ...current,
        count: current.count + 1,
        usedBytes: current.usedBytes + snapshot.byteSize
      };
      historySettingsRef.current = next;
      return next;
    });
    if (activeIdRef.current === document.objectId) {
      setHistoryItems((current) => mergeHistoryItems([localHistoryListItem(snapshot, metadata.name ?? "")], current));
    }
    requestPush("editor");
    return snapshot;
  };

  const loadHistory = async (noteId: string, cursor: string | null = null, append = false) => {
    setHistoryLoading(true);
    try {
      const [local, localIndexes] = await Promise.all([
        localHistoryForNote(noteId),
        localHistoryIndexesForNote(noteId)
      ]);
      const localItems = await localHistoryListItems(local, localIndexes);
      if (!serverSessionVerified) {
        setHistoryItems((current) => append ? mergeHistoryItems(current, localItems) : localItems);
        setHistoryCursor(null);
        setHistoryHasMore(false);
        return;
      }
      const query = new URLSearchParams({ limit: "50" });
      if (cursor) query.set("cursor", cursor);
      const response = await api<{
        items: HistoryIndexEnvelope[];
        nextCursor: string | null;
        clearedBefore: string | null;
      }>(`/api/notes/${noteId}/history?${query}`);
      if (response.clearedBefore) {
        const staleKeys = new Set([
          ...local.filter((item) => !item.protected && item.capturedAt <= response.clearedBefore!).map((item) => item.key),
          ...localIndexes.filter((item) => !item.protected && item.capturedAt <= response.clearedBefore!).map((item) => item.key)
        ]);
        if (staleKeys.size) {
          await localDb.transaction("rw", localDb.historySnapshots, localDb.historyIndex, localDb.historyOutbox, localDb.historyMetadataOutbox, async () => {
            const keys = [...staleKeys];
            await localDb.historySnapshots.bulkDelete(keys);
            await localDb.historyIndex.bulkDelete(keys);
            await localDb.historyOutbox.bulkDelete(keys);
            await localDb.historyMetadataOutbox.bulkDelete(keys);
          });
        }
      }
      const pending = localItems.filter((item) => item.pending && (
        item.protected || !response.clearedBefore || item.capturedAt > response.clearedBefore
      ));
      await historyController.cacheRemoteItems(response.items);
      const remoteItems = await remoteHistoryListItems(response.items);
      const cachedBodies = new Set((await localHistoryForNote(noteId)).map((item) => item.historyId));
      for (const item of remoteItems) item.offlineAvailable = cachedBodies.has(item.historyId);
      setHistoryItems((current) => append
        ? mergeHistoryItems(current, remoteItems, pending)
        : mergeHistoryItems(remoteItems, pending));
      setHistoryCursor(response.nextCursor);
      setHistoryHasMore(Boolean(response.nextCursor));
      const newest = mergeHistoryItems(remoteItems, pending)[0];
      if (newest) historyLastCapturedAt.current.set(noteId, new Date(newest.capturedAt).getTime());
    } catch (error) {
      const [local, localIndexes] = await Promise.all([
        localHistoryForNote(noteId),
        localHistoryIndexesForNote(noteId)
      ]);
      const localItems = await localHistoryListItems(local, localIndexes);
      setHistoryItems((current) => append ? mergeHistoryItems(current, localItems) : localItems);
      setHistoryCursor(null);
      setHistoryHasMore(false);
      if (!(error instanceof ApiError && error.status === 404)) {
        showMessage(translateError(error, t, "notice.historyLoadFailed"));
      }
    } finally {
      setHistoryLoading(false);
    }
  };

  const ensureHistorySnapshot = async (item: HistoryListItem): Promise<LocalHistorySnapshot> => {
    return historyController.ensureSnapshot(item, async () => {
      if (!serverSessionVerified) throw new Error(t("notice.onlineSessionRequired"));
      return api<EncryptedHistorySnapshot>(`/api/notes/${item.noteId}/history/${item.historyId}`);
    });
  };

  const selectHistorySnapshot = async (item: HistoryListItem) => {
    try {
      const snapshot = await ensureHistorySnapshot(item);
      const payload = await cryptoClient.decryptHistory(
        userId,
        snapshot.noteId,
        snapshot.historyId,
        snapshot.capturedAt,
        snapshot.captureKind,
        snapshot.ciphertext,
        snapshot.nonce
      );
      if (payload.schemaVersion !== 1) throw new Error(t("history.unsupported"));
      setHistoryPreview({ item, payload });
      setOutlineOpen(false);
    } catch (error) {
      showMessage(translateError(error, t, "notice.historyDecryptFailed"), "critical");
    }
  };

  const clearHistorySessionTimers = () => {
    if (historyIdleTimer.current !== null) window.clearTimeout(historyIdleTimer.current);
    if (historyPeriodicTimer.current !== null) window.clearTimeout(historyPeriodicTimer.current);
    historyIdleTimer.current = null;
    historyPeriodicTimer.current = null;
  };

  const captureHistoryAfterLocalSave = async (noteId: string, captureKind: HistoryCaptureKind) => {
    await flushDocument(noteId);
    const current = documentIndexRef.current.get(noteId);
    if (current?.kind === "note" && !current.deleted) await saveHistorySnapshot(current, captureKind);
  };

  const finishHistorySession = async (capture = true) => {
    const session = historySession.current;
    clearHistorySessionTimers();
    if (!session?.active) return;
    historySession.current = { ...session, active: false };
    if (capture && historySettingsRef.current.enabled && !historyQuotaPaused.current) {
      await captureHistoryAfterLocalSave(session.noteId, "idle");
    }
  };

  const scheduleHistoryEdit = (before: OpenDocument, after: OpenDocument) => {
    if (
      !historySettingsRef.current.enabled
      || historyQuotaPaused.current
      || before.kind !== "note"
      || !historyContentChanged(before, after)
    ) return;
    const now = Date.now();
    const intervalMs = historySettingsRef.current.intervalMinutes * 60_000;
    if (!historySession.current?.active || historySession.current.noteId !== before.objectId) {
      clearHistorySessionTimers();
      historySession.current = { noteId: before.objectId, active: true };
      const lastCapturedAt = historyLastCapturedAt.current.get(before.objectId) ?? 0;
      if (shouldCaptureHistoryBaseline(lastCapturedAt || undefined, now, historySettingsRef.current.intervalMinutes)) {
        void saveHistorySnapshot(before, "baseline").catch((error) => {
          showMessage(translateError(error, t, "notice.historySaveFailed"));
        });
      }
    }
    if (historyIdleTimer.current !== null) window.clearTimeout(historyIdleTimer.current);
    historyIdleTimer.current = window.setTimeout(() => {
      historyIdleTimer.current = null;
      void finishHistorySession(true).catch((error) => showMessage(translateError(error, t, "notice.historySaveFailed")));
    }, 2 * 60_000);

    const armPeriodic = () => {
      historyPeriodicTimer.current = window.setTimeout(() => {
        historyPeriodicTimer.current = null;
        const session = historySession.current;
        if (!session?.active || historyQuotaPaused.current) return;
        void captureHistoryAfterLocalSave(session.noteId, "interval")
          .catch((error) => showMessage(translateError(error, t, "notice.historySaveFailed")))
          .finally(() => {
            if (historySession.current?.active && !historyQuotaPaused.current) armPeriodic();
          });
      }, intervalMs);
    };
    if (historyPeriodicTimer.current === null) armPeriodic();
  };

  useEffect(() => {
    setHistoryPreview(null);
    setHistoryItems([]);
    setHistoryCursor(null);
    setHistoryHasMore(false);
    setRenamingHistoryId(null);
    historySession.current = null;
    clearHistorySessionTimers();
    if (activeDocument && preferences.rightPanelTab === "history") void loadHistory(activeDocument.objectId);
  }, [activeDocument?.objectId]);

  useEffect(() => {
    if (preferences.rightPanelTab === "history" && activeDocument) void loadHistory(activeDocument.objectId);
  }, [preferences.rightPanelTab]);

  return {
    historySettings,
    setHistorySettings,
    historySettingsRef,
    historyItems,
    setHistoryItems,
    historyCursor,
    historyHasMore,
    historyLoading,
    historyPreview,
    setHistoryPreview,
    renamingHistoryId,
    setRenamingHistoryId,
    historyLastSignature,
    historyLastCapturedAt,
    historyQuotaPaused,
    historyController,
    applyHistorySettings,
    refreshHistorySettings,
    metadataForSnapshot,
    saveHistorySnapshot,
    loadHistory,
    ensureHistorySnapshot,
    selectHistorySnapshot,
    finishHistorySession,
    scheduleHistoryEdit,
    clearHistorySessionTimers
  };
}
