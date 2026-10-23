import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { localDb, historyKey, localKey } from "./database";
import { evictDownloadableCaches, pinCache } from "./cache";
import { operationId } from "@mint-notes/application-client";

afterEach(async () => { for (const table of localDb.tables) await table.clear(); });
async function attachment(id: string, touchedAt: number, ownerNoteId = "note") {
  await localDb.objects.put({ key: localKey("u", id), userId: "u", objectId: id, objectType: "attachment", ciphertext: "cipher", nonce: "nonce", encryptionVersion: 1, revision: 1, deleted: false, updatedAt: "2026-01-01", ownerNoteId });
  await localDb.attachmentChunks.put({ key: id, userId: "u", attachmentId: id, ownerNoteId, chunkIndex: 0, totalChunks: 1, ciphertext: new ArrayBuffer(10), nonce: "nn", encryptionVersion: 1, updatedAt: "2026-01-01", touchedAt });
}
describe("downloadable encrypted caches", () => {
  it("evicts the oldest synced attachment but protects pinned and pending graphs", async () => {
    await attachment("old", 1); await attachment("recent", 5); await attachment("pending", 2, "pending-note"); await attachment("pinned", 0);
    const object = (await localDb.objects.get(localKey("u", "pending")))!;
    await localDb.outbox.put({ ...object, operation: "upsert", baseRevision: 0, idempotencyKey: operationId(), generation: 1 });
    const release = pinCache("u", "attachment", ["pinned"]);
    try {
      expect(await evictDownloadableCaches("u", 36, 100)).toBe(12);
      expect((await localDb.attachmentChunks.toArray()).map(r => r.attachmentId).sort()).toEqual(["pending", "pinned", "recent"]);
      expect(await localDb.objects.count()).toBe(4);
    } finally { release(); }
  });
  it("retains directories and unique pending history when evicting synced bodies", async () => {
    for (const [id, pending] of [["old", false], ["pending", true]] as const) {
      const item = { key: historyKey("u", "note", id), userId: "u", noteId: "note", historyId: id, capturedAt: "2026-01-01", captureKind: "manual" as const, protected: true, byteSize: 100, pending };
      await localDb.historyIndex.put(item);
      await localDb.historySnapshots.put({ ...item, ciphertext: "cipher", nonce: "nonce", encryptionVersion: 1 });
    }
    await evictDownloadableCaches("u", 0, 100);
    expect((await localDb.historySnapshots.toArray()).map(r => r.historyId)).toEqual(["pending"]);
    expect(await localDb.historyIndex.count()).toBe(2);
  });
  it("keeps all attachments of a note with an unsynced history", async () => {
    await attachment("image", 1);
    await localDb.historyOutbox.put({ key: "h", userId: "u", noteId: "note", historyId: "h", capturedAt: "2026-01-01", captureKind: "interval", protected: false, byteSize: 100, pending: true,
      ciphertext: "cipher", nonce: "nonce", encryptionVersion: 1, idempotencyKey: operationId(), generation: 1 });
    expect(await evictDownloadableCaches("u", 0, 0)).toBe(0);
    expect(await localDb.attachmentChunks.count()).toBe(1);
  });
});
