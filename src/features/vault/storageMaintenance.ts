import { api } from "../../api";
import { cryptoClient } from "../../crypto/client";
import { cursorKey, historyKey, localDb } from "../../storage/database";
import { hasPendingLocalObjectGraph } from "./localPurge";
import { evictDownloadableCaches } from "../../storage/cache";
import type { EncryptedHistorySnapshot, OpenAttachment, OpenDocument } from "../../types";
import { attachmentIdsIn } from "../attachments";
import type { HistoryIndexEnvelope } from "./historyController";

/** No deletion is based on a partial or unauthenticated historical directory. */
export async function validatedHistoryInventory(userId: string, noteId: string, isActive: () => boolean) {
  const items: HistoryIndexEnvelope[] = [];
  const references = new Set<string>();
  let cursor: string | null = null;
  let version: number | null = null;
  do {
    const page: { items: HistoryIndexEnvelope[]; nextCursor: string | null; version: number } = await api(`/api/notes/${noteId}/history?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!isActive()) throw new DOMException("Cancelled", "AbortError");
    if (!Number.isSafeInteger(page.version) || (version !== null && version !== page.version)) throw new Error("History directory changed; retry");
    version = page.version;
    for (const item of page.items) {
      if (item.noteId !== noteId || items.some((r) => r.historyId === item.historyId)) throw new Error("Invalid history directory");
      if (item.metadataCiphertext && item.metadataNonce && item.metadataEncryptionVersion === 1) {
        const metadata = await cryptoClient.decryptHistoryMetadata(userId, noteId, item.historyId, item.capturedAt, item.metadataCiphertext, item.metadataNonce);
        for (const id of metadata.attachmentIds) references.add(id);
      } else {
        const body = await api<EncryptedHistorySnapshot>(`/api/notes/${noteId}/history/${item.historyId}`);
        const payload = await cryptoClient.decryptHistory(userId, noteId, item.historyId, body.capturedAt, body.captureKind, body.ciphertext, body.nonce);
        for (const id of attachmentIdsIn(payload.markdown)) references.add(id);
      }
      items.push(item);
    }
    if (page.nextCursor && page.nextCursor === cursor) throw new Error("Invalid history pagination");
    cursor = page.nextCursor;
  } while (cursor);
  if (!isActive()) throw new DOMException("Cancelled", "AbortError");
  const keys = new Set(items.map((r) => historyKey(userId, noteId, r.historyId)));
  await localDb.transaction("rw", [localDb.historyIndex, localDb.historySnapshots, localDb.historyOutbox, localDb.historyMetadataOutbox, localDb.meta], async () => {
    const [indexes, bodies, pending, metadata] = await Promise.all([
      localDb.historyIndex.where("[userId+noteId]").equals([userId, noteId]).toArray(), localDb.historySnapshots.where("[userId+noteId]").equals([userId, noteId]).toArray(),
      localDb.historyOutbox.where("[userId+noteId]").equals([userId, noteId]).toArray(), localDb.historyMetadataOutbox.where("[userId+noteId]").equals([userId, noteId]).toArray()
    ]);
    const pendingKeys = new Set([...pending.map((r) => r.key), ...metadata.map((r) => r.key)]);
    for (const entry of [...indexes, ...bodies]) if (!keys.has(entry.key) && !pendingKeys.has(entry.key) && !entry.pending) {
      await localDb.historyIndex.delete(entry.key); await localDb.historySnapshots.delete(entry.key);
    }
    for (const item of items) {
      const key = historyKey(userId, noteId, item.historyId);
      if (!pendingKeys.has(key)) await localDb.historyIndex.put({ ...item, key, userId, pending: false });
    }
    await localDb.meta.put({ key: `history-verified:${userId}:${noteId}`, value: String(version) });
  });
  return { references, version: version ?? 0 };
}

export async function maintainVaultStorage(options: { userId: string; isActive: () => boolean; documents: OpenDocument[]; attachments: OpenAttachment[]; trashOrphan?: (attachment: OpenAttachment) => Promise<unknown>; getDocument?: (id: string) => OpenDocument | undefined; hasPendingSave?: (id: string) => boolean }) {
  const { userId, isActive, documents, attachments } = options;
  if (!isActive()) return;
  let ownership = await api<{ complete: number; version: number; notes: Array<{ noteId: string; version: number }> }>("/api/attachments/ownership");
  if (!ownership.complete) {
    const state = JSON.parse((await localDb.meta.get(`sync-state:${userId}`))?.value ?? "null") as { epoch: string } | null;
    if (!state || attachments.some((r) => r.dirty)) return;
    const head = Number((await localDb.meta.get(cursorKey(userId)))?.value ?? 0);
    const mappings = attachments.map((r) => ({ attachmentId: r.objectId, ownerNoteId: r.ownerNoteId, revision: r.serverRevision }));
    for (let i = 0; i < mappings.length; i += 500) {
      if (!isActive()) return;
      await api("/api/attachments/ownership", { method: "POST", body: JSON.stringify({ ...state, head, mappings: mappings.slice(i, i + 500) }) });
    }
    await api("/api/attachments/ownership", { method: "POST", body: JSON.stringify({ ...state, head, mappings: [], complete: true }) });
    ownership = await api("/api/attachments/ownership");
  }
  for (const attachment of attachments) {
    if (!isActive()) return;
    if (!attachment.dirty && !attachment.deleted && !documents.some((note) => note.objectId === attachment.ownerNoteId)) {
      await options.trashOrphan?.({ ...attachment, deleted: true, dirty: true });
    }
  }
  const pendingNotes = new Set([
    ...(await localDb.outbox.where("userId").equals(userId).toArray()).map((r) => r.ownerNoteId ?? r.objectId),
    ...(await localDb.historyOutbox.where("userId").equals(userId).toArray()).map((r) => r.noteId),
    ...(await localDb.historyMetadataOutbox.where("userId").equals(userId).toArray()).map((r) => r.noteId),
    ...(await localDb.attachmentOutbox.where("userId").equals(userId).toArray()).map((r) => r.ownerNoteId ?? "")
  ]);
  const lastGc = Number((await localDb.meta.get(`attachment-gc:${userId}`))?.value ?? 0);
  const collect = Date.now() - lastGc >= 86_400_000;
  for (const note of documents) {
    if (!isActive()) return;
    if (note.kind !== "note" || note.dirty || note.deleted || pendingNotes.has(note.objectId)) continue;
    const [invalid, verified] = await Promise.all([
      localDb.meta.get(`history-invalid:${userId}:${note.objectId}`), localDb.meta.get(`history-verified:${userId}:${note.objectId}`)
    ]);
    if (!collect && invalid?.value === verified?.value) continue;
    const inventory = await validatedHistoryInventory(userId, note.objectId, isActive);
    const current = options.getDocument?.(note.objectId) ?? note;
    if (current.dirty || current.deleted || current.serverRevision !== note.serverRevision || options.hasPendingSave?.(note.objectId)
      || await hasPendingLocalObjectGraph(userId, new Set([note.objectId]))) continue;
    if (!collect || !ownership.complete || ownership.version < 1) continue;
    const retained = new Set([...attachmentIdsIn(note.markdown), ...inventory.references]);
    const candidates = attachments.filter((r) => r.ownerNoteId === note.objectId && !r.dirty && !retained.has(r.objectId)).map((r) => r.objectId);
    for (let i = 0; i < candidates.length; i += 500) {
      if (!isActive()) return;
      await api("/api/attachments/reclaim", { method: "POST", body: JSON.stringify({ noteId: note.objectId, noteRevision: note.serverRevision,
        historyVersion: inventory.version, ownershipVersion: ownership.notes.find((r) => r.noteId === note.objectId)?.version ?? 0, attachmentIds: candidates.slice(i, i + 500), confirm: true }) });
    }
  }
  if (collect && isActive()) await localDb.meta.put({ key: `attachment-gc:${userId}`, value: String(Date.now()) });
  if (isActive()) await evictDownloadableCaches(userId);
}
