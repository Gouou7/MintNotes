import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { ApiError } from "../../api";
import { cryptoClient } from "../../crypto/client";
import { translateError, type Translate } from "../../i18n";
import { cursorKey, localDb, type ObjectUploadAttempt, type OutboxEntry } from "../../storage/database";
import type { OpenDocument } from "../../types";
import { derivedNoteLockState } from "../noteLock";
import { NameReservations } from "../siblingNames";
import { applyVaultAcknowledgement } from "../syncChanges";
import { mergeByObjectId, SyncCoordinator, type SyncIntent } from "../syncCoordinator";
import { WORKSPACE_OBJECT_ID } from "../workspace";
import { makeDocument } from "./documentFactory";
import { removePurgedLocalData } from "./localPurge";
import { acknowledgeOutboxEntry } from "./outboxAcknowledgement";
import { pullVaultChanges, type PullControllerResult } from "./pullController";
import { pushVaultPending } from "./pushController";
import { executeVaultSync } from "./syncExecution";
import type { useDocumentSaveQueue } from "./useDocumentSaveQueue";
import type { useObjectPersistence } from "./useObjectPersistence";
import { useSyncConnection } from "./useSyncConnection";
import type { SaveState } from "./useSyncStatus";
import { countPendingSyncEntries, synchronizationFailure, type SyncFailure } from "./useSyncStatus";
import type { useToastNotifications } from "./useToastNotifications";
import type { useVaultModel } from "./useVaultModel";
import type { useWorkspaceSelection } from "./useWorkspaceSelection";

interface Options {
  model: ReturnType<typeof useVaultModel>;
  selection: ReturnType<typeof useWorkspaceSelection>;
  userId: string;
  showMessage: ReturnType<typeof useToastNotifications>["showMessage"];
  t: Translate;
  persistDocumentCopy: (document: OpenDocument, sourceMarkdown: string, sourceAttachmentIds: readonly string[], options?: { commitState?: boolean; }) => Promise<OpenDocument>;
  generation: RefObject<number>;
  logoutStarted: RefObject<boolean>;
  documentSaveQueue: ReturnType<typeof useDocumentSaveQueue>;
  nameReservations: RefObject<NameReservations>;
  objectPersistence: ReturnType<typeof useObjectPersistence>;
  pushHistoryPending: () => Promise<boolean>;
  pushHistoryMetadataPending: () => Promise<boolean>;
  serverSessionVerifiedRef: RefObject<boolean>;
  setUnavailable: () => void;
  setSaveState: (phase: Exclude<SaveState, "error">) => void;
  setSyncError: (failure: SyncFailure) => void;
  workspaceLoaded: boolean;
  serverSessionVerified: boolean;
  finishHistorySession: (capture?: boolean) => Promise<void>;
  flushDocument: (objectId: string) => Promise<void>;
}

