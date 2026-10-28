import { api } from "../../api";
import { ensureBodyBlocks, persistBodyBlocks } from "../../storage/noteBodies";
import type { EncryptedNoteBodyBlock } from "@mint-notes/application-client";
import { operationExpired, operationId } from "@mint-notes/application-client";
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
  onServerTrashTime?: (objectId: string, deleted: boolean, time: string | null) => void;
  recoverAuxiliary?: (objectId: string, onlyExpired?: boolean) => Promise<boolean>;
  forceConflictIds?: ReadonlySet<string>;
  fetchPage?: (cursor: number) => Promise<{ changes: SyncChange[]; cursor: number; hasMore: boolean; reset?: boolean }>;
  initialCursor?: number;
  commitCursor?: boolean;
  reconcileSnapshot?: boolean;
  recoverLocalTimeline?: boolean;
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
  complete: boolean;
  cursor: number;
}

function emptyResult(): PullControllerResult {
  return {
    failedObjectIds: new Set(), documentUpserts: new Map(), attachmentUpserts: new Map(),
    removedDocumentIds: new Set(), removedAttachmentIds: new Set(), conflicts: new Map(),
    activeConflictId: null, deferredActive: null, purgeDeferred: false, complete: true, cursor: 0
  };
}

function sameLocalVersion(left: LocalEncryptedObject | undefined, right: LocalEncryptedObject | undefined) {
  return left === right || Boolean(left && right && isAcknowledgedLocalEcho(left, {
    ...right, sequence: 0, serverUpdatedAt: right.updatedAt
  }));
}

interface Candidate {
  bodyBlocks?: EncryptedNoteBodyBlock[];
  change: SyncChange;
  stored?: LocalEncryptedObject;
  pending?: OutboxEntry;
  decrypted?: VaultObject;
  conflict?: OpenDocument;
  committed?: boolean;
  recoverySource?: OutboxEntry;
}

