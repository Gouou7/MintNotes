import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { operationId } from "@mint-notes/application-client";
import { localDb, localKey, cursorKey } from "../../storage/database";
import { prepareVaultSynchronization } from "./syncReconciliation";
import type { PullControllerDependencies } from "./pullController";
import type { VaultDocument } from "../../types";

const mocks = vi.hoisted(() => ({ api: vi.fn(), lease: vi.fn(), decrypt: vi.fn() }));
vi.mock("../../api", () => ({ api: mocks.api, setSyncLease: mocks.lease }));
vi.mock("../../crypto/client", () => ({ cryptoClient: { decryptObject: mocks.decrypt } }));
const userId = "u";
const id = "11111111-1111-4111-8111-111111111111";
const payload: VaultDocument = { kind: "note", title: "Draft", markdown: "unique local text", parentId: null, tags: [], favorite: false, locked: false, deleted: false,
  createdAt: "2026-01-01", updatedAt: "2026-01-01", manualOrder: 0, attachmentIds: [], schemaVersion: 2 };
const local = { key: localKey(userId, id), userId, objectId: id, objectType: "note" as const, ciphertext: JSON.stringify(payload), nonce: "nonce", revision: 2, deleted: false, encryptionVersion: 1, updatedAt: "2026-01-01" };
afterEach(async () => { vi.resetAllMocks(); for (const table of localDb.tables) await table.clear(); });
function dependencies(active = () => true): PullControllerDependencies {
  mocks.decrypt.mockImplementation(async (_u, _id, _type, _rev, ciphertext) => JSON.parse(ciphertext));
  return { userId, isActive: active, activeObjectId: () => null, hasPendingSave: () => false, flushDocument: vi.fn(),
    preserveConflict: vi.fn(async () => {
      const copyId = crypto.randomUUID(); const key = localKey(userId, copyId);
      await localDb.objects.put({ ...local, key, objectId: copyId, revision: 1 });
      await localDb.outbox.put({ ...local, key, objectId: copyId, revision: 1, operation: "upsert", baseRevision: 0, idempotencyKey: operationId(), generation: 2 });
      return { ...payload, objectId: copyId, serverRevision: 0, dirty: true };
    }) };
}
describe("v2 full reconciliation", () => {
  it("recovers an expired offline edit under a new UUID when purge markers already expired", async () => {
    await localDb.objects.put(local);
    await localDb.outbox.put({ ...local, baseRevision: 1, operation: "upsert", idempotencyKey: operationId(Date.now() - 91 * 86_400_000), generation: 1 });
    const deps = dependencies();
    mocks.api.mockImplementation(async (path: string) => path.includes("/status") ? { epoch: "new", head: 50, floor: 40, reconcile: true, lease: "lease" }
      : path.includes("/snapshot") ? { epoch: "new", objects: [], next: null } : { epoch: "new", changes: [], cursor: 50, hasMore: false });
    expect(await prepareVaultSynchronization(deps)).toBe(true);
    expect(await localDb.objects.get(local.key)).toBeUndefined();
    const pending = await localDb.outbox.toArray();
    expect(pending).toHaveLength(1); expect(pending[0].objectId).not.toBe(id); expect(pending[0].ciphertext).toContain("unique local text");
    expect((await localDb.meta.get(cursorKey(userId)))?.value).toBe("50");
    expect(deps.preserveConflict).toHaveBeenCalledOnce();
  });
  it("does not remove unseen objects or commit the lease when calibration is interrupted", async () => {
    await localDb.objects.put(local); let active = true;
    const deps = dependencies(() => active);
    mocks.api.mockImplementation(async (path: string) => {
      if (path.includes("/status")) return { epoch: "new", head: 50, floor: 40, reconcile: true, lease: "new-lease" };
      active = false; return { epoch: "new", objects: [], next: null };
    });
    expect(await prepareVaultSynchronization(deps)).toBe(false);
    expect(await localDb.objects.get(local.key)).toEqual(local);
    expect(await localDb.meta.get(cursorKey(userId))).toBeUndefined();
    expect(await localDb.meta.get(`sync-lease:${userId}`)).toBeUndefined();
  });
  it.each([false, true])("preserves a newer local revision when an older server backup is restored (pending=%s)", async (pending) => {
    await localDb.objects.put({ ...local, revision: 9 });
    if (pending) await localDb.outbox.put({ ...local, revision: 9, baseRevision: 8, operation: "upsert", idempotencyKey: operationId(), generation: 1 });
    const deps = dependencies();
    mocks.api.mockImplementation(async (path: string) => path.includes("/status") ? { epoch: "restored", head: 8, floor: 0, reconcile: true, lease: "lease" }
      : path.includes("/snapshot") ? { epoch: "restored", objects: [{ ...local, revision: 1, ciphertext: JSON.stringify({ ...payload, markdown: "older backup text" }) }], next: null }
      : { epoch: "restored", changes: [], cursor: 8, hasMore: false });
    expect(await prepareVaultSynchronization(deps)).toBe(true);
    expect((await localDb.objects.get(local.key))?.ciphertext).toContain("older backup text");
    expect(deps.preserveConflict).toHaveBeenCalledOnce();
    expect((await localDb.outbox.toArray()).some((entry) => entry.objectId !== id && entry.ciphertext.includes("unique local text"))).toBe(true);
  });
  it("recovers confirmed content when a changed epoch reuses the same revision", async () => {
    await localDb.objects.put({ ...local, revision: 1 });
    await localDb.meta.put({ key: `sync-state:${userId}`, value: JSON.stringify({ epoch: "previous" }) });
    const deps = dependencies();
    mocks.api.mockImplementation(async (path: string) => path.includes("/status") ? { epoch: "restored", head: 8, floor: 0, reconcile: true, lease: "lease" }
      : path.includes("/snapshot") ? { epoch: "restored", objects: [{ ...local, revision: 1, ciphertext: JSON.stringify({ ...payload, markdown: "restored branch" }) }], next: null }
      : { epoch: "restored", changes: [], cursor: 8, hasMore: false });
    expect(await prepareVaultSynchronization(deps)).toBe(true);
    expect(deps.preserveConflict).toHaveBeenCalledOnce();
    expect((await localDb.objects.get(local.key))?.ciphertext).toContain("restored branch");
  });
  it("preserves a fresh edit at the same server revision through a complete scan", async () => {
    await localDb.objects.put(local);
    await localDb.outbox.put({ ...local, baseRevision: 1, operation: "upsert", idempotencyKey: operationId(), generation: 1 });
    const deps = dependencies();
    mocks.api.mockImplementation(async (path: string) => path.includes("/status") ? { epoch: "new", head: 8, floor: 0, reconcile: true, lease: "lease" }
      : path.includes("/snapshot") ? { epoch: "new", objects: [{ ...local, revision: 1, ciphertext: JSON.stringify({ ...payload, markdown: "server text" }) }], next: null }
      : { epoch: "new", changes: [], cursor: 8, hasMore: false });
    expect(await prepareVaultSynchronization(deps)).toBe(true);
    expect((await localDb.outbox.get(local.key))?.ciphertext).toContain("unique local text");
    expect(deps.preserveConflict).not.toHaveBeenCalled();
  });
});
