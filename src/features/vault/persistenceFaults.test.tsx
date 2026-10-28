import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localDb, type LocalEncryptedObject } from "../../storage/database";
import { useObjectPersistence } from "./useObjectPersistence";
import type { OpenDocument } from "../../types";

const mocks = vi.hoisted(() => ({ encryptObject: vi.fn() }));
vi.mock("../../crypto/client", () => ({ cryptoClient: { encryptObject: mocks.encryptObject } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => { vi.restoreAllMocks(); for (const table of localDb.tables) await table.clear(); });

describe("atomic note graph persistence under injected storage failures", () => {
  it.each(["recovery", "block", "object", "outbox"])("keeps the previous object and proposal if %s persistence fails", async (fault) => {
    const objectId = crypto.randomUUID(), userId = "user";
    const original: LocalEncryptedObject = { key: `${userId}:${objectId}`, userId, objectId, objectType: "note", ciphertext: "original encrypted body", nonce: "original nonce", encryptionVersion: 1, revision: 1, deleted: false, updatedAt: "2026-10-28" };
    const pending = { ...original, operation: "upsert" as const, baseRevision: 0, idempotencyKey: "original operation", generation: 1 };
    await localDb.objects.put(original); await localDb.outbox.put(pending);
    const blocks = [{ blockId: crypto.randomUUID(), ciphertext: "new encrypted block", nonce: "new nonce" }];
    mocks.encryptObject.mockResolvedValue({ ciphertext: "new encrypted manifest", nonce: "manifest nonce", encryptionVersion: 2,
      bodyBlockIds: blocks.map((block) => block.blockId), bodyBlocks: blocks });
    let controller!: ReturnType<typeof useObjectPersistence>;
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    function Harness() {
      controller = useObjectPersistence({ userId, generation: { current: 0 }, isActive: () => true, canSynchronize: () => true,
        setSaveState: vi.fn(), onPersistenceError: vi.fn(), onPersistenceSuccess: vi.fn(), upsertDocument: vi.fn(), upsertAttachment: vi.fn() });
      return null;
    }
    await act(async () => root.render(<Harness />));
    const error = new Error("injected write failure");
    if (fault === "recovery") vi.spyOn(localDb.recoveries, "add").mockRejectedValueOnce(error);
    if (fault === "block") vi.spyOn(localDb.bodyBlocks, "add").mockRejectedValueOnce(error);
    if (fault === "object") vi.spyOn(localDb.objects, "put").mockRejectedValueOnce(error);
    if (fault === "outbox") vi.spyOn(localDb.outbox, "put").mockRejectedValueOnce(error);
    const next: OpenDocument = { objectId, kind: "note", title: "Changed", markdown: "new body", parentId: null,
      tags: [], attachmentIds: [], favorite: false, locked: false, deleted: false, manualOrder: 0, schemaVersion: 2,
      createdAt: "2026-10-28", updatedAt: "2026-10-28", serverRevision: 0, dirty: true };
    try {
      await act(async () => { await expect(controller.persistObject(next)).rejects.toThrow("injected write failure"); });
      expect(await localDb.objects.get(original.key)).toEqual(original);
      expect(await localDb.outbox.get(original.key)).toEqual(pending);
      expect(await localDb.bodyBlocks.count()).toBe(0);
      expect(await localDb.recoveries.count()).toBe(0);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
