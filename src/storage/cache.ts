import { localDb } from "./database";

const pins = new Map<string, number>();
export function pinCache(userId: string, kind: "attachment" | "history", ids: readonly string[]) {
  const keys = ids.map((id) => `${kind}:${userId}:${id}`);
  for (const key of keys) pins.set(key, (pins.get(key) ?? 0) + 1);
  return () => { for (const key of keys) { const count = (pins.get(key) ?? 1) - 1; if (count) pins.set(key, count); else pins.delete(key); } };
}
/** Unique local data and every pending graph are excluded, even above the cache budget. */
export async function evictDownloadableCaches(userId: string, attachmentLimit = 128 * 1024 * 1024, historyLimit = 64 * 1024 * 1024) {
  return localDb.transaction("rw", [localDb.objects, localDb.outbox, localDb.attachmentOutbox, localDb.attachmentChunks,
    localDb.historyOutbox, localDb.historyMetadataOutbox, localDb.historySnapshots, localDb.recoveries], async () => {
    const [outbox, chunkOutbox, historyOutbox, metadataOutbox, objects, chunks, histories] = await Promise.all([
      localDb.outbox.where("userId").equals(userId).toArray(), localDb.attachmentOutbox.where("userId").equals(userId).toArray(),
      localDb.historyOutbox.where("userId").equals(userId).toArray(), localDb.historyMetadataOutbox.where("userId").equals(userId).toArray(),
      localDb.objects.where("userId").equals(userId).toArray(), localDb.attachmentChunks.where("userId").equals(userId).toArray(),
      localDb.historySnapshots.where("userId").equals(userId).toArray()
    ]);
    const pendingNotes = new Set([...outbox.map((r) => r.objectId), ...historyOutbox.map((r) => r.noteId), ...metadataOutbox.map((r) => r.noteId)]);
    const pendingAttachments = new Set([...outbox.filter((r) => r.objectType === "attachment").map((r) => r.objectId), ...chunkOutbox.map((r) => r.attachmentId)]);
    for (const recovery of await localDb.recoveries.where("userId").equals(userId).toArray()) {
      pendingNotes.add(recovery.sourceId); pendingNotes.add(recovery.copyId);
      for (const attachment of recovery.attachments) pendingAttachments.add(attachment.objectId);
    }
    const byObject = new Map(objects.map((r) => [r.objectId, r]));
    const groups = new Map<string, { size: number; touched: number; keys: string[]; owner?: string }>();
    for (const chunk of chunks) {
      const group = groups.get(chunk.attachmentId) ?? { size: 0, touched: 0, keys: [], owner: chunk.ownerNoteId ?? byObject.get(chunk.attachmentId)?.ownerNoteId };
      group.size += chunk.ciphertext.byteLength + chunk.nonce.length;
      group.touched = Math.max(group.touched, chunk.touchedAt ?? Date.parse(chunk.updatedAt));
      group.keys.push(chunk.key); groups.set(chunk.attachmentId, group);
    }
    let size = [...groups.values()].reduce((sum, r) => sum + r.size, 0);
    let removed = 0;
    for (const [id, group] of [...groups].sort((a, b) => a[1].touched - b[1].touched)) {
      if (size <= attachmentLimit) break;
      // Unknown ownership is legacy/unique data until an unlocked client verifies it.
      if (!group.owner || !byObject.has(id) || pendingAttachments.has(id) || pendingNotes.has(group.owner) || pins.has(`attachment:${userId}:${id}`)) continue;
      await localDb.attachmentChunks.bulkDelete(group.keys); size -= group.size; removed += group.size;
    }
    size = histories.reduce((sum, r) => sum + r.byteSize, 0);
    const pendingHistory = new Set([...historyOutbox.map((r) => r.key), ...metadataOutbox.map((r) => r.key)]);
    for (const item of histories.sort((a, b) => (a.touchedAt ?? Date.parse(a.capturedAt)) - (b.touchedAt ?? Date.parse(b.capturedAt)))) {
      if (size <= historyLimit) break;
      if (item.pending || pendingHistory.has(item.key) || pendingNotes.has(item.noteId) || pins.has(`history:${userId}:${item.historyId}`)) continue;
      await localDb.historySnapshots.delete(item.key); size -= item.byteSize; removed += item.byteSize;
    }
    return removed;
  });
}
export async function persistWithCacheRecovery<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (!(error instanceof Error) || !["QuotaExceededError", "BulkError"].includes(error.name)) throw error;
    if (!await evictDownloadableCaches(userId, 0, 0)) throw error;
    return operation();
  }
}
