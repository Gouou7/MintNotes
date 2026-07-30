import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenDocument } from "../../types";
import { useObjectPersistence, type ObjectPersistenceOptions } from "./useObjectPersistence";

const mocks = vi.hoisted(() => ({
  encryptObject: vi.fn(),
  outboxGet: vi.fn(),
  objectPut: vi.fn(),
  outboxPut: vi.fn(),
  transaction: vi.fn()
}));

vi.mock("../../crypto/client", () => ({
  cryptoClient: { encryptObject: mocks.encryptObject }
}));

vi.mock("../../storage/database", () => ({
  localKey: (userId: string, objectId: string) => `${userId}:${objectId}`,
  localDb: {
    objects: { put: mocks.objectPut },
    outbox: { get: mocks.outboxGet, put: mocks.outboxPut },
    transaction: mocks.transaction
  }
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

function note(markdown: string): OpenDocument {
  return {
    objectId: "note-1",
    kind: "note",
    title: "Note",
    markdown,
    parentId: null,
    tags: [],
    favorite: false,
    locked: false,
    deleted: false,
    createdAt: "2026-07-30T01:00:00.000Z",
    updatedAt: "2026-07-30T02:00:00.000Z",
    manualOrder: 0,
    attachmentIds: [],
    schemaVersion: 2,
    serverRevision: 3,
    dirty: true
  };
}

describe("useObjectPersistence", () => {
  it("does not let an older durable completion replace edits still waiting in memory", async () => {
    let releaseEncryption!: (value: { ciphertext: string; nonce: string; encryptionVersion: number }) => void;
    mocks.encryptObject.mockReturnValue(new Promise((resolve) => { releaseEncryption = resolve; }));
    mocks.outboxGet.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<void>;
      await callback();
    });

    const persisted = note("first durable snapshot");
    const newer = note("newer edit still inside the debounce window");
    let current = persisted;
    const upsertDocument = vi.fn();
    const setSaveState = vi.fn();
    let persistObject!: (
      object: OpenDocument,
      options?: ObjectPersistenceOptions
    ) => Promise<OpenDocument>;

    function Harness() {
      ({ persistObject } = useObjectPersistence({
        userId: "user-1",
        generation: { current: 0 },
        isActive: () => true,
        canSynchronize: () => true,
        setSaveState,
        onPersistenceError: vi.fn(),
        onPersistenceSuccess: vi.fn(),
        upsertDocument,
        upsertAttachment: vi.fn()
      }));
      return null;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Harness />));

    let write!: Promise<OpenDocument>;
    act(() => {
      write = persistObject(persisted, {
        commitState: () => current === persisted
      });
    });
    await vi.waitFor(() => expect(mocks.encryptObject).toHaveBeenCalledOnce());

    current = newer;
    releaseEncryption({
      ciphertext: "ciphertext",
      nonce: "nonce",
      encryptionVersion: 1
    });
    await act(async () => { await write; });

    expect(mocks.objectPut).toHaveBeenCalledOnce();
    expect(mocks.outboxPut).toHaveBeenCalledOnce();
    expect(upsertDocument).not.toHaveBeenCalled();
    expect(setSaveState).toHaveBeenCalledOnce();
    expect(setSaveState).toHaveBeenCalledWith("saving");
    expect(current.markdown).toBe("newer edit still inside the debounce window");
  });
});
