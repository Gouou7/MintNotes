import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { localDb } from "./database";

describe("non-destructive browser schema upgrade", () => {
  it.each([1, 2, 3, 4, 5, 6, 7])("preserves schema %i objects, frozen requests and cursor", async (version) => {
    await localDb.delete();
    const legacy = new Dexie("webmd-notes-v2");
    const schema: Record<string, string> = {
      objects: "key, userId, [userId+objectId], updatedAt", outbox: "key, userId, [userId+objectId], generation",
      attachmentChunks: `key, userId, [userId+attachmentId], [userId+attachmentId+chunkIndex]${version >= 7 ? ', touchedAt' : ''}`,
      attachmentOutbox: "key, userId, [userId+attachmentId], generation", meta: "key"
    };
    if (version >= 2) schema.deviceCredentials = version >= 3 ? "userId, endpointId" : "userId";
    if (version >= 4) schema.pendingEndpointRevocations = "endpointId, userId";
    if (version >= 5) {
      schema.historySnapshots = `key, userId, [userId+noteId], [userId+noteId+capturedAt], historyId${version >= 7 ? ', touchedAt' : ''}`;
      schema.historyOutbox = "key, userId, [userId+noteId], generation";
    }
    if (version >= 6) {
      schema.historyIndex = "key, userId, [userId+noteId], [userId+noteId+capturedAt], historyId";
      schema.historyMetadataOutbox = "key, userId, [userId+noteId], generation";
    }
    legacy.version(version).stores(schema);
    const object = { key: "user:note", userId: "user", objectId: "note", objectType: "note", ciphertext: "legacy ciphertext", nonce: "legacy nonce", revision: 4, encryptionVersion: 1, deleted: false, updatedAt: "2026-10-28" };
    const pending = { ...object, idempotencyKey: "unchanged operation", baseRevision: 3, generation: 1, operation: "upsert", upload: { ...object, ciphertext: "frozen request", idempotencyKey: "frozen operation" } };
    await legacy.table("objects").put(object); await legacy.table("outbox").put(pending);
    await legacy.table("meta").put({ key: "sync-cursor:user", value: "42" });
    legacy.close();
    await localDb.open();
    expect(await localDb.objects.get(object.key)).toEqual(object);
    expect(await localDb.outbox.get(object.key)).toEqual(pending);
    expect(await localDb.meta.get("sync-cursor:user")).toEqual({ key: "sync-cursor:user", value: "42" });
    expect(localDb.verno).toBe(8);
    expect(await localDb.bodyBlocks.count()).toBe(0);
    expect(await localDb.recoveries.count()).toBe(0);
  });
});
