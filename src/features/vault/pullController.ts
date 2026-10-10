import { api } from "../../api";
import { cryptoClient } from "../../crypto/client";
import { cursorKey, localDb, localKey, type LocalEncryptedObject, type ObjectUploadAttempt, type OutboxEntry } from "../../storage/database";
import type { OpenAttachment, OpenDocument, SyncChange, VaultObject } from "../../types";
import { isAcknowledgedLocalEcho } from "../syncChanges";
import { normalizeVaultObject } from "../vaultLoad";
import { shouldSynchronizeWorkspaceObject } from "../workspace";
import { hasPendingLocalAuxiliaryData, hasPendingLocalObjectGraph } from "./localPurge";
import { acknowledgeOutboxEntry, sameOutboxEntry } from "./outboxAcknowledgement";

export interface PullControllerDependencies {
  userId: string;
  isActive: () => boolean;
  activeObjectId: () => string | null;
  hasPendingSave: (objectId: string) => boolean;
  flushDocument: (objectId: string) => Promise<void>;
  preserveConflict: (entry: OutboxEntry) => Promise<OpenDocument | null>;
  discardConflict?: (document: OpenDocument) => Promise<void>;
  coordinate?: <T>(objectId: string, operation: () => Promise<T>) => Promise<T>;
  acknowledge?: (entry: ObjectUploadAttempt, revision: number) => Promise<void>;
  onPage?: (result: PullControllerResult) => void;
}

export interface PullControllerResult {
  failedObjectIds: Set<string>;
  documentUpserts: Map<string, OpenDocument>;
  attachmentUpserts: Map<string, OpenAttachment>;
  removedDocumentIds: Set<string>;
  removedAttachmentIds: Set<string>;
  conflicts: Map<string, string>;
  activeConflictId: string | null;
  deferredActive: { objectId: string; document: OpenDocument | null; deleted: boolean } | null;
  purgeDeferred: boolean;
}

function emptyResult(): PullControllerResult {
  return {
    failedObjectIds: new Set(), documentUpserts: new Map(), attachmentUpserts: new Map(),
    removedDocumentIds: new Set(), removedAttachmentIds: new Set(), conflicts: new Map(),
    activeConflictId: null, deferredActive: null, purgeDeferred: false
  };
}

function sameLocalVersion(left: LocalEncryptedObject | undefined, right: LocalEncryptedObject | undefined) {
  return left === right || Boolean(left && right && isAcknowledgedLocalEcho(left, {
    ...right, sequence: 0, serverUpdatedAt: right.updatedAt
  }));
}

interface Candidate {
  change: SyncChange;
  stored?: LocalEncryptedObject;
  pending?: OutboxEntry;
  decrypted?: VaultObject;
  conflict?: OpenDocument;
  committed?: boolean;
}

