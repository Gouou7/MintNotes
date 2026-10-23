import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { operationId } from "@mint-notes/application-client";
import { localDb, localKey } from "../../storage/database";
import { useVaultTrash } from "./useVaultTrash";
import type { OpenDocument } from "../../types";

const mocks = vi.hoisted(() => ({ api: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("../../api", () => ({ api: mocks.api }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => { vi.clearAllMocks(); for (const table of localDb.tables) await table.clear(); });
const target: OpenDocument = { objectId: "note", kind: "note", title: "Note", markdown: "body", parentId: null, tags: [], favorite: false, locked: false,
  deleted: true, createdAt: "2026-01-01", updatedAt: "2026-01-01", manualOrder: 0, attachmentIds: [], schemaVersion: 2, serverRevision: 2, dirty: false };
async function pending(objectId: string, ownerNoteId?: string) {
  await localDb.outbox.put({ key: localKey("u", objectId), userId: "u", objectId, objectType: ownerNoteId ? "attachment" : "note", ownerNoteId,
    ciphertext: "unique pending data", nonce: "nonce", encryptionVersion: 1, revision: 1, deleted: false, updatedAt: "2026-01-01",
    operation: "upsert", baseRevision: 0, generation: 1, idempotencyKey: operationId() });
}
async function harness(run: (controller: ReturnType<typeof useVaultTrash>, options: any) => Promise<void>) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const options: any = { model: { documentsRef: { current: [target] }, attachmentsRef: { current: [] } }, selection: {},
    showMessage: vi.fn(), t: (key: string) => key, nameReservations: { current: {} }, persistObject: vi.fn(), setEditorSessionId: vi.fn(), requestPush: vi.fn(),
    serverSessionVerified: true, documentSaveQueue: { hasPending: () => false, flushAll: vi.fn() },
    objectPersistence: { drainAll: vi.fn(), coordinate: (_id: string, operation: () => Promise<void>) => operation() },
    synchronize: vi.fn().mockRejectedValue(new Error("unrelated upload failed")), userId: "u", syncClientId: { current: "client" }, removePurgedLocal: vi.fn() };
  let controller!: ReturnType<typeof useVaultTrash>;
  function Harness() { controller = useVaultTrash(options); return null; }
  try { await act(async () => root.render(<Harness />)); await act(async () => run(controller, options)); }
  finally { await act(async () => root.unmount()); host.remove(); }
}
describe("scoped permanent clearing", () => {
  it("clears a synced target without flushing unrelated failed queues", async () => {
    await pending("unrelated");
    await harness(async (controller, options) => {
      await controller.purgeTrash([target.objectId]);
      expect(mocks.api).toHaveBeenCalledOnce(); expect(options.synchronize).not.toHaveBeenCalled();
      expect(options.documentSaveQueue.flushAll).not.toHaveBeenCalled(); expect(options.objectPersistence.drainAll).not.toHaveBeenCalled();
      expect(await localDb.outbox.get(localKey("u", "unrelated"))).toBeDefined();
    });
  });
  it.each([false, true])("blocks any unique target data, including an unpublished owned attachment (%s)", async (ownedAttachment) => {
    await pending(ownedAttachment ? "unpublished-image" : "note", ownedAttachment ? "note" : undefined);
    await harness(async (controller, options) => {
      await controller.purgeTrash([target.objectId]);
      expect(mocks.api).not.toHaveBeenCalled(); expect(options.removePurgedLocal).not.toHaveBeenCalled();
      expect(options.showMessage).toHaveBeenCalledWith("notice.purgeWaitSync", "critical");
      expect(await localDb.outbox.count()).toBe(1);
    });
  });
});
