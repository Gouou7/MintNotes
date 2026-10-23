import { api, setSyncLease } from "../../api";
import { operationExpired } from "@mint-notes/application-client";
import { cursorKey, localDb, localKey } from "../../storage/database";
import type { SyncChange } from "../../types";
import { pullVaultChanges, type PullControllerDependencies } from "./pullController";

interface SyncStatus { epoch: string; head: number; floor: number; reconcile: boolean; lease: string; }
export async function prepareVaultSynchronization(dependencies: PullControllerDependencies) {
  const { userId, isActive } = dependencies;
  const stored = await localDb.meta.get(`sync-state:${userId}`);
  const state = stored ? JSON.parse(stored.value) as { epoch: string } : null;
  const cursor = Number((await localDb.meta.get(cursorKey(userId)))?.value ?? 0);
  const previousLease = (await localDb.meta.get(`sync-lease:${userId}`))?.value ?? "";
  if (!isActive()) return false;
  setSyncLease(previousLease);
  const status = await api<SyncStatus>(`/api/sync/status?since=${cursor}&epoch=${encodeURIComponent(state?.epoch ?? "")}`);
  if (!isActive()) return false;
  const pending = await localDb.outbox.where("userId").equals(userId).toArray();
  const chunks = await localDb.attachmentOutbox.where("userId").equals(userId).toArray();
  const histories = await localDb.historyOutbox.where("userId").equals(userId).toArray();
  const forceConflictIds = new Set(chunks.filter((entry) => operationExpired(entry.idempotencyKey)).map((entry) => entry.ownerNoteId).filter((id): id is string => Boolean(id)));
  const epochChanged = Boolean(state?.epoch && state.epoch !== status.epoch);
  if (epochChanged) for (const entry of pending) forceConflictIds.add(entry.objectId);
  const expired = forceConflictIds.size || histories.some((entry) => operationExpired(entry.idempotencyKey)) || pending.some((entry) => operationExpired(entry.idempotencyKey) || (entry.upload && operationExpired(entry.upload.idempotencyKey)));
  if (status.reconcile || expired) {
    const expiredAttachmentIds = new Set([
      ...chunks.filter((entry) => operationExpired(entry.idempotencyKey)).map((entry) => entry.attachmentId),
      ...pending.filter((entry) => entry.objectType === "attachment" && operationExpired(entry.idempotencyKey)).map((entry) => entry.objectId)
    ]);
    for (const attachmentId of expiredAttachmentIds) {
      if (!isActive() || !await dependencies.recoverAuxiliary?.(attachmentId)) return false;
    }
    for (const noteId of new Set(histories.filter((entry) => operationExpired(entry.idempotencyKey)).map((entry) => entry.noteId))) {
      if (!isActive() || !await dependencies.recoverAuxiliary?.(noteId, true)) return false;
    }
    const seen = new Set<string>();
    let after: string | null = null;
    const scan = await pullVaultChanges({ ...dependencies, forceConflictIds, reconcileSnapshot: true, recoverLocalTimeline: epochChanged, initialCursor: 0, commitCursor: false,
      fetchPage: async () => {
        const page = await api<{ epoch: string; objects: SyncChange[]; next: string | null }>(`/api/sync/snapshot?epoch=${encodeURIComponent(status.epoch)}${after ? `&after=${after}` : ""}`);
        if (page.epoch !== status.epoch) throw new Error("SYNC_RECONCILE_REQUIRED");
        for (const object of page.objects) seen.add(object.objectId);
        after = page.next;
        return { changes: page.objects, cursor: status.head, hasMore: Boolean(after) };
      }
    });
    if (!isActive() || !scan.complete || scan.failedObjectIds.size) return false;
    // Writes during the current-state scan are replayed from H. Never pin a server read transaction.
    const catchup = await pullVaultChanges({ ...dependencies, initialCursor: status.head, commitCursor: false,
      fetchPage: async (since) => {
        const page = await api<{ changes: SyncChange[]; cursor: number; hasMore: boolean; reset?: boolean; epoch: string }>(`/api/sync?since=${since}&epoch=${encodeURIComponent(status.epoch)}&limit=500`);
        if (page.epoch !== status.epoch) throw new Error("SYNC_RECONCILE_REQUIRED");
        for (const object of page.changes) if (!object.purged && object.historyVersion === undefined) seen.add(object.objectId);
        return page;
      }
    });
    if (!isActive() || !catchup.complete || catchup.failedObjectIds.size) return false;
    const local = await localDb.objects.where("userId").equals(userId).toArray();
    const missing: SyncChange[] = [];
    for (const object of local) {
      if (seen.has(object.objectId)) continue;
      const outbox = await localDb.outbox.get(localKey(userId, object.objectId));
      // A newly authored, live request has never been on the server.
      if (outbox?.baseRevision === 0 && !forceConflictIds.has(object.objectId) && !operationExpired(outbox.idempotencyKey) && !(outbox.upload && operationExpired(outbox.upload.idempotencyKey))) continue;
      missing.push({ ...object, sequence: catchup.cursor, serverUpdatedAt: new Date().toISOString(), purged: true });
    }
    missing.sort((a, b) => Number(a.objectType === "attachment") - Number(b.objectType === "attachment"));
    const removed = await pullVaultChanges({ ...dependencies, forceConflictIds, commitCursor: false, initialCursor: catchup.cursor,
      fetchPage: async () => ({ changes: missing, cursor: catchup.cursor, hasMore: false }) });
    if (!isActive() || !removed.complete) return false;
    await localDb.transaction("rw", localDb.meta, async () => {
      if (!isActive()) return;
      await localDb.meta.put({ key: cursorKey(userId), value: String(catchup.cursor) });
      await localDb.meta.put({ key: `sync-state:${userId}`, value: JSON.stringify({ epoch: status.epoch }) });
      await localDb.meta.put({ key: `sync-lease:${userId}`, value: status.lease });
    });
  } else await localDb.meta.put({ key: `sync-lease:${userId}`, value: status.lease });
  if (!isActive()) return false;
  setSyncLease(status.lease);
  return true;
}