/** Crypto and attachment copies run outside write lanes; only the guarded page commit holds them. */
export async function pullVaultChanges(dependencies: PullControllerDependencies): Promise<PullControllerResult> {
  const total = emptyResult();
  const { userId, isActive } = dependencies;
  const coordinate = dependencies.coordinate ?? (async <T,>(_id: string, operation: () => Promise<T>) => operation());
  if (!isActive()) return total;
  let cursor = dependencies.initialCursor ?? Number((await localDb.meta.get(cursorKey(userId)))?.value ?? 0);
  let hasMore = true;
  while (hasMore && isActive()) {
    const page = await (dependencies.fetchPage?.(cursor) ?? api<{ changes: SyncChange[]; cursor: number; hasMore: boolean; reset?: boolean }>(
      `/api/sync?since=${cursor}&limit=500&compact=1`
    ));
    if (!isActive()) return { ...total, complete: false };
    if (page.reset) throw new Error("SYNC_RECONCILE_REQUIRED");
    const result = emptyResult();
    const candidates: Candidate[] = [];
    const blocked = new Set<string>();
    for (const change of page.changes) {
      if (!isActive()) return total;
      if (change.historyVersion !== undefined) {
        await localDb.meta.put({ key: `history-invalid:${userId}:${change.objectId}`, value: String(change.historyVersion) });
        continue;
      }
      if (change.purged) await dependencies.recoverAuxiliary?.(change.objectId);
      const key = localKey(userId, change.objectId);
      if (change.purged && dependencies.hasPendingSave(change.objectId)) await dependencies.flushDocument(change.objectId);
      if (dependencies.hasPendingSave(change.objectId)) {
        blocked.add(change.objectId);
        continue;
      }
      let [stored, pending] = await localDb.transaction("r", localDb.objects, localDb.outbox, () => (
        Promise.all([localDb.objects.get(key), localDb.outbox.get(key)])
      ));
      if (change.serverTrashedAt !== undefined) {
        if (stored?.deleted === change.deleted) await localDb.objects.update(key, { serverTrashedAt: change.serverTrashedAt });
        dependencies.onServerTrashTime?.(change.objectId, change.deleted, change.serverTrashedAt);
      }
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
      let bodyBlocks: EncryptedNoteBodyBlock[] = [];
      if (!change.purged && shouldSynchronizeWorkspaceObject(change.objectId)) {
        try {
          bodyBlocks = await ensureBodyBlocks(userId, change, isActive);
          decrypted = normalizeVaultObject(await cryptoClient.decryptObject(
            userId, change.objectId, change.objectType, change.revision, change.ciphertext, change.nonce, { ...change, bodyBlocks }
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
      const candidate: Candidate = { change, stored, pending, decrypted, bodyBlocks };
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
        if (pending && change.revision <= pending.baseRevision && !(dependencies.reconcileSnapshot && change.revision < pending.baseRevision) && !dependencies.forceConflictIds?.has(change.objectId)
          && !operationExpired(pending.idempotencyKey) && !(pending.upload && operationExpired(pending.upload.idempotencyKey))) continue;
        if (!pending && stored && (stored.revision > change.revision || dependencies.recoverLocalTimeline)) {
          if (!dependencies.reconcileSnapshot) continue;
          candidate.recoverySource = { ...stored, operation: "upsert", baseRevision: Math.max(0, stored.revision - 1), idempotencyKey: operationId(), generation: Date.now() * 1000 };
        }
      }
      if (pending?.operation === "upsert" || candidate.recoverySource) {
        const conflict = await dependencies.preserveConflict(candidate.recoverySource ?? pending!);
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
        localDb.historySnapshots, localDb.historyIndex, localDb.historyOutbox, localDb.historyMetadataOutbox, localDb.meta, localDb.bodyBlocks
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
            await localDb.meta.bulkDelete([`history-invalid:${userId}:${change.objectId}`, `history-verified:${userId}:${change.objectId}`]);
            await localDb.objects.delete(key);
            await localDb.outbox.delete(key);
            await localDb.attachmentChunks.where("[userId+attachmentId]").equals([userId, change.objectId]).delete();
            await localDb.attachmentOutbox.where("[userId+attachmentId]").equals([userId, change.objectId]).delete();
            await localDb.historySnapshots.where("[userId+noteId]").equals([userId, change.objectId]).delete();
            await localDb.historyIndex.where("[userId+noteId]").equals([userId, change.objectId]).delete();
            await localDb.historyOutbox.where("[userId+noteId]").equals([userId, change.objectId]).delete();
            await localDb.historyMetadataOutbox.where("[userId+noteId]").equals([userId, change.objectId]).delete();
          } else {
            await persistBodyBlocks(userId, change.objectId, { ...change, bodyBlocks: candidate.bodyBlocks });
            for (const block of candidate.bodyBlocks ?? []) await localDb.bodyBlocks.update(localKey(userId, `${change.objectId}:${block.blockId}`), { uploaded: true });
            await localDb.objects.put({
              key, userId, objectId: change.objectId, objectType: change.objectType,
              ciphertext: change.ciphertext, nonce: change.nonce, encryptionVersion: change.encryptionVersion,
              revision: change.revision, deleted: change.deleted, updatedAt: change.serverUpdatedAt, serverTrashedAt: change.serverTrashedAt,
              ...(change.bodyBlockIds ? { bodyBlockIds: change.bodyBlockIds } : {}),
              ...(candidate.decrypted?.kind === "attachment" ? { ownerNoteId: candidate.decrypted.ownerNoteId } : {})
            });
            if (pending) await localDb.outbox.delete(key);
          }
          candidate.committed = true;
        }
        if (isActive() && !blocked.size && dependencies.commitCursor !== false) {
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
          const open = { ...decrypted, objectId: change.objectId, serverRevision: change.revision, serverTrashedAt: change.serverTrashedAt, dirty: false };
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
    if (blocked.size) { total.complete = false; break; }
    cursor = page.cursor;
    total.cursor = cursor;
    hasMore = page.hasMore;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  return total;
}
