import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureAttachmentChunks } from "./attachments";
import type { OpenAttachment } from "../types";

const mocks = vi.hoisted(() => ({ stored: vi.fn(), download: vi.fn(), bulkPut: vi.fn() }));
vi.mock("../api", () => ({ downloadAttachmentChunk: mocks.download }));
vi.mock("../crypto/client", () => ({ cryptoClient: {} }));
vi.mock("../storage/database", () => ({
  chunkKey: (userId: string, attachmentId: string, index: number) => `${userId}:${attachmentId}:${index}`,
  localKey: (userId: string, objectId: string) => `${userId}:${objectId}`,
  localDb: {
    attachmentChunks: {
      where: () => ({ equals: () => ({ toArray: mocks.stored }) }),
      bulkPut: mocks.bulkPut
    }
  }
}));

const attachment = {
  objectId: "attachment", originalName: "image.png", chunkCount: 1
} as OpenAttachment;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stored.mockResolvedValue([]);
  mocks.download.mockResolvedValue({
    ciphertext: new ArrayBuffer(8), nonce: "nonce", totalChunks: 1, encryptionVersion: 1
  });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
});
afterEach(() => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("attachment download connectivity", () => {
  it("downloads and caches missing chunks for a verified session despite a browser offline hint", async () => {
    const chunks = await ensureAttachmentChunks("user", attachment, undefined, true);
    expect(mocks.download).toHaveBeenCalledWith("/api/attachments/attachment/chunks/0", undefined);
    expect(mocks.bulkPut).toHaveBeenCalledOnce();
    expect(chunks).toHaveLength(1);
  });

  it("does not download missing chunks when server access has not been authorized", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await expect(ensureAttachmentChunks("user", attachment, undefined, false)).rejects.toThrow("尚未缓存");
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.bulkPut).not.toHaveBeenCalled();
  });

  it("continues to read cached chunks with server access disabled", async () => {
    mocks.stored.mockResolvedValue([{
      userId: "user", attachmentId: "attachment", chunkIndex: 0, totalChunks: 1,
      ciphertext: new ArrayBuffer(8), nonce: "nonce", encryptionVersion: 1
    }]);
    const chunks = await ensureAttachmentChunks("user", attachment, undefined, false);
    expect(chunks).toHaveLength(1);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("does not cache partial results after a real transport failure", async () => {
    mocks.download.mockRejectedValueOnce(new TypeError("unreachable"));
    await expect(ensureAttachmentChunks("user", attachment, undefined, true)).rejects.toThrow("unreachable");
    expect(mocks.bulkPut).not.toHaveBeenCalled();
  });
});
