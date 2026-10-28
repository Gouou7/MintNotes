import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localDb } from "./database";
import { ensureBodyBlocks, persistBodyBlocks, uploadBodyBlocks } from "./noteBodies";
import { api } from "../api";
import type { EncryptedObject } from "@mint-notes/application-client";
vi.mock("../api", () => ({ api: vi.fn() }));
afterEach(async () => { vi.clearAllMocks(); for (const table of localDb.tables) await table.clear(); });
describe("durable note body transfer", () => {
  it("keeps blocks pending until an exact acknowledgement and retries the same bytes", async () => {
    const block = { blockId: crypto.randomUUID(), ciphertext: "encrypted block", nonce: "nonce" };
    const note: EncryptedObject = { objectId: crypto.randomUUID(), objectType: "note", ciphertext: "encrypted manifest", nonce: "manifest nonce", encryptionVersion: 2, revision: 1, deleted: false, bodyBlockIds: [block.blockId] };
    await localDb.transaction("rw", localDb.bodyBlocks, () => persistBodyBlocks("user", note.objectId, { ...note, bodyBlocks: [block] }));
    vi.mocked(api).mockResolvedValueOnce({ accepted: [] });
    await expect(uploadBodyBlocks("user", note, () => true)).rejects.toThrow("Invalid body block acknowledgement");
    expect((await localDb.bodyBlocks.toArray())[0].uploaded).not.toBe(true);
    vi.mocked(api).mockResolvedValueOnce({ accepted: [block.blockId] });
    await uploadBodyBlocks("user", note, () => true);
    expect((await localDb.bodyBlocks.toArray())[0].uploaded).toBe(true);
    expect(vi.mocked(api).mock.calls[0]).toEqual(vi.mocked(api).mock.calls[1]);
    await uploadBodyBlocks("user", note, () => true);
    expect(api).toHaveBeenCalledTimes(2);
  });
  it("stages downloaded bytes without publishing an unverified cache entry", async () => {
    const block = { blockId: crypto.randomUUID(), ciphertext: "possibly corrupted", nonce: "nonce" };
    const note: EncryptedObject = { objectId: crypto.randomUUID(), objectType: "note", ciphertext: "manifest", nonce: "nonce", encryptionVersion: 2, revision: 2, deleted: false, bodyBlockIds: [block.blockId] };
    vi.mocked(api).mockResolvedValueOnce({ blocks: [block] });
    expect(await ensureBodyBlocks("user", note, () => true)).toEqual([block]);
    expect(await localDb.bodyBlocks.count()).toBe(0);
    vi.mocked(api).mockResolvedValueOnce({ blocks: [block] });
    await ensureBodyBlocks("user", note, () => true);
    expect(api).toHaveBeenCalledTimes(2);
  });
});
