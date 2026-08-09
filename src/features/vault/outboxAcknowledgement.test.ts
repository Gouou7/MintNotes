import { beforeEach, describe, expect, it, vi } from "vitest";
import { type LocalEncryptedObject, type OutboxEntry } from "../../storage/database";
import type { VaultObject } from "../../types";
import { acknowledgeOutboxEntry } from "./outboxAcknowledgement";

vi.mock("../../crypto/client", () => ({ cryptoClient: {} }));
const stores = vi.hoisted(() => ({
  objects: new Map<string, LocalEncryptedObject>(),
  outbox: new Map<string, OutboxEntry>()
}));
vi.mock("../../storage/database", () => ({
  localDb: {
    objects: {
      get: vi.fn(async (key: string) => stores.objects.get(key)),
      put: vi.fn(async (value: LocalEncryptedObject) => { stores.objects.set(value.key, value); })
    },
    outbox: {
      get: vi.fn(async (key: string) => stores.outbox.get(key)),
      put: vi.fn(async (value: OutboxEntry) => { stores.outbox.set(value.key, value); }),
      delete: vi.fn(async (key: string) => { stores.outbox.delete(key); })
    },
    transaction: vi.fn(async (...args: unknown[]) => {
      const operation = args.at(-1) as () => Promise<void>;
      await operation();
    })
  }
}));

const userId = "user-a";
const objectId = "11111111-1111-4111-8111-111111111111";
const key = `${userId}:${objectId}`;

function entry(generation: number, ciphertext: string): OutboxEntry {
  return {
    key,
    userId,
    objectId,
    objectType: "note",
    ciphertext,
    nonce: "nonce",
    encryptionVersion: 1,
    revision: 1,
    deleted: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    operation: "upsert",
    baseRevision: 0,
    idempotencyKey: crypto.randomUUID(),
    generation
  };
}

beforeEach(() => {
  stores.objects.clear();
  stores.outbox.clear();
});

describe("outbox acknowledgement", () => {
  it("atomically rebases a newer generation after an older upload is accepted", async () => {
    const sent = entry(1, "old-ciphertext");
    const current = entry(2, "new-ciphertext");
    stores.outbox.set(key, current);
    stores.objects.set(key, current as LocalEncryptedObject);
    const decrypted: VaultObject = {
      kind: "note",
      title: "Draft",
      markdown: "newest",
      parentId: null,
      tags: [],
      favorite: false,
      locked: false,
      deleted: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      manualOrder: 0,
      attachmentIds: [],
      schemaVersion: 2
    };
    const cryptoPort = {
      decryptObject: vi.fn(async () => decrypted),
      encryptObject: vi.fn(async () => ({ ciphertext: "rebased", nonce: "new-nonce", encryptionVersion: 1 }))
    };
    const result = await acknowledgeOutboxEntry(userId, sent, 1, () => 3, cryptoPort as never);
    expect(result.status).toBe("rebased");
    expect(stores.outbox.get(key)).toMatchObject({
      ciphertext: "rebased",
      revision: 2,
      baseRevision: 1,
      generation: 3
    });
    expect(stores.objects.get(key)).toMatchObject({ ciphertext: "rebased", revision: 2 });
    expect(cryptoPort.encryptObject).toHaveBeenCalledWith(userId, objectId, "note", 2, decrypted);
  });
});
