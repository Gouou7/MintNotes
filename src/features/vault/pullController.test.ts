import { beforeEach, describe, expect, it, vi } from "vitest";
import { pullVaultChanges } from "./pullController";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  decryptObject: vi.fn(),
  metaPut: vi.fn(),
  objectDelete: vi.fn(),
  auxiliaryPending: vi.fn(async () => false),
  graphPending: vi.fn(async () => false)
}));

vi.mock("../../api", () => ({ api: mocks.api }));
vi.mock("../../crypto/client", () => ({ cryptoClient: { decryptObject: mocks.decryptObject } }));
vi.mock("./localPurge", () => ({
  hasPendingLocalAuxiliaryData: mocks.auxiliaryPending,
  hasPendingLocalObjectGraph: mocks.graphPending
}));
vi.mock("../../storage/database", () => {
  const emptyWhere = { equals: () => ({ toArray: async () => [], delete: vi.fn(), count: async () => 0 }) };
  const table = { where: () => emptyWhere, delete: vi.fn() };
  return {
    cursorKey: (userId: string) => `sync-cursor:${userId}`,
    localKey: (userId: string, objectId: string) => `${userId}:${objectId}`,
    localDb: {
      meta: { get: vi.fn(async () => ({ value: "5" })), put: mocks.metaPut },
      outbox: { ...table, get: vi.fn(), bulkDelete: vi.fn() },
      objects: { ...table, delete: mocks.objectDelete, bulkGet: vi.fn(async () => []), bulkPut: vi.fn() },
      attachmentChunks: table,
      attachmentOutbox: table,
      historySnapshots: table,
      historyIndex: table,
      historyOutbox: table,
      historyMetadataOutbox: table,
      transaction: vi.fn(async (...args: unknown[]) => {
        const operation = args.at(-1) as () => Promise<void>;
        await operation();
      })
    }
  };
});

const baseChange = {
  sequence: 6,
  objectId: "11111111-1111-4111-8111-111111111111",
  objectType: "note" as const,
  ciphertext: "ciphertext",
  nonce: "nonce",
  encryptionVersion: 1,
  revision: 1,
  deleted: false,
  serverUpdatedAt: "2026-01-01T00:00:00.000Z"
};

const dependencies = {
  userId: "user-a",
  isActive: () => true,
  activeObjectId: () => null,
  hasPendingSave: () => false,
  flushDocument: vi.fn(),
  preserveConflict: vi.fn()
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auxiliaryPending.mockResolvedValue(false);
  mocks.graphPending.mockResolvedValue(false);
});

describe("vault pull controller", () => {
  it("does not commit the page cursor when decryption fails", async () => {
    mocks.api.mockResolvedValue({ changes: [baseChange], cursor: 6, hasMore: false });
    mocks.decryptObject.mockRejectedValue(new Error("authentication failed"));
    const result = await pullVaultChanges(dependencies);
    expect(result.failedObjectIds).toEqual(new Set([baseChange.objectId]));
    expect(mocks.metaPut).not.toHaveBeenCalled();
  });

  it("does not clean or advance a purge while auxiliary local data is pending", async () => {
    mocks.api.mockResolvedValue({ changes: [{ ...baseChange, purged: true }], cursor: 6, hasMore: false });
    mocks.auxiliaryPending.mockResolvedValue(true);
    const result = await pullVaultChanges(dependencies);
    expect(result.purgeDeferred).toBe(true);
    expect(mocks.objectDelete).not.toHaveBeenCalled();
    expect(mocks.metaPut).not.toHaveBeenCalled();
  });
});
