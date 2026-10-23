import { localDb } from "./database";

export interface LocalStorageStatus { bytes: number; objects: number; attachments: number; history: number; }
export async function readPendingStorageStatus(userId: string) {
  const [objects, chunks, history, metadata] = await Promise.all([
    localDb.outbox.where("userId").equals(userId).primaryKeys(), localDb.attachmentOutbox.where("userId").equals(userId).primaryKeys(),
    localDb.historyOutbox.where("userId").equals(userId).primaryKeys(), localDb.historyMetadataOutbox.where("userId").equals(userId).primaryKeys()
  ]);
  return { objects: objects.length, attachments: new Set(chunks.map((key) => key.slice(0, key.lastIndexOf(":")))).size,
    history: new Set([...history, ...metadata]).size };
}
function payloadBytes(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  return Object.entries(value).reduce((sum, [key, item]) => sum + (
    item instanceof ArrayBuffer ? item.byteLength : typeof item === "string" && /ciphertext|nonce/i.test(key)
      ? new TextEncoder().encode(item).byteLength : key === "upload" ? payloadBytes(item) : 0), 0);
}
export async function readLocalStorageStatus(userId: string): Promise<LocalStorageStatus> {
  return localDb.transaction("r", [localDb.objects, localDb.outbox, localDb.attachmentChunks, localDb.attachmentOutbox,
    localDb.historySnapshots, localDb.historyIndex, localDb.historyOutbox, localDb.historyMetadataOutbox], async () => {
    const [objects, outbox, chunks, attachmentOutbox, snapshots, index, historyOutbox, metadataOutbox] = await Promise.all([
      localDb.objects, localDb.outbox, localDb.attachmentChunks, localDb.attachmentOutbox,
      localDb.historySnapshots, localDb.historyIndex, localDb.historyOutbox, localDb.historyMetadataOutbox
    ].map((table) => table.where("userId").equals(userId).toArray()));
    return { bytes: [...objects, ...outbox, ...chunks, ...attachmentOutbox, ...snapshots, ...index, ...historyOutbox, ...metadataOutbox].reduce((sum, value) => sum + payloadBytes(value), 0),
      objects: outbox.length,
      attachments: new Set(attachmentOutbox.map((row) => (row as { attachmentId: string }).attachmentId)).size,
      history: new Set([...historyOutbox, ...metadataOutbox].map((row) => (row as { noteId: string; historyId: string }).noteId + ":" + (row as { historyId: string }).historyId)).size };
  });
}
export const lastSyncKey = (userId: string, endpointId: string) => `storage-status:${userId}:last-sync:${endpointId}`;
export async function recordCompleteSync(userId: string, endpointId: string, complete: boolean, now = new Date().toISOString()) {
  if (complete) await localDb.meta.put({ key: lastSyncKey(userId, endpointId), value: now });
}
export type CapacityLevel = "unlimited" | "normal" | "warning" | "critical" | "full";
export function capacityLevel(used: number, limit: number | null): CapacityLevel {
  return limit === null ? "unlimited" : used >= limit ? "full" : used >= limit * .95 ? "critical" : used >= limit * .8 ? "warning" : "normal";
}
export async function claimCapacityNotice(userId: string, level: CapacityLevel, now = Date.now()) {
  const key = `storage-status:${userId}:notice`;
  return localDb.transaction("rw", localDb.meta, async () => {
    const previous = JSON.parse((await localDb.meta.get(key))?.value ?? "{}") as { level?: CapacityLevel; notices?: Record<string, number> };
    const eligible = !["normal", "unlimited"].includes(level) && previous.level !== level
      && now - (previous.notices?.[level] ?? 0) >= 86_400_000;
    const notices = { ...previous.notices, ...(eligible ? { [level]: now } : {}) };
    await localDb.meta.put({ key, value: JSON.stringify({ level, notices }) });
    return eligible;
  });
}
