import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { localDb } from "./database";
import { capacityLevel, claimCapacityNotice, lastSyncKey, readLocalStorageStatus, recordCompleteSync } from "./storageStatus";
afterEach(async () => { await Promise.all(localDb.tables.map((table) => table.clear())); });
describe("local storage status", () => {
  it("isolates users and groups pending attachment chunks and history metadata", async () => {
    const row = { userId: "one", objectId: "note", objectType: "note" as const, ciphertext: "encrypted", nonce: "nonce", encryptionVersion: 1, revision: 1, deleted: false, updatedAt: "now" };
    await localDb.objects.bulkPut([{ ...row, key: "one:note" }, { ...row, key: "two:note", userId: "two" }]);
    await localDb.outbox.put({ ...row, key: "one:note", operation: "upsert", baseRevision: 0, idempotencyKey: "op", generation: 1 });
    const chunk = { userId: "one", attachmentId: "asset", totalChunks: 2, ciphertext: new ArrayBuffer(10), nonce: "nonce", encryptionVersion: 1, updatedAt: "now", idempotencyKey: "op", generation: 1 };
    await localDb.attachmentOutbox.bulkPut([{ ...chunk, key: "c0", chunkIndex: 0 }, { ...chunk, key: "c1", chunkIndex: 1 }]);
    const snapshot = { key: "history", userId: "one", noteId: "note", historyId: "h", capturedAt: "now", captureKind: "manual" as const, ciphertext: "body", nonce: "nonce", encryptionVersion: 1 as const, protected: true, byteSize: 9, pending: true, idempotencyKey: "op", generation: 1 };
    await localDb.historyOutbox.put(snapshot);
    await localDb.historyMetadataOutbox.put({ key: "metadata", userId: "one", noteId: "note", historyId: "h", capturedAt: "now", metadataCiphertext: "meta", metadataNonce: "nonce", metadataEncryptionVersion: 1, generation: 2 });
    expect(await readLocalStorageStatus("one")).toEqual({ bytes: 76, objects: 1, attachments: 1, history: 1 });
    expect(await readLocalStorageStatus("two")).toEqual({ bytes: 14, objects: 0, attachments: 0, history: 0 });
  });
  it("only records complete sync success and separates endpoint histories", async () => {
    await recordCompleteSync("one", "device", false, "2026-01-01");
    expect(await localDb.meta.get(lastSyncKey("one", "device"))).toBeUndefined();
    await recordCompleteSync("one", "device", true, "2026-01-02");
    await recordCompleteSync("one", "device", false, "2026-01-03");
    expect((await localDb.meta.get(lastSyncKey("one", "device")))?.value).toBe("2026-01-02");
    expect(await localDb.meta.get(lastSyncKey("one", "other"))).toBeUndefined();
  });
  it("notifies on threshold crossings and deduplicates the same level for 24 hours", async () => {
    const now = 2 * 86400000;
    expect([capacityLevel(79, 100), capacityLevel(80, 100), capacityLevel(95, 100), capacityLevel(100, 100), capacityLevel(10000, null)])
      .toEqual(["normal", "warning", "critical", "full", "unlimited"]);
    expect(await claimCapacityNotice("user", "warning", now)).toBe(true);
    expect(await claimCapacityNotice("user", "warning", now + 1)).toBe(false);
    expect(await claimCapacityNotice("user", "critical", now + 2)).toBe(true);
    expect(await claimCapacityNotice("user", "warning", now + 3)).toBe(false);
    await claimCapacityNotice("user", "normal", now + 86400000);
    expect(await claimCapacityNotice("user", "warning", now + 86400001)).toBe(true);
    expect(await claimCapacityNotice("other", "warning", now)).toBe(true);
    expect(await claimCapacityNotice("user", "unlimited", now + 86400002)).toBe(false);
  });
});
