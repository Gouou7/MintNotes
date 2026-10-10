import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDb, localKey, cursorKey, type OutboxEntry, type ObjectUploadAttempt, type AttachmentOutboxEntry } from "../../storage/database";
import type { OpenDocument, VaultObject, SyncChange } from "../../types";
import { ApiError } from "../../api";
import { cryptoClient } from "../../crypto/client";
import { ObjectWriteCoordinator } from "../objectPersistence";
import { applyVaultAcknowledgement } from "../syncChanges";
import { acknowledgeOutboxEntry } from "./outboxAcknowledgement";
import { pullVaultChanges, type PullControllerDependencies } from "./pullController";
import { pushVaultPending } from "./pushController";
import { useObjectPersistence } from "./useObjectPersistence";

const mocks = vi.hoisted(() => ({ api: vi.fn(), uploadChunk: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn() }));
vi.mock("../../api", () => ({ api: mocks.api, uploadAttachmentChunk: mocks.uploadChunk,
  ApiError: class extends Error { constructor(message: string, public status: number) { super(message); } }
}));
vi.mock("../../crypto/client", () => ({ cryptoClient: { encryptObject: mocks.encrypt, decryptObject: mocks.decrypt } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const userId = "sync-test-user";
const noteId = "11111111-1111-4111-8111-111111111111";
const attachmentId = "22222222-2222-4222-8222-222222222222";
const key = localKey(userId, noteId);
const roots: Root[] = [];
let generation = 0;
function document(markdown: string, serverRevision = 3): OpenDocument {
  return {
    objectId: noteId, kind: "note", title: "Draft", markdown, parentId: null, tags: [], favorite: false, locked: false,
    deleted: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    manualOrder: 0, attachmentIds: [], schemaVersion: 2, serverRevision, dirty: true
  };
}
function plain(open: OpenDocument): VaultObject {
  const { objectId: _id, serverRevision: _revision, dirty: _dirty, ...payload } = open;
  return payload;
}
function envelope(payload: VaultObject) {
  return { ciphertext: JSON.stringify(payload), nonce: crypto.randomUUID(), encryptionVersion: 1 };
}
function entry(markdown: string, baseRevision = 3): OutboxEntry {
  return {
    key, userId, objectId: noteId, objectType: "note", ...envelope(plain(document(markdown))),
    revision: baseRevision + 1, deleted: false, updatedAt: "2026-01-01T00:00:00.000Z",
    operation: "upsert", baseRevision, idempotencyKey: crypto.randomUUID(), generation: ++generation
  };
}
function attachmentEntry(): OutboxEntry {
  return {
    ...entry("manifest"), key: localKey(userId, attachmentId), objectId: attachmentId, objectType: "attachment",
    ...envelope({
      kind: "attachment", ownerNoteId: noteId, originalName: "image.png", mime: "image/png",
      size: 1, sha256: "synthetic-digest", chunkCount: 1, chunkSize: 1, attachmentKey: "synthetic-key",
      deleted: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", schemaVersion: 2
    })
  };
}
async function seed(value: OutboxEntry) {
  const { operation: _op, baseRevision: _base, idempotencyKey: _id, generation: _generation, upload: _upload, ...stored } = value;
  await localDb.transaction("rw", localDb.objects, localDb.outbox, async () => {
    await localDb.objects.put(stored); await localDb.outbox.put(value);
  });
}
function change(value: ObjectUploadAttempt): SyncChange {
  return { objectId: value.objectId, objectType: value.objectType, ciphertext: value.ciphertext, nonce: value.nonce,
    encryptionVersion: value.encryptionVersion, revision: value.revision, deleted: value.deleted,
    sequence: value.revision, serverUpdatedAt: value.updatedAt };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function pullDependencies(): PullControllerDependencies {
  return {
    userId, isActive: () => true, activeObjectId: () => null, hasPendingSave: () => false, flushDocument: vi.fn(),
    preserveConflict: vi.fn(async (source) => {
      const payload = JSON.parse(source.ciphertext) as VaultObject;
      if (payload.kind === "attachment") return null;
      const copyId = crypto.randomUUID();
      const copy = { ...payload, objectId: copyId, serverRevision: 0, dirty: true };
      const copied = { ...entry(payload.markdown, 0), key: localKey(userId, copyId), objectId: copyId };
      await seed(copied);
      return copy;
    }),
    discardConflict: vi.fn(async (copy) => {
      await localDb.objects.delete(localKey(userId, copy.objectId));
      await localDb.outbox.delete(localKey(userId, copy.objectId));
    })
  };
}
function pushDependencies() {
  const coordinator = new ObjectWriteCoordinator();
  return {
    userId, clientId: "test-client", isActive: () => true,
    acknowledge: vi.fn(async (sent: ObjectUploadAttempt, revision: number) => {
      await coordinator.runExclusive(sent.key, () => acknowledgeOutboxEntry(userId, sent, revision, () => ++generation));
    }),
    onConflict: vi.fn(async () => { await localDb.meta.put({ key: cursorKey(userId), value: "0" }); }),
    pushHistory: vi.fn(async () => false), pushHistoryMetadata: vi.fn(async () => false)
  };
}
async function mount(initial: OpenDocument) {
  let current = initial;
  let persistence!: ReturnType<typeof useObjectPersistence>;
  const clock = { current: 0 };
  function Harness() {
    persistence = useObjectPersistence({
      userId, generation: clock, isActive: () => true, canSynchronize: () => true,
      setSaveState: vi.fn(), onPersistenceError: vi.fn(), onPersistenceSuccess: vi.fn(),
      upsertDocument: (next) => { current = next; }, upsertAttachment: vi.fn(), getServerRevision: () => current.serverRevision
    });
    return null;
  }
  const host = globalThis.document.createElement("div"); globalThis.document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => root.render(<Harness />));
  const acknowledge = async (sent: ObjectUploadAttempt, revision: number) => persistence.coordinate(sent.objectId, async () => {
    const result = await acknowledgeOutboxEntry(userId, sent, revision, () => ++generation);
    if (result.status !== "missing") current = applyVaultAcknowledgement(current, result.object, revision, result.status === "rebased");
  });
  return {
    current: () => current,
    persist: async (next: OpenDocument) => {
      current = next;
      return persistence.persistObject(next, { commitState: () => current === next });
    },
    acknowledge
  };
}

beforeEach(async () => {
  vi.resetAllMocks(); generation = 0;
  await localDb.delete(); await localDb.open();
  mocks.encrypt.mockImplementation(async (_user, _id, _kind, _revision, payload: VaultObject) => envelope(payload));
  mocks.decrypt.mockImplementation(async (_user, _id, _kind, _revision, ciphertext: string) => JSON.parse(ciphertext));
  mocks.uploadChunk.mockResolvedValue(undefined);
  mocks.api.mockImplementation(async (_path, init) => ({
    results: (JSON.parse(init.body).objects as ObjectUploadAttempt[]).map((object) => ({ objectId: object.objectId, status: "accepted", revision: object.baseRevision + 1 }))
  }));
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  globalThis.document.body.replaceChildren();
  await localDb.delete();
});

describe("synchronization race regressions", () => {
  it("serializes an upload acknowledgement behind a save already encrypting", async () => {
    const first = entry("first"); await seed(first);
    const app = await mount(document("first"));
    const network = deferred<unknown>(); mocks.api.mockReturnValueOnce(network.promise);
    const pushing = pushVaultPending({ ...pushDependencies(), acknowledge: app.acknowledge });
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledOnce());
    const encryption = deferred<ReturnType<typeof envelope>>(); mocks.encrypt.mockReturnValueOnce(encryption.promise);
    const saving = app.persist(document("second"));
    await vi.waitFor(() => expect(mocks.encrypt).toHaveBeenCalledOnce());
    network.resolve({ results: [{ objectId: noteId, status: "accepted", revision: 4 }] });
    encryption.resolve(envelope(plain(document("second"))));
    await act(async () => { await saving; await pushing; });
    expect(await localDb.outbox.get(key)).toMatchObject({ baseRevision: 4, revision: 5 });
    expect(app.current()).toMatchObject({ markdown: "second", serverRevision: 4, dirty: true });
    const next = document("third", 3); // queued snapshots may still carry the older in-memory revision
    await act(async () => { await app.persist(next); });
    expect(await localDb.outbox.get(key)).toMatchObject({ baseRevision: 4, revision: 5 });
  });

  it("retains upload staging that happens while a local save is encrypting", async () => {
    const first = entry("first"); await seed(first);
    const app = await mount(document("first"));
    const encryption = deferred<ReturnType<typeof envelope>>(); mocks.encrypt.mockReturnValueOnce(encryption.promise);
    const saving = app.persist(document("second"));
    await vi.waitFor(() => expect(mocks.encrypt).toHaveBeenCalledOnce());
    const network = deferred<unknown>(); mocks.api.mockReturnValueOnce(network.promise);
    const pushing = pushVaultPending({ ...pushDependencies(), acknowledge: app.acknowledge }).catch(() => undefined);
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledOnce());
    encryption.resolve(envelope(plain(document("second")))); await act(async () => { await saving; });
    expect((await localDb.outbox.get(key))?.upload).toMatchObject({ idempotencyKey: first.idempotencyKey });
    network.reject(new Error("response lost")); await pushing;
  });

  it("replays the exact request after response loss and then uploads edits made meanwhile", async () => {
    const first = entry("first"); await seed(first);
    const app = await mount(document("first"));
    const accepted = new Map<string, number>();
    let serverRevision = 3;
    let serverMarkdown = "";
    let loseResponse = true;
    mocks.api.mockImplementation(async (_path, init) => {
      const requests = JSON.parse(init.body).objects as ObjectUploadAttempt[];
      const results = requests.map((request) => {
        const prior = accepted.get(request.idempotencyKey);
        if (prior) return { objectId: request.objectId, status: "idempotent", revision: prior };
        if (request.baseRevision !== serverRevision) return { objectId: request.objectId, status: "conflict", currentRevision: serverRevision };
        serverRevision++; accepted.set(request.idempotencyKey, serverRevision);
        serverMarkdown = (JSON.parse(request.ciphertext) as OpenDocument).markdown;
        return { objectId: request.objectId, status: "accepted", revision: serverRevision };
      });
      if (loseResponse) { loseResponse = false; throw new Error("response lost"); }
      return { results };
    });
    const dependencies = { ...pushDependencies(), acknowledge: app.acknowledge };
    await expect(pushVaultPending(dependencies)).rejects.toThrow("response lost");
    await act(async () => { await app.persist(document("second")); });
    await act(async () => { await pushVaultPending(dependencies); await pushVaultPending(dependencies); });
    const bodies = mocks.api.mock.calls.map((call) => JSON.parse(call[1].body).objects[0] as ObjectUploadAttempt);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(serverMarkdown).toBe("second"); expect(serverRevision).toBe(5);
    expect(await localDb.outbox.get(key)).toBeUndefined();
    expect(dependencies.onConflict).not.toHaveBeenCalled();
    expect(app.current()).toMatchObject({ markdown: "second", serverRevision: 5, dirty: false });
  });

  it("acknowledges an older local upload echo without copying the newer draft", async () => {
    const first = entry("first"); const second = { ...entry("second"), upload: first }; await seed(second);
    mocks.api.mockResolvedValue({ changes: [change(first)], cursor: 4, hasMore: false });
    const dependencies = pullDependencies();
    await pullVaultChanges(dependencies);
    expect(dependencies.preserveConflict).not.toHaveBeenCalled();
    const pending = await localDb.outbox.get(key);
    expect(pending).toMatchObject({ baseRevision: 4, revision: 5 });
    expect((JSON.parse(pending!.ciphertext) as OpenDocument).markdown).toBe("second");
    expect(pending?.upload).toBeUndefined();
  });

  it("does not overwrite a save completed while the pull request was in flight", async () => {
    const remote = { ...entry("old"), revision: 3 }; await localDb.objects.put(remote);
    const network = deferred<unknown>(); mocks.api.mockReturnValueOnce(network.promise);
    const dependencies = pullDependencies(); const pulling = pullVaultChanges(dependencies);
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledOnce());
    const newest = entry("newest"); await seed(newest);
    network.resolve({ changes: [change(remote)], cursor: 3, hasMore: false }); await pulling;
    expect(await localDb.outbox.get(key)).toEqual(newest);
    expect((await localDb.objects.get(key))?.ciphertext).toBe(newest.ciphertext);
    expect(dependencies.preserveConflict).not.toHaveBeenCalled();
  });

  it("preserves the latest durable draft in a genuine remote conflict", async () => {
    await seed(entry("first"));
    const network = deferred<unknown>(); mocks.api.mockReturnValueOnce(network.promise);
    const dependencies = pullDependencies(); const pulling = pullVaultChanges(dependencies);
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledOnce());
    const newest = entry("newest"); await seed(newest);
    network.resolve({ changes: [change(entry("remote"))], cursor: 4, hasMore: false });
    const result = await pulling;
    expect(dependencies.preserveConflict).toHaveBeenCalledWith(newest);
    expect([...result.documentUpserts.values()].some((value) => value.markdown === "newest")).toBe(true);
    expect((JSON.parse((await localDb.objects.get(key))!.ciphertext) as OpenDocument).markdown).toBe("remote");
  });

  it("guards the page commit when a newer save arrives during conflict attachment preparation", async () => {
    await seed(entry("first"));
    const dependencies = pullDependencies();
    const gate = deferred<void>();
    const original = dependencies.preserveConflict;
    dependencies.preserveConflict = vi.fn(async (pending) => { const copy = await original(pending); await gate.promise; return copy; });
    mocks.api.mockResolvedValue({ changes: [change(entry("remote"))], cursor: 4, hasMore: false });
    const pulling = pullVaultChanges(dependencies);
    await vi.waitFor(() => expect(dependencies.preserveConflict).toHaveBeenCalledOnce());
    const newest = entry("newest"); await seed(newest); gate.resolve(); await pulling;
    expect(await localDb.outbox.get(key)).toEqual(newest);
    expect(dependencies.discardConflict).toHaveBeenCalledOnce();
    expect(await localDb.meta.get(cursorKey(userId))).toBeUndefined();
  });

  it("keeps pending attachment data when the remote envelope fails authentication", async () => {
    const pending = { ...entry("attachment"), objectType: "attachment" as const }; await seed(pending);
    mocks.api.mockResolvedValue({ changes: [{ ...change(pending), ciphertext: "invalid" }], cursor: 4, hasMore: false });
    mocks.decrypt.mockRejectedValue(new Error("authentication failed"));
    const dependencies = pullDependencies(); const result = await pullVaultChanges(dependencies);
    expect(result.failedObjectIds.has(noteId)).toBe(true);
    expect(await localDb.outbox.get(key)).toEqual(pending);
    expect(dependencies.preserveConflict).not.toHaveBeenCalled();
    expect(await localDb.meta.get(cursorKey(userId))).toBeUndefined();
  });

  it("does not discard a conflict that cannot be safely copied", async () => {
    const pending = entry("local"); await seed(pending);
    mocks.api.mockResolvedValue({ changes: [change(entry("remote"))], cursor: 4, hasMore: false });
    const dependencies = { ...pullDependencies(), preserveConflict: vi.fn(async () => null) };
    await pullVaultChanges(dependencies);
    expect(await localDb.outbox.get(key)).toEqual(pending);
    expect(await localDb.meta.get(cursorKey(userId))).toBeUndefined();
  });

  it("publishes the committed first page before a later page fails", async () => {
    mocks.api.mockResolvedValueOnce({ changes: [change(entry("remote"))], cursor: 4, hasMore: true });
    mocks.api.mockRejectedValueOnce(new Error("page two failed"));
    const onPage = vi.fn();
    await expect(pullVaultChanges({ ...pullDependencies(), onPage })).rejects.toThrow("page two failed");
    expect(onPage).toHaveBeenCalledOnce();
    expect(onPage.mock.calls[0][0].documentUpserts.get(noteId).markdown).toBe("remote");
    expect((await localDb.meta.get(cursorKey(userId)))?.value).toBe("4");
  });

  it("does not advance past a change skipped because input is still waiting to save", async () => {
    mocks.api.mockResolvedValue({ changes: [change(entry("remote"))], cursor: 4, hasMore: false });
    await pullVaultChanges({ ...pullDependencies(), hasPendingSave: () => true });
    expect(await localDb.meta.get(cursorKey(userId))).toBeUndefined();
    expect(await localDb.objects.get(key)).toBeUndefined();
  });

  it("defers newly inserted attachment graphs until their chunks and manifests can precede the note", async () => {
    const oldChunk: AttachmentOutboxEntry = {
      key: "old-chunk", userId, attachmentId: "old-attachment", chunkIndex: 0, totalChunks: 1,
      ciphertext: new ArrayBuffer(1), nonce: "old-nonce", encryptionVersion: 1,
      updatedAt: "2026-01-01T00:00:00.000Z", generation: 1, idempotencyKey: crypto.randomUUID()
    };
    await localDb.attachmentOutbox.put(oldChunk);
    const gate = deferred<void>(); mocks.uploadChunk.mockReturnValueOnce(gate.promise);
    const dependencies = pushDependencies(); const pushing = pushVaultPending(dependencies);
    await vi.waitFor(() => expect(mocks.uploadChunk).toHaveBeenCalledOnce());
    const manifest = attachmentEntry();
    const note = entry("image reference"); note.ciphertext = JSON.stringify({ ...plain(document("image reference")), attachmentIds: [attachmentId] });
    await seed(manifest); await seed(note);
    const newChunk = { ...oldChunk, key: "new-chunk", attachmentId, idempotencyKey: crypto.randomUUID() };
    await localDb.attachmentOutbox.put(newChunk);
    gate.resolve(); await pushing;
    expect(mocks.api).not.toHaveBeenCalled();
    const order: string[] = [];
    mocks.uploadChunk.mockImplementation(async () => { order.push("chunk"); });
    mocks.api.mockImplementation(async (_path, init) => {
      const objects = JSON.parse(init.body).objects as ObjectUploadAttempt[];
      order.push(objects[0].objectType);
      return { results: objects.map((object) => ({ objectId: object.objectId, status: "accepted", revision: object.baseRevision + 1 })) };
    });
    await pushVaultPending(dependencies);
    expect(order).toEqual(["chunk", "attachment", "note"]);
    expect(await localDb.attachmentOutbox.count()).toBe(0);
  });

  it("does not send a referencing note after its attachment manifest conflicts", async () => {
    await seed(attachmentEntry());
    await seed(entry("note"));
    mocks.api.mockResolvedValue({ results: [{ objectId: attachmentId, status: "conflict", currentRevision: 5, reason: "revision" }] });
    const dependencies = pushDependencies(); await pushVaultPending(dependencies);
    expect(mocks.api).toHaveBeenCalledOnce(); expect(dependencies.onConflict).toHaveBeenCalledOnce();
    expect(await localDb.outbox.get(key)).toBeDefined();
  });

  it("preserves exact requests when a batch returns an error", async () => {
    const first = entry("note"); await seed(first);
    mocks.api.mockRejectedValue(new ApiError("quota", 413));
    await expect(pushVaultPending(pushDependencies())).rejects.toThrow("quota");
    expect((await localDb.outbox.get(key))?.upload).toEqual(first);
  });

  it("does not commit an acknowledgement after the vault becomes inactive during crypto", async () => {
    const first = entry("first"); const second = entry("second"); await seed(second);
    const gate = deferred<ReturnType<typeof envelope>>(); mocks.encrypt.mockReturnValueOnce(gate.promise);
    let active = true;
    const acknowledgement = acknowledgeOutboxEntry(userId, first, 4, () => ++generation, cryptoClient, () => active);
    await vi.waitFor(() => expect(mocks.encrypt).toHaveBeenCalledOnce());
    active = false; gate.resolve(envelope(plain(document("second"))));
    expect(await acknowledgement).toEqual({ status: "missing" });
    expect(await localDb.outbox.get(key)).toEqual(second);
  });
});
