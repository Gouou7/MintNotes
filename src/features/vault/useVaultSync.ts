import { recordCompleteSync } from "../../storage/storageStatus";
import { reserveConflictRecovery, completeConflictRecoveries, restoreRecoveryChunks } from "./conflictRecovery";
import { withVaultSyncLock } from "./syncLock";
import { attachmentIdsIn } from "../attachments";
import { prepareVaultSynchronization } from "./syncReconciliation";
import { VaultHistoryController } from "./historyController";
import { operationExpired } from "@mint-notes/application-client";
import { maintainVaultStorage } from "./storageMaintenance";
import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { api, ApiError } from "../../api";
import { cryptoClient } from "../../crypto/client";
import { translateError, type Translate } from "../../i18n";
import { cursorKey, localDb, type ObjectUploadAttempt, type OutboxEntry } from "../../storage/database";
import type { OpenDocument, OpenAttachment } from "../../types";
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
  endpointId?: string;
  hasUnsavedChanges?: () => boolean;
  model: ReturnType<typeof useVaultModel>;
  selection: ReturnType<typeof useWorkspaceSelection>;
  userId: string;
  showMessage: ReturnType<typeof useToastNotifications>["showMessage"];
  t: Translate;
  persistDocumentCopy: (document: OpenDocument, sourceMarkdown: string, sourceAttachmentIds: readonly string[], options?: { commitState?: boolean; allowMissing?: boolean; sourceAttachments?: OpenAttachment[]; }) => Promise<OpenDocument>;
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
    const local = await cryptoClient.decryptObject(userId, entry.objectId, entry.objectType, entry.revision, entry.ciphertext, entry.nonce, entry);
    const recoveryRecord = await reserveConflictRecovery(userId, entry, local.kind === "attachment" ? [entry.objectId]
      : [...local.attachmentIds, ...attachmentIdsIn(local.markdown)], () => !logoutStarted.current);
    const sourceAttachments: OpenAttachment[] = [];
    await restoreRecoveryChunks(recoveryRecord, () => !logoutStarted.current);
    for (const object of recoveryRecord.attachments) {
      const metadata = await cryptoClient.decryptObject(userId, object.objectId, object.objectType, object.revision, object.ciphertext, object.nonce, object);
      if (metadata.kind !== "attachment") throw new Error("Invalid recovery attachment");
      sourceAttachments.push({ ...metadata, objectId: object.objectId, serverRevision: object.revision, dirty: false });
    }
    if (logoutStarted.current) throw new DOMException("Inactive vault", "AbortError");
    const savedCopy = await localDb.objects.get(`${userId}:${recoveryRecord.copyId}`);
    if (savedCopy) {
      const plain = await cryptoClient.decryptObject(userId, savedCopy.objectId, savedCopy.objectType, savedCopy.revision, savedCopy.ciphertext, savedCopy.nonce);
      if (plain.kind === "attachment") throw new Error("Invalid recovery copy");
      const queued = await localDb.outbox.get(savedCopy.key);
      return { ...plain, objectId: savedCopy.objectId, serverRevision: queued?.baseRevision ?? savedCopy.revision, dirty: Boolean(queued) };
    }
    if (local.kind === "attachment") {
      const text = `![${local.originalName}](webmd-attachment:${entry.objectId})`;
      const recovery = makeDocument(documentsRef.current, "note", `${local.originalName} (${t("app.conflictSuffix")})`, null, text);
      recovery.objectId = recoveryRecord.copyId;
      const copy = await persistDocumentCopy(recovery, text, [entry.objectId], { commitState, allowMissing: true, sourceAttachments });
      requestPush("structural");
      return copy;
    }
    const parentId = documentsRef.current.some((r) => r.objectId === local.parentId && r.kind === "folder" && !r.deleted) ? local.parentId : null;
    const conflict = makeDocument(documentsRef.current, local.kind, `${local.title} (${t("app.conflictSuffix")})`, parentId, local.markdown);
    conflict.objectId = recoveryRecord.copyId;
    conflict.tags = local.tags;
    conflict.favorite = local.favorite;
    conflict.locked = derivedNoteLockState(local, "conflict-copy");
    let persisted: OpenDocument;
    try {
      persisted = await persistDocumentCopy(conflict, local.markdown, local.attachmentIds, { commitState, allowMissing: true, sourceAttachments });
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

  const recoverAuxiliary = async (objectId: string, onlyExpired = false): Promise<boolean> => {
    const histories = await localDb.historyOutbox.where("[userId+noteId]").equals([userId, objectId]).toArray();
    const controller = new VaultHistoryController({ userId, isActive: () => !logoutStarted.current,
      nextGeneration: () => Date.now() * 1000 + ++generation.current });
    for (const snapshot of histories.filter((entry) => !onlyExpired || operationExpired(entry.idempotencyKey))) {
      const payload = await cryptoClient.decryptHistory(userId, objectId, snapshot.historyId, snapshot.capturedAt, snapshot.captureKind, snapshot.ciphertext, snapshot.nonce);
      const recovery = makeDocument(documentsRef.current, "note", `${payload.title} (${t("app.conflictSuffix")})`, null, payload.markdown);
      recovery.tags = payload.tags;
      const copy = await persistDocumentCopy(recovery, payload.markdown, payload.attachmentIds, { allowMissing: true });
      if (logoutStarted.current) return false;
      const saved = await controller.createSnapshot(copy, "manual", { protected: snapshot.protected, capturedAt: snapshot.capturedAt });
      if (!saved) return false;
      await localDb.transaction("rw", localDb.historyOutbox, localDb.historyMetadataOutbox, async () => {
        if ((await localDb.historyOutbox.get(snapshot.key))?.generation !== snapshot.generation) return;
        await localDb.historyOutbox.delete(snapshot.key);
        await localDb.historyMetadataOutbox.delete(snapshot.key);
      });
    }
    // Metadata-only pending versions need their original body to remain recoverable.
    const metadata = await localDb.historyMetadataOutbox.where("[userId+noteId]").equals([userId, objectId]).toArray();
    if (!onlyExpired) for (const item of metadata) {
      const payload = await cryptoClient.decryptHistoryMetadata(userId, item.noteId, item.historyId, item.capturedAt, item.metadataCiphertext, item.metadataNonce);
      const text = t("notice.recoveredHistoryMetadata", { name: payload.name ?? "", date: item.capturedAt });
      const recovery = makeDocument(documentsRef.current, "note", t("app.conflictSuffix"), null, text);
      await persistDocumentCopy(recovery, text, [], { allowMissing: true });
      await localDb.transaction("rw", localDb.historyMetadataOutbox, async () => {
        if ((await localDb.historyMetadataOutbox.get(item.key))?.generation === item.generation) await localDb.historyMetadataOutbox.delete(item.key);
      });
    }
    if (onlyExpired) return true;
    const object = await localDb.objects.get(`${userId}:${objectId}`);
    if (object?.objectType !== "attachment") {
      const children = (await localDb.outbox.where("userId").equals(userId).toArray()).filter((r) => r.ownerNoteId === objectId);
      for (const child of children) if (!await recoverAuxiliary(child.objectId)) return false;
    }
    if (object?.objectType === "attachment") {
      const pending = await localDb.outbox.get(object.key);
      const chunks = await localDb.attachmentOutbox.where("[userId+attachmentId]").equals([userId, objectId]).toArray();
      if (pending || chunks.length) {
        const source: OutboxEntry = pending ?? { ...object, operation: "upsert", baseRevision: Math.max(0, object.revision - 1),
          idempotencyKey: chunks[0].idempotencyKey, generation: chunks[0].generation };
        if (!await preserveConflict(source, true, false)) return false;
        if (logoutStarted.current) return false;
        await localDb.transaction("rw", localDb.outbox, localDb.attachmentOutbox, async () => {
          if ((await localDb.outbox.get(object.key))?.idempotencyKey === pending?.idempotencyKey) await localDb.outbox.delete(object.key);
          for (const chunk of chunks) if ((await localDb.attachmentOutbox.get(chunk.key))?.idempotencyKey === chunk.idempotencyKey) await localDb.attachmentOutbox.delete(chunk.key);
        });
      }
    }
    return true;
  };
  const pullDependencies = () => ({
    userId,
    isActive: () => !logoutStarted.current,
    activeObjectId: () => activeIdRef.current,
    hasPendingSave: documentSaveQueue.hasPending,
    flushDocument,
    coordinate: objectPersistence.coordinate,
    acknowledge: acknowledgeAcceptedUpload,
    preserveConflict: (entry: OutboxEntry) => preserveConflict(entry, false, false),
    recoverAuxiliary,
    discardConflict: async (copy: OpenDocument) => {
      // A copy may already be the only durable recovery graph after a crash.
      // Keep it even when a newer source invalidates this page's optimistic commit.
      if (!logoutStarted.current) upsertDocument(copy);
      nameReservations.current.release(copy.objectId);
    },
    onPage: publishPullResult,
    onServerTrashTime: (objectId: string, deleted: boolean, serverTrashedAt: string | null) => {
      const current = documentIndexRef.current.get(objectId) ?? attachmentIndexRef.current.get(objectId);
      if (!current || current.deleted !== deleted) return;
      if (current.kind === "attachment") upsertAttachment({ ...current, serverTrashedAt });
      else upsertDocument({ ...current, serverTrashedAt });
    }
  });
  const pullChanges = async () => (await pullVaultChanges(pullDependencies())).failedObjectIds;

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
        prepare: async () => {
          for (const record of await localDb.recoveries.where("userId").equals(userId).toArray()) {
            if (record.kind === "conversion" || await localDb.objects.get(`${userId}:${record.copyId}`)) continue;
            await preserveConflict(record.source, true, false);
          }
          return prepareVaultSynchronization(pullDependencies());
        },
        push: pushPending,
        pull: pullChanges
      }, intent);
      await completeConflictRecoveries(userId, () => !logoutStarted.current);
      result.pending = await countPendingSyncEntries(userId);
      if (logoutStarted.current) return;
      if (!result.failedObjectIds.size) await maintainVaultStorage({ userId, isActive: () => !logoutStarted.current,
        documents: documentsRef.current, attachments: attachmentsRef.current, getDocument: (id) => documentIndexRef.current.get(id), hasPendingSave: documentSaveQueue.hasPending, trashOrphan: async (attachment) => {
          await objectPersistence.persistObject(attachment); requestPush("structural");
        } });
      if (result.failedObjectIds.size) showMessage(t("notice.remoteIntegrity", { count: result.failedObjectIds.size }), "critical");
      if (options.endpointId) await recordCompleteSync(userId, options.endpointId,
        intent.pull && !result.failedObjectIds.size && !result.pending && !documentSaveQueue.pendingIds().length
        && !options.hasUnsavedChanges?.() && await countPendingSyncEntries(userId) === 0);
      window.dispatchEvent(new CustomEvent("webmd:storage-refresh"));
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

  executeSyncRef.current = (intent) => withVaultSyncLock(userId, () => executeSync(intent));

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
    const retry = () => { void synchronize().catch(() => {}); };
    window.addEventListener("webmd:retry-recoveries", retry);
    return () => window.removeEventListener("webmd:retry-recoveries", retry);
  });

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
