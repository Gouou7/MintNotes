import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { localDb, type OutboxEntry } from "../../storage/database";
import { reserveConflictRecovery, completeConflictRecoveries } from "./conflictRecovery";

const source: OutboxEntry = { key: "user:source", userId: "user", objectId: "source", objectType: "note",
  ciphertext: "retained ciphertext", nonce: "nonce", encryptionVersion: 1, revision: 2, deleted: false,
  updatedAt: "2026-10-28", operation: "upsert", baseRevision: 1, idempotencyKey: "source-proposal", generation: 1 };
beforeEach(async () => { for (const table of localDb.tables) await table.clear(); });
describe("durable conflict recovery", () => {
  it("does not recreate recovery data after the vault becomes inactive", async () => {
    let checks = 0;
    await expect(reserveConflictRecovery("user", source, [], () => checks++ === 0)).rejects.toMatchObject({ name: "AbortError" });
    expect(await localDb.recoveries.count()).toBe(0);
  });
  it("reserves one copy identity across retry and retains the exact encrypted source", async () => {
    const first = await reserveConflictRecovery("user", source);
    const second = await reserveConflictRecovery("user", { ...source });
    expect(second).toEqual(first);
    expect(second.source).toEqual(source);
    await completeConflictRecoveries("user");
    expect(await localDb.recoveries.count()).toBe(1);
  });
  it("retains the source until both the copy and attachment graph are acknowledged", async () => {
    const record = await reserveConflictRecovery("user", source);
    const copy = { ...source, objectId: record.copyId, key: `user:${record.copyId}` };
    const child = { ...source, key: "user:child", objectId: "child", objectType: "attachment" as const, ownerNoteId: record.copyId };
    await localDb.objects.bulkPut([copy, child]);
    await localDb.outbox.put(copy);
    await completeConflictRecoveries("user");
    expect(await localDb.recoveries.count()).toBe(1);
    await localDb.outbox.delete(copy.key);
    await localDb.outbox.put(child);
    await completeConflictRecoveries("user");
    expect(await localDb.recoveries.count()).toBe(1);
    await localDb.outbox.delete(child.key);
    await completeConflictRecoveries("user");
    expect(await localDb.recoveries.count()).toBe(0);
  });
});
