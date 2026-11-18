import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { operationId } from "@mint-notes/application-client";
import { localDb, localKey } from "../../storage/database";
import { NameReservations } from "../siblingNames";
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
  const options: any = { confirm: vi.fn().mockResolvedValue(true), model: { documentsRef: { current: [target] }, attachmentsRef: { current: [] } },
    selection: { activeIdRef: { current: null }, selectionAnchor: { current: null }, setSelectedIds: vi.fn() },
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
  it("does not purge a different set of tombstones after an asynchronous confirmation", async () => {
    await harness(async (controller, options) => {
      let accept!: (confirmed: boolean) => void;
      options.confirm.mockImplementationOnce(() => new Promise<boolean>((resolve) => { accept = resolve; }));
      const pendingConfirmation = controller.requestClearTrash();
      options.model.documentsRef.current = [target, { ...target, objectId: "newly-trashed" }];
      accept(true);
      await pendingConfirmation;
      expect(mocks.api).not.toHaveBeenCalled();
      expect(options.showMessage).toHaveBeenCalledWith("notice.purgeTargetsChanged");
    });
  });

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

it.each([true, false])("reports a restore result after local persistence (name conflict: %s)", async (conflict) => {
  await harness(async (controller, options) => {
    options.nameReservations.current = new NameReservations();
    if (conflict) options.model.documentsRef.current = [target, { ...target, objectId: "existing", deleted: false }];

    await controller.setDeletedMany([target.objectId], false);

    if (conflict) {
      expect(options.persistObject).not.toHaveBeenCalled();
      expect(options.showMessage.mock.calls).toEqual([["notice.restoreNameConflict"]]);
    } else {
      expect(options.persistObject).toHaveBeenCalledOnce();
      expect(options.showMessage.mock.calls).toEqual([["notice.itemRestored", "info"]]);
      expect(options.persistObject.mock.invocationCallOrder[0]).toBeLessThan(options.showMessage.mock.invocationCallOrder[0]);
    }
  });
});

vi.mock("../session/workspaceServices", async () => {
  const { testWorkspaceServices } = await import("../session/workspaceServices.testSupport");
  return { useWorkspaceServices: testWorkspaceServices };
});
