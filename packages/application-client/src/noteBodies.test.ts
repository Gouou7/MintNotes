// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decodeVaultObject, encodeVaultObject, splitNoteBody } from "./noteBodies.js";
import { open, seal, objectAad } from "./crypto.js";
import type { EncryptedObject, EncryptedNoteBodyBlock, VaultDocument } from "./types.js";

const user = crypto.randomUUID(), noteId = crypto.randomUUID();
const key = crypto.getRandomValues(new Uint8Array(32));
const blocks = new Map<string, EncryptedNoteBodyBlock>();
const read = async (_note: string, id: string) => { const value = blocks.get(id); if (!value) throw new Error("missing"); return value; };
function document(markdown: string): VaultDocument {
  return { kind: "note", title: "Title", markdown, tags: [], attachmentIds: [], parentId: null,
    favorite: false, locked: false, deleted: false, manualOrder: 0, schemaVersion: 2,
    createdAt: "2026-10-28T00:00:00.000Z", updatedAt: "2026-10-28T00:00:00.000Z" };
}
async function encode(value: VaultDocument, revision = 1, previous?: EncryptedObject, enabled = true) {
  const encoding = await encodeVaultObject(key, user, noteId, "note", revision, value, read, previous, enabled);
  for (const block of encoding.bodyBlocks ?? []) blocks.set(block.blockId, block);
  return { ...encoding, objectId: noteId, objectType: "note" as const, revision, deleted: value.deleted };
}
function fixture(length: number) {
  let state = 12983, result = "---\r\ntitle: 'Long'\r\n---\r\n# 中文😀\r\n```ts\r\n";
  while (result.length < length) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; result += `${state.toString(36)} text\r\n`; }
  return result + "```\r\n![image](webmd-attachment:00000000-0000-4000-8000-000000000001)\n\ud800";
}
describe("encrypted note bodies", () => {
  it("keeps oversized legacy offline proposals readable without relaxing new write limits", async () => {
    const legacy = document("x".repeat(1_600_000));
    const sealed = await seal(new TextEncoder().encode(JSON.stringify(legacy)), key, objectAad(user, noteId, "note", 1));
    const object = { ...sealed, objectId: noteId, objectType: "note" as const, revision: 1, deleted: false, encryptionVersion: 1 };
    expect((await decodeVaultObject(key, user, object, read) as VaultDocument).markdown).toBe(legacy.markdown);
    await expect(encode(legacy)).rejects.toThrow("Note exceeds object size limit");
  });
  it("round trips exact Unicode, CRLF, code, references and unpaired surrogates", async () => {
    const original = document(fixture(280_000));
    const object = await encode(original);
    expect(object.encryptionVersion).toBe(2);
    expect((await decodeVaultObject(key, user, object, read))).toEqual(original);
    expect(object.bodyBlocks!.every((block) => !JSON.stringify(block).includes("webmd-attachment"))).toBe(true);
    expect(Buffer.concat(splitNoteBody(new TextEncoder().encode(JSON.stringify(original.markdown))).map((b) => Buffer.from(b))))
      .toEqual(Buffer.from(JSON.stringify(original.markdown)));
  });
  it("preserves the legacy envelope and converts only on a real body edit", async () => {
    const value = document(fixture(180_000));
    const old = await encode(value, 1, undefined, false);
    expect(old.encryptionVersion).toBe(1);
    const renamed = await encode({ ...value, title: "Renamed" }, 2, old);
    expect(renamed.encryptionVersion).toBe(1);
    const changed = await encode({ ...value, markdown: value.markdown + " edited" }, 3, renamed);
    expect(changed.encryptionVersion).toBe(2);
    const short = await encode(document("short"), 4, changed, false);
    expect(short.encryptionVersion).toBe(2);
    expect(await decodeVaultObject(key, user, short, read)).toEqual(document("short"));
  });
  it("reuses stable suffix blocks after a prefix insertion and changes no blocks for metadata", async () => {
    const value = document(fixture(1_000_000));
    const old = await encode(value);
    const changed = await encode({ ...value, markdown: "prefix\n" + value.markdown }, 2, old);
    expect(changed.bodyBlocks!.reduce((n, block) => n + block.ciphertext.length, 0)).toBeLessThan(200_000);
    expect(changed.bodyBlockIds!.filter((id) => old.bodyBlockIds!.includes(id)).length).toBeGreaterThan(10);
    const renamed = await encode({ ...value, markdown: "prefix\n" + value.markdown, title: "Renamed" }, 3, changed);
    expect(renamed.bodyBlocks).toEqual([]);
    expect(await decodeVaultObject(key, user, renamed, read)).toEqual({ ...value, markdown: "prefix\n" + value.markdown, title: "Renamed" });
  });
  it("rejects missing, substituted, cross-note blocks and unbound references", async () => {
    const object = await encode(document(fixture(260_000)));
    await expect(decodeVaultObject(key, user, object, async () => { throw new Error("missing"); })).rejects.toThrow();
    await expect(decodeVaultObject(key, user, object, async () => object.bodyBlocks![1])).rejects.toThrow();
    await expect(decodeVaultObject(key, user, { ...object, objectId: crypto.randomUUID() }, read)).rejects.toThrow();
    await expect(decodeVaultObject(key, user, { ...object, bodyBlockIds: object.bodyBlockIds!.slice(1) }, read)).rejects.toThrow();
    const damaged = { ...object.bodyBlocks![0], ciphertext: "A".repeat(object.bodyBlocks![0].ciphertext.length) };
    await expect(decodeVaultObject(key, user, object, async (_note, id) => id === damaged.blockId ? damaged : read(_note, id))).rejects.toThrow();
  });
  it("authenticates ordered descriptors, total digest and body lengths", async () => {
    const object = await encode(document(fixture(240_000)));
    const aad = `webmd:${user}:${noteId}:note-manifest:schema:v1:encryption:v2:r1`;
    const decoded = JSON.parse(new TextDecoder().decode(await open(object.ciphertext, object.nonce, key, aad)));
    for (const mutate of [
      (value: any) => value.body.blocks.reverse(),
      (value: any) => value.body.blocks.push(value.body.blocks[0]),
      (value: any) => value.body.length++,
      (value: any) => value.body.digest = "invalid"
    ]) {
      const value = structuredClone(decoded); mutate(value);
      const sealed = await seal(new TextEncoder().encode(JSON.stringify(value)), key, aad);
      await expect(decodeVaultObject(key, user, { ...object, ...sealed }, read)).rejects.toThrow();
    }
  });
  it("reconstructs independently authored branches after seeded proposal serialization", async () => {
    const original = document(fixture(256_000));
    let server = await encode(original), state = 731;
    const retained: EncryptedObject[] = [];
    for (let round = 0; round < 20; round++) {
      const base = server;
      const branches = await Promise.all([0, 1].map(async (device) => {
        const text = `device=${device} round=${round}\n` + original.markdown;
        const object = await encode(document(text), base.revision + 1, base);
        // Verify the encoding remains self-contained after proposal serialization.
        return { text, object: JSON.parse(JSON.stringify(object)) as EncryptedObject };
      }));
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const winner = state % 2;
      server = branches[winner].object;
      retained.push(branches[1 - winner].object);
      for (const branch of branches) expect((await decodeVaultObject(key, user, branch.object, read) as VaultDocument).markdown).toBe(branch.text);
      // Repeated decoding cannot alter either encrypted branch.
      expect(await decodeVaultObject(key, user, JSON.parse(JSON.stringify(server)), read)).toEqual(await decodeVaultObject(key, user, server, read));
    }
    expect(retained).toHaveLength(20);
    for (const object of retained) expect((await decodeVaultObject(key, user, object, read)).kind).toBe("note");
  }, 30_000);
});
