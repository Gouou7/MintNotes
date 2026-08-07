import { afterEach, describe, expect, it, vi } from "vitest";
import type { CryptoClient } from "../../crypto/client";
import { localDb, type HistoryMetadataOutboxEntry } from "../../storage/database";
import type { HistoryListItem, NoteHistoryMetadataPayload } from "../../types";
import { VaultHistoryController } from "./historyController";

vi.mock("../../crypto/client", () => ({ cryptoClient: {} }));

afterEach(() => vi.restoreAllMocks());

const item: HistoryListItem = {
  historyId: "history-a",
  noteId: "note-a",
  capturedAt: "2026-08-08T12:00:00.000Z",
  captureKind: "manual",
  name: "Original",
  protected: false,
  byteSize: 256,
  pending: false,
  metadataCiphertext: "old-metadata",
  metadataNonce: "old-nonce",
  metadataEncryptionVersion: 1
};

const metadata: NoteHistoryMetadataPayload = {
  schemaVersion: 1,
  name: "Original",
  attachmentIds: ["attachment-a"]
};

describe("VaultHistoryController metadata queue", () => {
  it("durably queues an offline protection change without downloading the full snapshot", async () => {
    const encryptHistoryMetadata = vi.fn().mockResolvedValue({
      ciphertext: "new-metadata",
      nonce: "new-nonce",
      encryptionVersion: 1
    });
    const putIndex = vi.spyOn(localDb.historyIndex, "put").mockResolvedValue(item.historyId);
    const putMutation = vi.spyOn(localDb.historyMetadataOutbox, "put").mockResolvedValue(item.historyId);
    vi.spyOn(localDb.historyMetadataOutbox, "get").mockResolvedValue(undefined);
    vi.spyOn(localDb.historySnapshots, "put").mockResolvedValue(item.historyId);
    vi.spyOn(localDb, "transaction").mockImplementation((...arguments_: unknown[]) => {
      const scope = arguments_.at(-1) as () => Promise<void>;
      return scope() as never;
    });
    const controller = new VaultHistoryController({
      userId: "user-a",
      nextGeneration: () => 7,
      isActive: () => true,
      crypto: { encryptHistoryMetadata } as unknown as CryptoClient
    });

    const updated = await controller.queueMetadataUpdate(item, null, metadata, { protected: true });

    expect(updated.snapshot).toBeUndefined();
    expect(updated.item).toMatchObject({ protected: true, pending: true, name: "Original" });
    expect(putIndex).toHaveBeenCalledWith(expect.objectContaining({
      protected: true,
      metadataCiphertext: "new-metadata",
      pending: true
    }));
    expect(putMutation).toHaveBeenCalledWith(expect.objectContaining({
      protected: true,
      generation: 7,
      metadataCiphertext: "new-metadata"
    }));
  });

  it("keeps an unsynchronized protection change when a later rename replaces its generation", async () => {
    const previous = {
      key: "user-a:note-a:history-a",
      userId: "user-a",
      noteId: "note-a",
      historyId: "history-a",
      capturedAt: item.capturedAt,
      metadataCiphertext: "protected-metadata",
      metadataNonce: "protected-nonce",
      metadataEncryptionVersion: 1,
      protected: true,
      generation: 6
    } satisfies HistoryMetadataOutboxEntry;
    vi.spyOn(localDb.historyMetadataOutbox, "get").mockResolvedValue(previous);
    const putMutation = vi.spyOn(localDb.historyMetadataOutbox, "put").mockResolvedValue(item.historyId);
    vi.spyOn(localDb.historyIndex, "put").mockResolvedValue(item.historyId);
    vi.spyOn(localDb.historySnapshots, "put").mockResolvedValue(item.historyId);
    vi.spyOn(localDb, "transaction").mockImplementation((...arguments_: unknown[]) => {
      const scope = arguments_.at(-1) as () => Promise<void>;
      return scope() as never;
    });
    const controller = new VaultHistoryController({
      userId: "user-a",
      nextGeneration: () => 8,
      isActive: () => true,
      crypto: {
        encryptHistoryMetadata: vi.fn().mockResolvedValue({
          ciphertext: "renamed-metadata",
          nonce: "renamed-nonce",
          encryptionVersion: 1
        })
      } as unknown as CryptoClient
    });

    await controller.queueMetadataUpdate({ ...item, protected: true }, null, metadata, { name: "Renamed" });

    expect(putMutation).toHaveBeenCalledWith(expect.objectContaining({
      protected: true,
      generation: 8
    }));
  });
});
