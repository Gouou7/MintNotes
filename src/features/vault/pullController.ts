import { api } from "../../api";
import { cryptoClient } from "../../crypto/client";
import {
  cursorKey,
  localDb,
  localKey,
  type LocalEncryptedObject,
  type OutboxEntry
} from "../../storage/database";
import type { OpenAttachment, OpenDocument, SyncChange, VaultObject } from "../../types";
import { isAcknowledgedLocalEcho } from "../syncChanges";
import { normalizeVaultObject } from "../vaultLoad";
import { shouldSynchronizeWorkspaceObject } from "../workspace";
import { hasPendingLocalAuxiliaryData, hasPendingLocalObjectGraph } from "./localPurge";

export interface PullControllerDependencies {
  userId: string;
  isActive: () => boolean;
  activeObjectId: () => string | null;
  hasPendingSave: (objectId: string) => boolean;
  flushDocument: (objectId: string) => Promise<void>;
  preserveConflict: (entry: OutboxEntry) => Promise<OpenDocument | null>;
}

export interface PullControllerResult {
  failedObjectIds: Set<string>;
  documentUpserts: Map<string, OpenDocument>;
  attachmentUpserts: Map<string, OpenAttachment>;
  removedDocumentIds: Set<string>;
  removedAttachmentIds: Set<string>;
  activeConflictId: string | null;
  deferredActive: { objectId: string; document: OpenDocument | null; deleted: boolean } | null;
  purgeDeferred: boolean;
}