/** Crypto and attachment copies run outside write lanes; only the guarded page commit holds them. */
export async function pullVaultChanges(dependencies: PullControllerDependencies): Promise<PullControllerResult> {
  const total = emptyResult();
  const { userId, isActive } = dependencies;
  const coordinate = dependencies.coordinate ?? (async <T,>(_id: string, operation: () => Promise<T>) => operation());
  if (!isActive()) return total;
  let cursor = Number((await localDb.meta.get(cursorKey(userId)))?.value ?? 0);
  let hasMore = true;
  while (hasMore && isActive()) {
    const page = await api<{ changes: SyncChange[]; cursor: number; hasMore: boolean; reset?: boolean }>(
      `/api/sync?since=${cursor}&limit=500&compact=1`
    );
    if (!isActive()) return total;
    const result = emptyResult();
    const candidates: Candidate[] = [];
    const blocked = new Set<string>();
    for (const change of page.changes) {
      if (!isActive()) return total;
      const key = localKey(userId, change.objectId);
      if (change.purged && dependencies.hasPendingSave(change.objectId)) await dependencies.flushDocument(change.objectId);
      if (dependencies.hasPendingSave(change.objectId)) {
        blocked.add(change.objectId);
        continue;
      }
      let [stored, pending] = await localDb.transaction("r", localDb.objects, localDb.outbox, () => (
        Promise.all([localDb.objects.get(key), localDb.outbox.get(key)])
      ));
      const echo = pending && [pending.upload, pending].find((entry) => entry && isAcknowledgedLocalEcho(entry, change));
      if (echo) {
        await coordinate(change.objectId, async () => {
          if (!isActive()) return;
          if (dependencies.acknowledge) await dependencies.acknowledge(echo, change.revision);
          else await acknowledgeOutboxEntry(userId, echo, change.revision, () => Date.now() * 1000, cryptoClient, isActive);
        });
        continue;
      }
      if (!change.purged && isAcknowledgedLocalEcho(stored, change) && !pending) continue;
      let decrypted: VaultObject | undefined;
      if (!change.purged && shouldSynchronizeWorkspaceObject(change.objectId)) {
        try {
          decrypted = normalizeVaultObject(await cryptoClient.decryptObject(
            userId, change.objectId, change.objectType, change.revision, change.ciphertext, change.nonce
          ));
          if (decrypted.kind !== change.objectType || decrypted.deleted !== change.deleted) throw new Error("Invalid object envelope");
        } catch {
          result.failedObjectIds.add(change.objectId);
          blocked.add(change.objectId);
          continue;
        }
        // Reads made before the network/crypto waits are never used to decide a conflict.
        [stored, pending] = await localDb.transaction("r", localDb.objects, localDb.outbox, () => (
          Promise.all([localDb.objects.get(key), localDb.outbox.get(key)])
        ));
      }
      if (dependencies.hasPendingSave(change.objectId)) {
        blocked.add(change.objectId);
        continue;
      }
      const candidate: Candidate = { change, stored, pending, decrypted };
      if (!shouldSynchronizeWorkspaceObject(change.objectId)) {
        candidates.push(candidate);
        continue;
      }
      if (change.purged) {
        const graphPending = await hasPendingLocalObjectGraph(userId, new Set([change.objectId]));
        if (await hasPendingLocalAuxiliaryData(userId, change.objectId)
          || (graphPending && (!pending || pending.objectType === "attachment"))) {
          blocked.add(change.objectId);
          result.purgeDeferred = true;
          continue;
        }
      } else {
        if (pending && change.revision <= pending.baseRevision) continue;
        if (!pending && stored && stored.revision > change.revision) continue;
      }
      if (pending?.operation === "upsert") {
        const conflict = await dependencies.preserveConflict(pending);
        if (!conflict) {
          blocked.add(change.objectId);
          if (change.purged) result.purgeDeferred = true;
          continue;
        }
        candidate.conflict = conflict;
      }
      candidates.push(candidate);
    }

    const keys = [...new Set(candidates.map((entry) => entry.change.objectId))].sort();
    const commit = async (): Promise<void> => {
      await localDb.transaction("rw", [
        localDb.objects, localDb.outbox, localDb.attachmentChunks, localDb.attachmentOutbox,
        localDb.historySnapshots, localDb.historyIndex, localDb.historyOutbox, localDb.historyMetadataOutbox, localDb.meta
      ], async () => {
        for (const candidate of candidates) {
          const { change } = candidate;
          const key = localKey(userId, change.objectId);
          const [stored, pending] = await Promise.all([localDb.objects.get(key), localDb.outbox.get(key)]);
          if (!isActive() || dependencies.hasPendingSave(change.objectId)
            || !sameLocalVersion(stored, candidate.stored) || !sameOutboxEntry(pending, candidate.pending)) {
            blocked.add(change.objectId);
            continue;
          }
          if (change.purged || !shouldSynchronizeWorkspaceObject(change.objectId)) {
            if (shouldSynchronizeWorkspaceObject(change.objectId) && await hasPendingLocalAuxiliaryData(userId, change.objectId)) {
              blocked.add(change.objectId);
              result.purgeDeferred = true;
              continue;
            }
            await localDb.objects.delete(key);
            await localDb.outbox.delete(key);
            await localDb.attachmentChunks.where("[userId+attachmentId]").equals([userId, change.objectId]).delete();
            await localDb.attachmentOutbox.where("[userId+attachmentId]").equals([userId, change.objectId]).delete();
            await localDb.historySnapshots.where("[userId+noteId]").equals([userId, change.objectId]).delete();
            await localDb.historyIndex.where("[userId+noteId]").equals([userId, change.objectId]).delete();
            await localDb.historyOutbox.where("[userId+noteId]").equals([userId, change.objectId]).delete();
            await localDb.historyMetadataOutbox.where("[userId+noteId]").equals([userId, change.objectId]).delete();
          } else {
            await localDb.objects.put({
              key, userId, objectId: change.objectId, objectType: change.objectType,
              ciphertext: change.ciphertext, nonce: change.nonce, encryptionVersion: change.encryptionVersion,
              revision: change.revision, deleted: change.deleted, updatedAt: change.serverUpdatedAt
            });
            if (pending) await localDb.outbox.delete(key);
          }
          candidate.committed = true;
        }
        if (isActive() && !blocked.size) {
          await localDb.meta.put({ key: cursorKey(userId), value: String(page.cursor) });
        }
      });
      if (!isActive()) return;
      for (const candidate of candidates.filter((entry) => entry.committed)) {
        const { change, conflict, decrypted } = candidate;
        if (conflict) {
          result.documentUpserts.set(conflict.objectId, conflict);
          result.conflicts.set(change.objectId, conflict.objectId);
          if (dependencies.activeObjectId() === change.objectId) result.activeConflictId = conflict.objectId;
        }
        if (change.purged || !shouldSynchronizeWorkspaceObject(change.objectId)) {
          result.removedDocumentIds.add(change.objectId);
          result.removedAttachmentIds.add(change.objectId);
          if (dependencies.activeObjectId() === change.objectId && !conflict) {
            result.deferredActive = { objectId: change.objectId, document: null, deleted: true };
          }
        } else if (decrypted) {
          const open = { ...decrypted, objectId: change.objectId, serverRevision: change.revision, dirty: false };
          if (open.kind === "attachment") result.attachmentUpserts.set(change.objectId, open);
          else if (dependencies.activeObjectId() === change.objectId && !conflict) {
            result.deferredActive = { objectId: change.objectId, document: open, deleted: open.deleted };
          } else result.documentUpserts.set(change.objectId, open);
        }
      }
      // Publish before another page can fail, and before a queued local write can finish.
      dependencies.onPage?.(result);
    };
    const lock = (index: number): Promise<void> => index === keys.length
      ? commit() : coordinate(keys[index], () => lock(index + 1));
    await lock(0);
    for (const candidate of candidates) {
      if (candidate.conflict && !candidate.committed) await dependencies.discardConflict?.(candidate.conflict);
    }
    for (const [id, value] of result.documentUpserts) { total.documentUpserts.set(id, value); total.failedObjectIds.delete(id); }
    for (const [id, value] of result.attachmentUpserts) { total.attachmentUpserts.set(id, value); total.failedObjectIds.delete(id); }
    for (const id of result.failedObjectIds) total.failedObjectIds.add(id);
    for (const id of result.removedDocumentIds) { total.removedDocumentIds.add(id); total.documentUpserts.delete(id); }
    for (const id of result.removedAttachmentIds) { total.removedAttachmentIds.add(id); total.attachmentUpserts.delete(id); }
    for (const [id, value] of result.conflicts) total.conflicts.set(id, value);
    total.activeConflictId = result.activeConflictId ?? total.activeConflictId;
    total.deferredActive = result.deferredActive ?? total.deferredActive;
    total.purgeDeferred ||= result.purgeDeferred;
    if (blocked.size) break;
    cursor = page.cursor;
    hasMore = page.hasMore;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  return total;
}
