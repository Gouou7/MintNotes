// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApplicationStore, type Operation } from "./store.js";

const resources: { directory: string; store: ApplicationStore }[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "mint-body-cache-"));
  const connection = crypto.randomUUID();
  const store = new ApplicationStore(directory, "https://notes.example.test", connection);
  const resource = { directory, store }; resources.push(resource);
  return { resource, connection };
}
afterEach(() => { for (const resource of resources.splice(0)) { resource.store.close(); rmSync(resource.directory, { recursive: true, force: true }); } });
describe("native encrypted cache compatibility", () => {
  it.each([1, 2])("preserves cache v%i proposals, operation identity and cursor", (version) => {
    const { resource, connection } = fixture();
    const note = { objectId: crypto.randomUUID(), objectType: "note" as const, ciphertext: "original encrypted body", nonce: "nonce",
      encryptionVersion: 1, revision: 1, baseRevision: 0, idempotencyKey: "unchanged-operation", deleted: false };
    const operation: Operation = { operationId: "unchanged-operation", requestHash: "unchanged-hash", body: { note, sourceAttachments: [] }, result: { operationId: "unchanged-operation", objectId: note.objectId, status: "pending" } };
    resource.store.stage(operation); resource.store.set("cursor", 42);
    resource.store.db.exec(`DROP TABLE body_blocks; PRAGMA user_version = ${version}`);
    resource.store.close();
    resource.store = new ApplicationStore(resource.directory, "https://notes.example.test", connection);
    expect(resource.store.operation(operation.operationId)).toEqual(operation);
    expect(resource.store.object(note.objectId)).toEqual(note);
    expect(resource.store.get("cursor")).toBe(42);
    expect(resource.store.db.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
  });
  it("compares immutable ciphertext independently of JSON property order", () => {
    const { resource } = fixture();
    const note = crypto.randomUUID(), block = { blockId: crypto.randomUUID(), ciphertext: "cipher", nonce: "nonce" };
    resource.store.putBodyBlock(note, block);
    expect(() => resource.store.putBodyBlock(note, { nonce: block.nonce, ciphertext: block.ciphertext, blockId: block.blockId })).not.toThrow();
    expect(() => resource.store.putBodyBlock(note, { ...block, ciphertext: "different" })).toThrow("Immutable body block mismatch");
    expect(resource.store.bodyBlock(note, block.blockId)).toEqual(block);
  });
  it("keeps the previous cache and cursor when SQLITE_FULL interrupts atomic proposal staging", () => {
    const { resource } = fixture();
    const store = resource.store, objectId = crypto.randomUUID();
    const original = { objectId, objectType: "note" as const, ciphertext: "original encrypted body", nonce: "nonce", encryptionVersion: 1, revision: 1, deleted: false };
    store.putObject(original); store.set("cursor", 42);
    const blocks = [{ blockId: crypto.randomUUID(), ciphertext: "a".repeat(80_000), nonce: "nonce" }];
    const note = { ...original, ciphertext: "new encrypted manifest", encryptionVersion: 2, revision: 2, baseRevision: 1,
      idempotencyKey: "retained-request", bodyBlockIds: blocks.map((block) => block.blockId), bodyBlocks: blocks };
    const operation: Operation = { operationId: note.idempotencyKey, requestHash: "unchanged-request-hash", body: { note, sourceAttachments: [] },
      result: { operationId: note.idempotencyKey, objectId, status: "pending" } };
    const pages = Number(store.db.prepare("PRAGMA page_count").get()?.page_count);
    store.db.exec(`PRAGMA max_page_count = ${pages}`);
    expect(() => store.stage(operation)).toThrow(/database or disk is full/);
    expect(store.object(objectId)).toEqual(original);
    expect(store.operation(operation.operationId)).toBeNull();
    expect(store.bodyBlock(objectId, blocks[0].blockId)).toBeNull();
    expect(store.get("cursor")).toBe(42);
    expect(store.db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
    store.db.exec(`PRAGMA max_page_count = ${pages + 128}`);
    store.stage(operation);
    expect(store.operation(operation.operationId)).toEqual(operation);
    expect(store.object(objectId)).toEqual(note);
  });
});