export async function pullVaultChanges(dependencies: PullControllerDependencies): Promise<PullControllerResult> {
  const resultState: PullControllerResult = {
    failedObjectIds: new Set(),
    documentUpserts: new Map(),
    attachmentUpserts: new Map(),
    removedDocumentIds: new Set(),
    removedAttachmentIds: new Set(),
    activeConflictId: null,
    deferredActive: null,
    purgeDeferred: false
  };
  if (!dependencies.isActive()) return resultState;
  let cursor = Number((await localDb.meta.get(cursorKey(dependencies.userId)))?.value ?? 0);
  let hasMore = true;
  const pendingByKey = new Map(
    (await localDb.outbox.where("userId").equals(dependencies.userId).toArray()).map((entry) => [entry.key, entry])
  );

  while (hasMore) {
    if (!dependencies.isActive()) return resultState;
    const page = await api<{ changes: SyncChange[]; cursor: number; hasMore: boolean; reset?: boolean }>(
      `/api/sync?since=${cursor}&limit=500&compact=1`
    );
    if (!dependencies.isActive()) return resultState;
    const localVersions = await localDb.objects.bulkGet(
      page.changes.map((change) => localKey(dependencies.userId, change.objectId))
    );
    const localVersionByKey = new Map(
      localVersions.flatMap((object) => object ? [[object.key, object] as const] : [])
    );
    const localPuts: LocalEncryptedObject[] = [];
    const purgedIds: string[] = [];
    const outboxDeletes: string[] = [];
    const blockingChangeIds = new Set<string>();

    for (const change of page.changes) {
      const key = localKey(dependencies.userId, change.objectId);
      if (!shouldSynchronizeWorkspaceObject(change.objectId)) {
        purgedIds.push(change.objectId);
        pendingByKey.delete(key);
        resultState.failedObjectIds.delete(change.objectId);
        continue;
      }
      if (change.purged) {
        if (dependencies.hasPendingSave(change.objectId)) {
          await dependencies.flushDocument(change.objectId);
          const durable = await localDb.outbox.get(key);
          if (durable) pendingByKey.set(key, durable);
        }
        const pending = pendingByKey.get(key);
        const graphPending = await hasPendingLocalObjectGraph(dependencies.userId, new Set([change.objectId]));
        const auxiliaryPending = await hasPendingLocalAuxiliaryData(dependencies.userId, change.objectId);
        if (auxiliaryPending) {
          blockingChangeIds.add(change.objectId);
          resultState.purgeDeferred = true;
          continue;
        }
        if (pending?.operation === "upsert" && pending.objectType !== "attachment") {
          const conflict = await dependencies.preserveConflict(pending);
          if (!conflict) {
            blockingChangeIds.add(change.objectId);
            resultState.purgeDeferred = true;
            continue;
          }
          resultState.documentUpserts.set(conflict.objectId, conflict);
          if (dependencies.activeObjectId() === change.objectId) resultState.activeConflictId = conflict.objectId;
        } else if (graphPending) {
          blockingChangeIds.add(change.objectId);
          resultState.purgeDeferred = true;
          continue;
        }
        purgedIds.push(change.objectId);
        pendingByKey.delete(key);
        if (change.objectId === dependencies.activeObjectId()) {
          resultState.deferredActive = { objectId: change.objectId, document: null, deleted: true };
        } else {
          resultState.removedDocumentIds.add(change.objectId);
          resultState.removedAttachmentIds.add(change.objectId);
        }
        resultState.failedObjectIds.delete(change.objectId);
        continue;
      }

      const pending = pendingByKey.get(key);
      if (dependencies.hasPendingSave(change.objectId)) continue;
      if (pending && change.revision > pending.baseRevision) {
        if (pending.operation === "upsert") {
          const conflict = await dependencies.preserveConflict(pending);
          if (conflict) {
            resultState.documentUpserts.set(conflict.objectId, conflict);
            if (dependencies.activeObjectId() === change.objectId) resultState.activeConflictId = conflict.objectId;
          }
        }
        outboxDeletes.push(key);
        pendingByKey.delete(key);
      } else if (pending) {
        continue;
      }
      if (isAcknowledgedLocalEcho(localVersionByKey.get(key), change)) continue;

      let decrypted: VaultObject;
      try {
        decrypted = normalizeVaultObject(await cryptoClient.decryptObject(
          dependencies.userId,
          change.objectId,
          change.objectType,
          change.revision,
          change.ciphertext,
          change.nonce
        ));
      } catch {
        resultState.failedObjectIds.add(change.objectId);
        blockingChangeIds.add(change.objectId);
        continue;
      }
      localPuts.push({
        key,
        userId: dependencies.userId,
        objectId: change.objectId,
        objectType: change.objectType,
        ciphertext: change.ciphertext,
        nonce: change.nonce,
        encryptionVersion: change.encryptionVersion,
        revision: change.revision,
        deleted: change.deleted,
        updatedAt: change.serverUpdatedAt
      });
      const open = { ...decrypted, objectId: change.objectId, serverRevision: change.revision, dirty: false };
      if (decrypted.kind === "attachment") {
        resultState.attachmentUpserts.set(change.objectId, open as OpenAttachment);
        resultState.removedAttachmentIds.delete(change.objectId);
      } else if (change.objectId === dependencies.activeObjectId() && resultState.activeConflictId === null) {
        resultState.deferredActive = {
          objectId: change.objectId,
          document: open as OpenDocument,
          deleted: (open as OpenDocument).deleted
        };
      } else {
        resultState.documentUpserts.set(change.objectId, open as OpenDocument);
        resultState.removedDocumentIds.delete(change.objectId);
      }
      resultState.failedObjectIds.delete(change.objectId);
      blockingChangeIds.delete(change.objectId);
    }

    const pageCanCommitCursor = blockingChangeIds.size === 0;
    if (pageCanCommitCursor) cursor = page.cursor;
    hasMore = pageCanCommitCursor && page.hasMore;
    if (!dependencies.isActive()) return resultState;
    await localDb.transaction("rw", [
      localDb.objects,
      localDb.outbox,
      localDb.attachmentChunks,
      localDb.attachmentOutbox,
      localDb.historySnapshots,
      localDb.historyIndex,
      localDb.historyOutbox,
      localDb.historyMetadataOutbox,
      localDb.meta
    ], async () => {
      if (!dependencies.isActive()) return;
      if (localPuts.length) await localDb.objects.bulkPut(localPuts);
      if (outboxDeletes.length) await localDb.outbox.bulkDelete(outboxDeletes);
      for (const objectId of purgedIds) {
        const key = localKey(dependencies.userId, objectId);
        await localDb.objects.delete(key);
        await localDb.outbox.delete(key);
        await localDb.attachmentChunks.where("[userId+attachmentId]").equals([dependencies.userId, objectId]).delete();
        await localDb.attachmentOutbox.where("[userId+attachmentId]").equals([dependencies.userId, objectId]).delete();
        await localDb.historySnapshots.where("[userId+noteId]").equals([dependencies.userId, objectId]).delete();
        await localDb.historyIndex.where("[userId+noteId]").equals([dependencies.userId, objectId]).delete();
        await localDb.historyOutbox.where("[userId+noteId]").equals([dependencies.userId, objectId]).delete();
        await localDb.historyMetadataOutbox.where("[userId+noteId]").equals([dependencies.userId, objectId]).delete();
      }
      if (pageCanCommitCursor) await localDb.meta.put({ key: cursorKey(dependencies.userId), value: String(cursor) });
    });
    if (!dependencies.isActive()) return resultState;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  return resultState;
}
