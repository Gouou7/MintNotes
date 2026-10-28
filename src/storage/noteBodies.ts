import type { EncryptedObject, EncryptedNoteBodyBlock, EncryptedObjectEncoding } from "@mint-notes/application-client";
import { localDb, localKey, type LocalBodyBlock } from "./database";
import { api } from "../api";

export async function bodyBlocksFor(userId: string, noteId: string, ids?: readonly string[]): Promise<LocalBodyBlock[]> {
  if (ids) return (await localDb.bodyBlocks.bulkGet([...new Set(ids)].map((id) => localKey(userId, `${noteId}:${id}`))))
    .filter((block): block is LocalBodyBlock => Boolean(block));
  return localDb.bodyBlocks.where("[userId+noteId]").equals([userId, noteId]).toArray();
}
/** Compose with the caller's object/outbox transaction. Never overwrite an immutable block. */
export async function persistBodyBlocks(userId: string, noteId: string, encoding: EncryptedObjectEncoding) {
  for (const block of encoding.bodyBlocks ?? []) {
    const key = localKey(userId, `${noteId}:${block.blockId}`);
    const old = await localDb.bodyBlocks.get(key);
    if (old && (old.ciphertext !== block.ciphertext || old.nonce !== block.nonce)) throw new Error("Immutable body block mismatch");
    if (!old) await localDb.bodyBlocks.add({ ...block, key, userId, noteId });
  }
}
export async function ensureBodyBlocks(userId: string, object: EncryptedObject, active: () => boolean): Promise<EncryptedNoteBodyBlock[]> {
  if (object.encryptionVersion !== 2) return [];
  const fetched: EncryptedNoteBodyBlock[] = [];
  const ids = object.bodyBlockIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || new Set(ids).size !== ids.length) throw new Error("Invalid body references");
  const cached = new Map((await bodyBlocksFor(userId, object.objectId, ids)).map((block) => [block.blockId, block]));
  const missing = ids.filter((id) => !cached.has(id));
  for (let offset = 0; offset < missing.length; offset += 16) {
    if (!active()) throw new DOMException("Inactive vault", "AbortError");
    const wanted = missing.slice(offset, offset + 16);
    const response = await api<{ blocks: EncryptedNoteBodyBlock[] }>(`/api/notes/${object.objectId}/body-blocks/read`,
      { method: "POST", body: JSON.stringify({ blockIds: wanted }) });
    if (!active()) throw new DOMException("Inactive vault", "AbortError");
    if (!Array.isArray(response.blocks) || response.blocks.length !== wanted.length
      || response.blocks.some((block, index) => block.blockId !== wanted[index])) throw new Error("Invalid body block response");
    // Only the caller's authenticated page commit may publish downloaded bytes.
    fetched.push(...response.blocks);
  }
  return fetched;
}
export async function uploadBodyBlocks(userId: string, object: EncryptedObject, active: () => boolean) {
  if (object.encryptionVersion !== 2) return;
  const cached = new Map((await bodyBlocksFor(userId, object.objectId, object.bodyBlockIds)).map((block) => [block.blockId, block]));
  const pending = (object.bodyBlockIds ?? []).map((id) => {
    const block = cached.get(id);
    if (!block) throw new Error("Pending body block is missing");
    return block;
  }).filter((block) => !block.uploaded);
  for (let offset = 0; offset < pending.length; offset += 16) {
    if (!active()) return;
    const batch = pending.slice(offset, offset + 16);
    const response = await api<{ accepted: string[] }>(`/api/notes/${object.objectId}/body-blocks/batch`, { method: "POST",
      body: JSON.stringify({ blocks: batch.map(({ blockId, ciphertext, nonce }) => ({ blockId, ciphertext, nonce })) }) });
    if (!Array.isArray(response.accepted) || JSON.stringify(response.accepted) !== JSON.stringify(batch.map((block) => block.blockId)))
      throw new Error("Invalid body block acknowledgement");
    if (!active()) return;
    await localDb.transaction("rw", localDb.bodyBlocks, async () => {
      for (const block of batch) await localDb.bodyBlocks.update(block.key, { uploaded: true });
    });
  }
}
