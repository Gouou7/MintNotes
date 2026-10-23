import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translateMessage } from "../../i18n";
import type { OpenDocument } from "../../types";
import { useVaultLock } from "./useVaultLock";
import { useVaultModel } from "./useVaultModel";

const mocks = vi.hoisted(() => ({ api: vi.fn(), lock: vi.fn(), deleteData: vi.fn(), pendingRevocation: vi.fn() }));
vi.mock("../../api", () => ({ api: mocks.api }));
vi.mock("../../crypto/client", () => ({ cryptoClient: { lock: mocks.lock } }));
vi.mock("../../storage/database", async (original) => ({
  ...await original<typeof import("../../storage/database")>(), deleteLocalUserData: mocks.deleteData
}));
vi.mock("../../crypto/deviceUnlock", () => ({
  clearPinRefreshGrant: vi.fn(), clearCurrentBrowserSessionGrant: vi.fn(), broadcastAccountLogout: vi.fn(),
  clearPendingEndpointRevocation: async () => undefined, markEndpointRevocationPending: mocks.pendingRevocation,
  hasDevicePin: () => true, touchPinRefreshGrant: vi.fn()
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let model: ReturnType<typeof useVaultModel>;
let controller: ReturnType<typeof useVaultLock>;
let options: Parameters<typeof useVaultLock>[0];
const draft: OpenDocument = { objectId: "draft", kind: "note", title: "Draft", markdown: "latest draft",
  parentId: null, tags: [], favorite: false, locked: false, deleted: false, attachmentIds: [], manualOrder: 0,
  createdAt: "2026-01-01", updatedAt: "2026-01-01", schemaVersion: 2, serverRevision: 1, dirty: true };

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.pendingRevocation.mockResolvedValue(undefined);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  function Harness() {
    model = useVaultModel();
    options ??= {
      model, logoutStarted: { current: false }, userId: "user", endpoint: { id: "endpoint", remembered: true },
      credential: null, attachmentUrlCache: { current: new Map() },
      importExport: { result: null, dismiss: vi.fn(), handleImport: vi.fn(), exportRoot: vi.fn(),
        exportDocuments: vi.fn(), cancel: vi.fn(), resume: vi.fn() },
      documentSaveQueue: { queue: vi.fn(), flush: vi.fn(), flushAll: vi.fn(), cancelAll: vi.fn(),
        hasPending: vi.fn(), pendingIds: () => [] },
      objectPersistence: { persistObject: async object => object, coordinate: async (_id, task) => task(),
        drain: vi.fn(), drainAll: vi.fn(), pause: vi.fn(), resume: vi.fn() },
      finishHistorySession: vi.fn(), stopSync: vi.fn(), queueDocument: vi.fn(),
      onLocked: vi.fn(), showMessage: vi.fn(), t: (key, values) => translateMessage("en", key, values)
    };
    options.model = model;
    controller = useVaultLock(options);
    return null;
  }
  await act(async () => root.render(<Harness />));
  await act(async () => model.replaceDocuments([draft]));
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  options = undefined!;
});

describe("vault lock boundaries", () => {
  it("waits for history, local saves and persistence before clearing decrypted state", async () => {
    const order: string[] = [];
    vi.mocked(options.finishHistorySession).mockImplementation(async () => { order.push("history"); });
    vi.mocked(options.documentSaveQueue.flushAll).mockImplementation(async () => { order.push("save"); });
    vi.mocked(options.objectPersistence.drainAll).mockImplementation(async () => { order.push("drain"); });
    mocks.lock.mockImplementation(async () => { order.push("crypto-lock"); });
    await act(async () => controller.lock());
    expect(order).toEqual(["history", "save", "drain", "crypto-lock"]);
    expect(model.documentsRef.current).toEqual([]);
    expect(model.documentIndexRef.current.size).toBe(0);
    expect(options.stopSync).toHaveBeenCalledOnce();
    expect(options.onLocked).toHaveBeenCalledWith(false);
    expect(mocks.deleteData).not.toHaveBeenCalled();
  });

  it("keeps the vault and draft available when a local save fails", async () => {
    vi.mocked(options.documentSaveQueue.flushAll).mockRejectedValue(new Error("storage full"));
    await act(async () => controller.lock());
    expect(options.logoutStarted.current).toBe(false);
    expect(model.documentsRef.current).toEqual([draft]);
    expect(options.importExport.resume).toHaveBeenCalledOnce();
    expect(options.showMessage).toHaveBeenCalledWith("storage full", "critical");
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(options.onLocked).not.toHaveBeenCalled();
  });

  it("resumes persistence and requeues dirty drafts if logout cannot delete local data", async () => {
    mocks.deleteData.mockRejectedValue(new Error("deletion failed"));
    await act(async () => controller.lock(true));
    expect(options.documentSaveQueue.cancelAll).toHaveBeenCalledOnce();
    expect(options.logoutStarted.current).toBe(false);
    expect(options.objectPersistence.resume).toHaveBeenCalledOnce();
    expect(options.queueDocument).toHaveBeenCalledWith(draft, 0);
    expect(model.documentsRef.current).toEqual([draft]);
    expect(mocks.lock).not.toHaveBeenCalled();
  });

  it("clears local data on logout and queues endpoint revocation when the server is unreachable", async () => {
    mocks.api.mockRejectedValue(new TypeError("offline"));
    await act(async () => controller.lock(true));
    expect(mocks.deleteData).toHaveBeenCalledWith("user");
    expect(options.documentSaveQueue.flushAll).not.toHaveBeenCalled();
    expect(model.documentsRef.current).toEqual([]);
    expect(options.onLocked).toHaveBeenCalledWith(true);
    expect(mocks.pendingRevocation).toHaveBeenCalledWith("user", "endpoint");
  });
});
