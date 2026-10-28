import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDb, localKey, type RecoveryRecord } from "../../storage/database";
import { exportRecoveryCopies } from "./recoveryExport";

const mocks = vi.hoisted(() => ({ decrypt: vi.fn(), attachment: vi.fn(), zip: vi.fn() }));
vi.mock("../../crypto/client", () => ({ cryptoClient: { decryptObject: mocks.decrypt, decryptAttachment: mocks.attachment } }));
vi.mock("../importExport", () => ({ exportMarkdownZip: mocks.zip }));
beforeEach(async () => { vi.resetAllMocks(); for (const table of localDb.tables) await table.clear(); });
afterEach(async () => { for (const table of localDb.tables) await table.clear(); });
async function attachmentRecovery() {
  const userId = "export-user", objectId = crypto.randomUUID(), ownerNoteId = crypto.randomUUID();
  const metadata = { kind: "attachment", schemaVersion: 2, ownerNoteId, originalName: "original.png", mime: "image/png",
    attachmentKey: "encrypted-fixture-key", sha256: "fixture-digest", size: 3, chunkSize: 1024 * 1024, chunkCount: 1,
    createdAt: "2026-10-28", updatedAt: "2026-10-28", deleted: false };
  const source = { key: localKey(userId, objectId), userId, objectId, objectType: "attachment" as const, ownerNoteId,
    ciphertext: "encrypted attachment metadata", nonce: "nonce", encryptionVersion: 1, revision: 1, deleted: false,
    updatedAt: "2026-10-28", operation: "upsert" as const, baseRevision: 0, idempotencyKey: "retained-attachment", generation: 1 };
  const record: RecoveryRecord = { key: localKey(userId, source.idempotencyKey), userId, sourceId: objectId,
    copyId: crypto.randomUUID(), source, attachments: [source], chunks: [{ key: localKey(userId, `${objectId}:0`), userId,
      attachmentId: objectId, ownerNoteId, chunkIndex: 0, totalChunks: 1, ciphertext: new Uint8Array([4, 5, 6]).buffer,
      nonce: "nonce", encryptionVersion: 1, updatedAt: "2026-10-28" }] };
  await localDb.recoveries.add(record);
  mocks.decrypt.mockResolvedValue(metadata);
  mocks.attachment.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  return record;
}
describe("recovery source export", () => {
  it("exports an attachment-only recovery as a visible Markdown note and its exact bytes", async () => {
    const record = await attachmentRecovery();
    await exportRecoveryCopies(record.userId, () => true);
    const [notes, attachments, read] = mocks.zip.mock.calls[0];
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: "note", title: "original.png", deleted: false });
    expect(notes[0].markdown).toContain(`webmd-attachment:${record.sourceId}`);
    expect(attachments).toHaveLength(1);
    expect(new Uint8Array(await (await read(attachments[0])).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(await localDb.recoveries.get(record.key)).toEqual(record);
  });
  it("fails the export without releasing the journal when attachment decryption fails", async () => {
    const record = await attachmentRecovery();
    mocks.attachment.mockRejectedValue(new Error("incomplete attachment"));
    mocks.zip.mockImplementation(async (_notes, attachments, read) => { await read(attachments[0]); });
    await expect(exportRecoveryCopies(record.userId, () => true)).rejects.toThrow("incomplete attachment");
    expect(await localDb.recoveries.get(record.key)).toEqual(record);
  });
  it("does not decrypt or export after the vault becomes inactive", async () => {
    const record = await attachmentRecovery();
    await expect(exportRecoveryCopies(record.userId, () => false)).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.zip).not.toHaveBeenCalled();
    expect(await localDb.recoveries.count()).toBe(1);
  });
});
