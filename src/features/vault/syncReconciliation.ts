import { operationExpired } from "@mint-notes/application-client";
import { cursorKey, localDb, localKey } from "../../storage/database";
import type { SyncChange } from "../../types";
import { pullVaultChanges, SyncCursorResetRequired, type PullControllerDependencies } from "./pullController";

interface SyncStatus {
  epoch: string;
  head: number;
  floor: number;
  reconcile: boolean;
  lease: string;
  bodyChunkingEnabled?: boolean;
  noteCatalogEnabled?: boolean;
}

export async function readSyncEpoch(userId: string): Promise<string | undefined> {
  const stored = await localDb.meta.get(`sync-state:${userId}`);
  return stored ? (JSON.parse(stored.value) as { epoch: string }).epoch : undefined;
}

export async function prepareVaultSynchronization(dependencies: PullControllerDependencies) {
  const api = dependencies.services.transport.api;
  const { userId, isActive } = dependencies;
  const previousEpoch = await readSyncEpoch(userId);
  const cursor = Number((await localDb.meta.get(cursorKey(userId)))?.value ?? 0);
  const previousLease = (await localDb.meta.get(`sync-lease:${userId}`))?.value ?? "";
  const previousCatalog = (await localDb.meta.get(`note-catalog:${userId}`))?.value === "true";
  if (!isActive()) return false;
  dependencies.services.transport.setSyncLease(previousLease);
  const status = await api<SyncStatus>(`/api/sync/status?since=${cursor}&epoch=${encodeURIComponent(previousEpoch ?? "")}`);
  if (!isActive()) return false;
  if (!status.epoch || !Number.isSafeInteger(status.head) || !Number.isSafeInteger(status.floor) || status.floor > status.head) throw new SyncCursorResetRequired();
  const catalog = status.noteCatalogEnabled === true;
  const view = catalog ? "&view=catalog" : "";
  const epoch = encodeURIComponent(status.epoch);
  const pull = { ...dependencies, epoch: status.epoch, catalog, commitCursor: false };
  await localDb.meta.put({ key: `body-chunking:${userId}`, value: String(status.bodyChunkingEnabled !== false) });
  const pending = await localDb.outbox.where("userId").equals(userId).toArray();
  const chunks = await localDb.attachmentOutbox.where("userId").equals(userId).toArray();
  const histories = await localDb.historyOutbox.where("userId").equals(userId).toArray();
  const metadata = await localDb.historyMetadataOutbox.where("userId").equals(userId).toArray();
  const forceConflictIds = new Set(chunks.filter((entry) => operationExpired(entry.idempotencyKey)).map((entry) => entry.ownerNoteId).filter((id): id is string => Boolean(id)));
  const epochChanged = Boolean(previousEpoch && previousEpoch !== status.epoch);
  if (epochChanged) for (const entry of pending) forceConflictIds.add(entry.objectId);
  const expired = forceConflictIds.size || histories.some((entry) => operationExpired(entry.idempotencyKey)) || pending.some((entry) => operationExpired(entry.idempotencyKey) || (entry.upload && operationExpired(entry.upload.idempotencyKey)));
  let head = cursor;

  if (!previousEpoch || status.reconcile || epochChanged || expired || (previousCatalog && !catalog)) {
    const noteIds = new Set([
      ...histories.filter((entry) => epochChanged || operationExpired(entry.idempotencyKey)).map((entry) => entry.noteId),
      ...(epochChanged ? metadata.map((entry) => entry.noteId) : [])
    ]);
    const attachmentIds = new Set([
      ...chunks.filter((entry) => epochChanged || operationExpired(entry.idempotencyKey)).map((entry) => entry.attachmentId),
      ...pending.filter((entry) => entry.objectType === "attachment" && (epochChanged || operationExpired(entry.idempotencyKey))).map((entry) => entry.objectId)
    ]);
    for (const noteId of noteIds) {
      if (!isActive() || !await dependencies.recoverAuxiliary?.(noteId, !epochChanged)) return false;
    }
    for (const attachmentId of attachmentIds) {
      if (!isActive() || !await dependencies.recoverAuxiliary?.(attachmentId)) return false;
    }

    const seen = new Set<string>();
    const staged = localDb.syncStaging.where("userId").equals(userId);
    let after: string | null = null;
    const fetchSnapshot = async () => {
      const page = await api<{ epoch: string; objects: SyncChange[]; next: string | null }>(`/api/sync/snapshot?epoch=${epoch}${after ? `&after=${encodeURIComponent(after)}` : ""}${view}`);
      if (page.epoch !== status.epoch || (page.next !== null && (page.next <= (after ?? "") || page.next !== page.objects.at(-1)?.objectId))) throw new SyncCursorResetRequired();
      for (const object of page.objects) seen.add(object.objectId);
      after = page.next;
      return { changes: page.objects, cursor: status.head, hasMore: Boolean(after) };
    };
    const fetchChanges = async (since: number) => {
      const page = await api<{ changes: SyncChange[]; cursor: number; hasMore: boolean; reset?: boolean; epoch: string }>(`/api/sync?since=${since}&epoch=${epoch}&limit=500${view}`);
      if (page.epoch !== status.epoch || page.reset || !Number.isSafeInteger(page.cursor) || page.cursor < since || (page.hasMore && page.cursor <= since)
        || page.changes.some((entry, index) => !Number.isSafeInteger(entry.sequence) || entry.sequence <= (index ? page.changes[index - 1].sequence : since) || entry.sequence > page.cursor)) {
        throw new SyncCursorResetRequired();
      }
      for (const object of page.changes) {
        if (object.historyVersion !== undefined) continue;
        if (object.purged) seen.delete(object.objectId);
        else seen.add(object.objectId);
      }
      return page;
    };
    const storePage = (changes: SyncChange[]) => localDb.syncStaging.bulkPut(changes.map((change) => ({
      key: localKey(userId, change.historyVersion === undefined ? change.objectId : `history:${change.objectId}`), userId, change
    })));

    if (epochChanged) {
      await staged.delete();
      do {
        const page = await fetchSnapshot();
        if (!isActive()) return false;
        await storePage(page.changes);
      } while (after);
      head = status.head;
      let more: boolean;
      do {
        const page = await fetchChanges(head);
        if (!isActive()) return false;
        await storePage(page.changes);
        head = page.cursor;
        more = page.hasMore;
      } while (more);
      await localDb.bodyBlocks.where("userId").equals(userId).modify({ uploaded: false });
    } else {
      const scan = await pullVaultChanges({ ...pull, forceConflictIds, reconcileSnapshot: true, initialCursor: 0, fetchPage: fetchSnapshot });
      if (!isActive() || !scan.complete || scan.failedObjectIds.size) return false;
      const catchup = await pullVaultChanges({ ...pull, initialCursor: status.head, fetchPage: fetchChanges });
      if (!isActive() || !catchup.complete || catchup.failedObjectIds.size) return false;
      head = catchup.cursor;
    }

    const local = await localDb.objects.where("userId").equals(userId).toArray();
    const catalogRows = await localDb.noteCatalog.where("userId").equals(userId).toArray();
    const localById = new Map([...catalogRows, ...local].map((object) => [object.objectId, object]));
    const missing: SyncChange[] = [];
    for (const object of localById.values()) {
      if (seen.has(object.objectId)) continue;
      const outbox = await localDb.outbox.get(localKey(userId, object.objectId));
      if (outbox?.baseRevision === 0 && !forceConflictIds.has(object.objectId) && !operationExpired(outbox.idempotencyKey) && !(outbox.upload && operationExpired(outbox.upload.idempotencyKey))) continue;
      missing.push({ ...object, sequence: head, serverUpdatedAt: new Date().toISOString(), purged: true });
    }
    missing.sort((a, b) => Number(a.objectType === "attachment") - Number(b.objectType === "attachment"));
    const reconcile = { ...pull, forceConflictIds, recoverLocalTimeline: epochChanged, reconcileSnapshot: true, initialCursor: head };
    const apply = async (changes: SyncChange[]) => {
      const result = await pullVaultChanges({ ...reconcile, fetchPage: async () => ({ changes, cursor: head, hasMore: false }) });
      return isActive() && result.complete && !result.failedObjectIds.size;
    };
    for (let offset = 0; offset < missing.length; offset += 100) {
      if (!await apply(missing.slice(offset, offset + 100))) return false;
    }
    if (epochChanged) {
      // Apply notes before attachments so recovery can still snapshot the old graph.
      const keys = await staged.primaryKeys();
      const otherKeys: string[] = [];
      for (let offset = 0; offset < keys.length; offset += 100) {
        const rows = await localDb.syncStaging.bulkGet(keys.slice(offset, offset + 100));
        const changes: SyncChange[] = [];
        for (const row of rows) {
          if (!row || row.change.purged) continue;
          if (row.change.objectType === "attachment" || row.change.historyVersion !== undefined) otherKeys.push(row.key);
          else changes.push(row.change);
        }
        if (!await apply(changes)) return false;
      }
      for (let offset = 0; offset < otherKeys.length; offset += 100) {
        const rows = await localDb.syncStaging.bulkGet(otherKeys.slice(offset, offset + 100));
        if (!await apply(rows.flatMap((row) => row ? [row.change] : []))) return false;
      }
    }
  }

  if (!isActive()) return false;
  await localDb.transaction("rw", localDb.meta, localDb.syncStaging, async () => {
    if (!isActive()) return;
    await localDb.meta.put({ key: cursorKey(userId), value: String(head) });
    await localDb.meta.put({ key: `sync-state:${userId}`, value: JSON.stringify({ epoch: status.epoch }) });
    await localDb.meta.put({ key: `sync-lease:${userId}`, value: status.lease });
    await localDb.meta.put({ key: `note-catalog:${userId}`, value: String(catalog) });
    await localDb.syncStaging.where("userId").equals(userId).delete();
  });
  if (!isActive()) return false;
  dependencies.services.transport.setSyncLease(status.lease);
  return true;
}