/** 保险库同步调度、上传确认、拉取与冲突协调。 */
export function useVaultSync(options: Options) {
  const {
    model,
    selection,
    userId,
    showMessage,
    t,
    persistDocumentCopy,
    generation,
    logoutStarted,
    documentSaveQueue,
    nameReservations,
    objectPersistence,
    pushHistoryPending,
    pushHistoryMetadataPending,
    serverSessionVerifiedRef,
    setUnavailable,
    setSaveState,
    setSyncError,
    workspaceLoaded,
    serverSessionVerified,
    finishHistorySession,
    flushDocument
  } = options;
  const {
    replaceDocuments,
    documentsRef,
    replaceAttachments,
    attachmentIndexRef,
    documentIndexRef,
    upsertAttachment,
    upsertDocument,
    attachmentsRef
  } = model;
  const { activeIdRef, activateDocument, setSelectedIds, selectionAnchor } = selection;

  const syncClientId = useRef(crypto.randomUUID());

  const syncCoordinator = useRef<SyncCoordinator | null>(null);

  const executeSyncRef = useRef<(intent: SyncIntent) => Promise<void>>(async () => undefined);

  const syncStatusTimer = useRef<number | null>(null);

  const deferredActiveRemote = useRef<OpenDocument | null>(null);

  const deferredActiveRemoteId = useRef<string | null>(null);

  const applyDeferredActiveRemote = (objectId: string) => {
    if (deferredActiveRemoteId.current !== objectId) return;
    const remote = deferredActiveRemote.current;
    if (remote) replaceDocuments(mergeByObjectId(documentsRef.current, [remote]));
    else replaceDocuments((current) => current.filter((entry) => entry.objectId !== objectId));
    deferredActiveRemoteId.current = null;
    deferredActiveRemote.current = null;
  };

  const preserveConflict = async (
    entry: OutboxEntry,
    commitState = true,
    rebindActive = true
  ): Promise<OpenDocument | null> => {
    if (entry.objectId === WORKSPACE_OBJECT_ID) return null;
    const local = await cryptoClient.decryptObject(userId, entry.objectId, entry.objectType, entry.revision, entry.ciphertext, entry.nonce);
    if (local.kind === "attachment") {
      showMessage(t("notice.attachmentConflict"), "critical");
      return null;
    }
    const conflict = makeDocument(documentsRef.current, local.kind, `${local.title} (${t("app.conflictSuffix")})`, local.parentId, local.markdown);
    conflict.tags = local.tags;
    conflict.favorite = local.favorite;
    conflict.locked = derivedNoteLockState(local, "conflict-copy");
    let persisted: OpenDocument;
    try {
      persisted = await persistDocumentCopy(conflict, local.markdown, local.attachmentIds, { commitState });
    } catch (error) {
      showMessage(translateError(error, t, "notice.attachmentConflict"), "critical");
      throw error;
    }
    requestPush("structural");
    if (rebindActive && activeIdRef.current === entry.objectId) {
      activateDocument(persisted.objectId);
    }
    if (commitState) showMessage(t("notice.documentConflict", { title: local.title }), "critical");
    return persisted;
  };

  const removePurgedLocal = async (objectId: string, commitState = true) => {
    await removePurgedLocalData(userId, objectId);
    if (!commitState) return;
    replaceDocuments((all) => all.filter((entry) => entry.objectId !== objectId));
    replaceAttachments((all) => all.filter((entry) => entry.objectId !== objectId));
    setSelectedIds((current) => {
      if (!current.has(objectId)) return current;
      const next = new Set(current);
      next.delete(objectId);
      return next;
    });
    if (selectionAnchor.current === objectId) selectionAnchor.current = null;
  };

  const acknowledgeAcceptedUpload = async (entry: ObjectUploadAttempt, revision: number) => {
    const result = await acknowledgeOutboxEntry(
      userId, entry, revision, () => Date.now() * 1000 + ++generation.current,
      cryptoClient, () => !logoutStarted.current
    );
    if (logoutStarted.current || result.status === "missing") return;
    const current = entry.objectType === "attachment"
      ? attachmentIndexRef.current.get(entry.objectId) : documentIndexRef.current.get(entry.objectId);
    if (current) {
      const next = applyVaultAcknowledgement(
        current, result.object, result.status === "rebased" ? result.entry.baseRevision : revision,
        result.status === "rebased" || documentSaveQueue.hasPending(entry.objectId)
      );
      if (next.kind === "attachment") upsertAttachment(next);
      else upsertDocument(next);
    }
    if (result.status === "rebased") requestPush("editor");
  };

  const publishPullResult = (result: PullControllerResult) => {
    if (logoutStarted.current) return;
    // Input can arrive while the IndexedDB commit finishes. Its plaintext draft
    // must survive until the save queue makes it durable, even after a real conflict.
    const documentUpserts = [...result.documentUpserts.values()].filter((entry) => !documentSaveQueue.hasPending(entry.objectId));
    const removedDocumentIds = [...result.removedDocumentIds].filter((id) => !documentSaveQueue.hasPending(id));
    for (const sourceId of result.conflicts.keys()) {
      const title = documentIndexRef.current.get(sourceId)?.title ?? "";
      showMessage(t("notice.documentConflict", { title }), "critical");
    }
    if (result.documentUpserts.size || result.removedDocumentIds.size) {
      replaceDocuments(mergeByObjectId(documentsRef.current, documentUpserts, removedDocumentIds));
      for (const id of result.documentUpserts.keys()) nameReservations.current.release(id);
    }
    if (result.attachmentUpserts.size || result.removedAttachmentIds.size) {
      replaceAttachments(mergeByObjectId(attachmentsRef.current, result.attachmentUpserts.values(), result.removedAttachmentIds));
    }
    if (result.activeConflictId && !documentSaveQueue.hasPending(activeIdRef.current ?? "")) {
      deferredActiveRemoteId.current = null;
      deferredActiveRemote.current = null;
      activateDocument(result.activeConflictId);
    } else if (result.deferredActive) {
      deferredActiveRemoteId.current = result.deferredActive.objectId;
      deferredActiveRemote.current = result.deferredActive.document;
    }
    if (result.removedDocumentIds.size || result.removedAttachmentIds.size) {
      setSelectedIds((current) => new Set([...current].filter((id) => (
        !result.removedDocumentIds.has(id) && !result.removedAttachmentIds.has(id)
      ))));
      if (selectionAnchor.current && (
        result.removedDocumentIds.has(selectionAnchor.current)
        || result.removedAttachmentIds.has(selectionAnchor.current)
      )) selectionAnchor.current = null;
    }
    if (result.deferredActive) {
      showMessage(result.deferredActive.deleted ? t("notice.activeRemoteDeleted") : t("notice.activeRemoteUpdated"), "info");
    }
    if (result.purgeDeferred) showMessage(t("notice.purgeWaitSync"), "critical");
  };

  const pullChanges = async () => {
    const result = await pullVaultChanges({
      userId,
      isActive: () => !logoutStarted.current,
      activeObjectId: () => activeIdRef.current,
      hasPendingSave: documentSaveQueue.hasPending,
      flushDocument,
      coordinate: objectPersistence.coordinate,
      acknowledge: acknowledgeAcceptedUpload,
      preserveConflict: (entry) => preserveConflict(entry, false, false),
      discardConflict: async (copy) => {
        for (const id of copy.attachmentIds) await removePurgedLocal(id);
        await removePurgedLocal(copy.objectId, false);
        nameReservations.current.release(copy.objectId);
      },
      onPage: publishPullResult
    });
    return result.failedObjectIds;
  };

  const pushPending = () => pushVaultPending({
    userId,
    clientId: syncClientId.current,
    isActive: () => !logoutStarted.current,
    acknowledge: (entry, revision) => objectPersistence.coordinate(entry.objectId, () => acknowledgeAcceptedUpload(entry, revision)),
    onConflict: async () => {
      await localDb.meta.put({ key: cursorKey(userId), value: "0" });
      requestPull(0);
    },
    pushHistory: pushHistoryPending,
    pushHistoryMetadata: pushHistoryMetadataPending
  });

  const executeSync = async (intent: SyncIntent) => {
    if (logoutStarted.current) return;
    if (!serverSessionVerifiedRef.current) {
      setUnavailable();
      return;
    }
    const queued = await countPendingSyncEntries(userId);
    if (logoutStarted.current) return;
    if (!intent.pull && (!intent.push || queued === 0)) return;

    if (syncStatusTimer.current !== null) window.clearTimeout(syncStatusTimer.current);
    syncStatusTimer.current = window.setTimeout(() => setSaveState("syncing"), 200);
    try {
      const result = await executeVaultSync({
        isActive: () => !logoutStarted.current,
        countPending: () => countPendingSyncEntries(userId),
        push: pushPending,
        pull: pullChanges
      }, intent);
      if (logoutStarted.current) return;
      if (result.failedObjectIds.size) showMessage(t("notice.remoteIntegrity", { count: result.failedObjectIds.size }), "critical");
      setSaveState(documentSaveQueue.pendingIds().length ? "saving" : result.pending ? "local" : "synced");
    } catch (error) {
      if (logoutStarted.current) return;
      if (!(error instanceof ApiError) && !navigator.onLine) setSaveState("offline");
      else setSyncError(synchronizationFailure(error, t));
      showMessage(error instanceof ApiError ? translateError(error, t, "notice.syncFailed") : t("notice.syncFailed"));
      requestFallbackPull();
      throw error;
    } finally {
      if (syncStatusTimer.current !== null) window.clearTimeout(syncStatusTimer.current);
      syncStatusTimer.current = null;
    }
  };

  executeSyncRef.current = executeSync;

  function requestPush(kind: "editor" | "structural" = "editor") {
    if (logoutStarted.current) return;
    syncCoordinator.current?.request(
      { push: true },
      kind === "structural"
        ? { delayMs: 250, maxWaitMs: 2_000 }
        : { delayMs: 2_000, maxWaitMs: 15_000 }
    );
  }

  function requestPull(delayMs = 250) {
    if (logoutStarted.current) return;
    syncCoordinator.current?.request({ pull: true }, { delayMs, maxWaitMs: Math.max(1_000, delayMs) });
  }

  const synchronize = async () => {
    if (logoutStarted.current) return;
    await syncCoordinator.current?.runNow({ pull: true, push: true });
  };

  useEffect(() => {
    const coordinator = new SyncCoordinator({
      execute: (intent) => executeSyncRef.current(intent),
      canRun: () => serverSessionVerifiedRef.current && document.visibilityState === "visible"
    });
    syncCoordinator.current = coordinator;
    return () => {
      coordinator.dispose();
      if (syncCoordinator.current === coordinator) syncCoordinator.current = null;
    };
  }, []);

  const { requestFallbackPull, stop: stopSyncConnection } = useSyncConnection({
    userId,
    clientId: syncClientId.current,
    enabled: workspaceLoaded,
    serverSessionVerified,
    isActive: () => !logoutStarted.current,
    synchronize,
    requestPull,
    onHidden: () => {
      void finishHistorySession(true);
      for (const id of documentSaveQueue.pendingIds()) void flushDocument(id);
    }
  });

  const stopSync = () => {
    syncCoordinator.current?.dispose();
    syncCoordinator.current = null;
    stopSyncConnection();
    if (syncStatusTimer.current !== null) window.clearTimeout(syncStatusTimer.current);
    syncStatusTimer.current = null;
  };

  return {
    syncClientId,
    applyDeferredActiveRemote,
    removePurgedLocal,
    pullChanges,
    requestPush,
    synchronize,
    stopSync
  };
}
