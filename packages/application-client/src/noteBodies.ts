import type { EncryptedNoteBodyBlock, EncryptedObject, EncryptedObjectEncoding, VaultObject, VaultDocument } from "./types.js";
import { b64, fromB64, open, seal, objectAad, ownedBuffer } from "./crypto.js";
import { validateVaultObject } from "./policy.js";

export const BODY_THRESHOLD = 128 * 1024;
export const BODY_BLOCK_MAX = 64 * 1024;
export type BodyBlockReader = (noteId: string, blockId: string) => Promise<EncryptedNoteBodyBlock>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (): never => { throw new Error("Invalid note body graph"); };
interface Descriptor { blockId: string; length: number; digest: string; }
interface Manifest { format: "json-string-utf8-v1"; length: number; digest: string; blocks: Descriptor[]; }
const manifestAad = (user: string, note: string, revision: number) => `webmd:${user}:${note}:note-manifest:schema:v1:encryption:v2:r${revision}`;
const blockAad = (user: string, note: string, id: string) => `webmd:${user}:${note}:${id}:note-body-block:schema:v1:encryption:v1:r1`;
const hash = async (bytes: Uint8Array) => b64(new Uint8Array(await crypto.subtle.digest("SHA-256", ownedBuffer(bytes))));

/** Adapted from MIT LiveSync Commonlib 3e1a5e1dfd7d8da14009b66c7a3b8155986f92cb.
 * The continuous 48-byte window is independent of the last chunk boundary.
 * Copyright (c) 2022 vorotamoroz. See THIRD_PARTY_NOTICES.txt.
 */
export function splitNoteBody(bytes: Uint8Array): Uint8Array[] {
  let power = 1;
  for (let i = 0; i < 47; i++) power = Math.imul(power, 31);
  let rolling = 0, start = 0;
  const result: Uint8Array[] = [];
  for (let pos = 0; pos < bytes.length; pos++) {
    if (pos >= 48) rolling = (rolling - Math.imul(bytes[pos - 48], power)) | 0;
    rolling = (Math.imul(rolling, 31) + bytes[pos]) | 0;
    const length = pos - start + 1;
    if (length >= BODY_BLOCK_MAX || (length >= 16 * 1024 && (rolling >>> 0) % (16 * 1024) === 1)) {
      result.push(bytes.subarray(start, pos + 1)); start = pos + 1;
    }
  }
  if (start < bytes.length) result.push(bytes.subarray(start));
  return result;
}

async function readManifest(key: Uint8Array, user: string, object: EncryptedObject): Promise<{ value: Record<string, unknown>; body: Manifest }> {
  if (object.objectType !== "note" || object.encryptionVersion !== 2 || !Number.isSafeInteger(object.revision) || object.revision < 1) fail();
  const bytes = await open(object.ciphertext, object.nonce, key, manifestAad(user, object.objectId, object.revision));
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const body = value.body as Manifest;
    if (value.schemaVersion !== 3 || value.markdown !== undefined || body?.format !== "json-string-utf8-v1"
      || !Number.isSafeInteger(body.length) || body.length < 2 || body.length > 1_500_000
      || typeof body.digest !== "string" || !Array.isArray(body.blocks) || !body.blocks.length || body.blocks.length > 1000) fail();
    for (const descriptor of body.blocks) if (!descriptor || !uuid.test(descriptor.blockId)
      || !Number.isSafeInteger(descriptor.length) || descriptor.length < 1 || descriptor.length > BODY_BLOCK_MAX
      || typeof descriptor.digest !== "string") fail();
    const ids = [...new Set(body.blocks.map((entry) => entry.blockId))].sort();
    if (!Array.isArray(object.bodyBlockIds) || new Set(object.bodyBlockIds).size !== object.bodyBlockIds.length
      || JSON.stringify(ids) !== JSON.stringify([...object.bodyBlockIds].sort())
      || body.blocks.reduce((sum, entry) => sum + entry.length, 0) !== body.length) fail();
    return { value, body };
  } finally { bytes.fill(0); }
}

export async function decodeVaultObject(key: Uint8Array, user: string, object: EncryptedObject, read: BodyBlockReader): Promise<VaultObject> {
  if (!Number.isSafeInteger(object.revision) || object.revision < 1) fail();
  let value: unknown;
  if (object.encryptionVersion === 1) {
    if (object.bodyBlockIds?.length) fail();
    const bytes = await open(object.ciphertext, object.nonce, key, objectAad(user, object.objectId, object.objectType, object.revision));
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    finally { bytes.fill(0); }
  } else {
    const { value: metadata, body } = await readManifest(key, user, object);
    const full = new Uint8Array(body.length);
    try {
      let offset = 0;
      for (const descriptor of body.blocks) {
        const block = await read(object.objectId, descriptor.blockId);
        if (block.blockId !== descriptor.blockId || fromB64(block.ciphertext).length > BODY_BLOCK_MAX + 16) fail();
        const bytes = await open(block.ciphertext, block.nonce, key, blockAad(user, object.objectId, block.blockId));
        try {
          if (bytes.length !== descriptor.length || await hash(bytes) !== descriptor.digest) fail();
          full.set(bytes, offset); offset += bytes.length;
        } finally { bytes.fill(0); }
      }
      if (await hash(full) !== body.digest) fail();
      const markdown: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(full));
      if (typeof markdown !== "string") fail();
      const { body: _body, ...plain } = metadata;
      value = { ...plain, markdown, schemaVersion: 2 };
    } finally { full.fill(0); }
  }
  const result = validateVaultObject(value, object.objectType);
  if (result.deleted !== object.deleted) fail();
  // Same payload limit as the original base64url AES-GCM envelope.
  // Legacy offline proposals may predate the server write limit. They must remain
  // readable/exportable even when the server cannot accept their size.
  if (object.encryptionVersion === 2 && Math.ceil((new TextEncoder().encode(JSON.stringify(result)).length + 16) * 4 / 3) > 2_000_000) fail();
  return result;
}

export async function encodeVaultObject(key: Uint8Array, user: string, id: string, type: string, revision: number,
  object: VaultObject, read: BodyBlockReader, previous?: EncryptedObject, enabled = true): Promise<EncryptedObjectEncoding> {
  const raw = new TextEncoder().encode(JSON.stringify(object));
  if (Math.ceil((raw.length + 16) * 4 / 3) > 2_000_000) throw new Error("Note exceeds object size limit");
  if (previous && (previous.objectId !== id || previous.objectType !== type)) fail();
  const old = previous ? await decodeVaultObject(key, user, previous, read) : undefined;
  const bodyBytes = object.kind === "note" ? new TextEncoder().encode(JSON.stringify(object.markdown)) : undefined;
  const chunked = object.kind === "note" && (previous?.encryptionVersion === 2
    || (enabled && (bodyBytes?.length ?? 0) >= BODY_THRESHOLD && (!old || old.kind !== "note" || old.markdown !== object.markdown)));
  if (!chunked) {
    try { return { ...await seal(raw, key, objectAad(user, id, type, revision)), encryptionVersion: 1 }; }
    finally { raw.fill(0); bodyBytes?.fill(0); }
  }
  const reusable = previous?.encryptionVersion === 2 ? (await readManifest(key, user, previous)).body.blocks : [];
  const byDigest = new Map(reusable.map((entry) => [entry.digest, entry]));
  const blocks: Descriptor[] = [], fresh: EncryptedNoteBodyBlock[] = [];
  try {
    for (const bytes of splitNoteBody(bodyBytes!)) {
      const digest = await hash(bytes);
      let descriptor = byDigest.get(digest);
      if (!descriptor || descriptor.length !== bytes.length) {
        const blockId = crypto.randomUUID();
        const block = { blockId, ...await seal(bytes, key, blockAad(user, id, blockId)) };
        fresh.push(block); descriptor = { blockId, length: bytes.length, digest }; byDigest.set(digest, descriptor);
      }
      blocks.push(descriptor);
    }
    const document = object as VaultDocument;
    const { markdown: _markdown, ...metadata } = document;
    const manifest = { ...metadata, schemaVersion: 3, body: { format: "json-string-utf8-v1", length: bodyBytes!.length, digest: await hash(bodyBytes!), blocks } };
    const encoded = new TextEncoder().encode(JSON.stringify(manifest));
    try {
      const result = { ...await seal(encoded, key, manifestAad(user, id, revision)), encryptionVersion: 2,
        bodyBlockIds: [...new Set(blocks.map((entry) => entry.blockId))], bodyBlocks: fresh };
      const created = new Map(fresh.map((block) => [block.blockId, block]));
      const restored = await decodeVaultObject(key, user, { ...result, objectId: id, objectType: "note", revision, deleted: object.deleted },
        async (note, blockId) => created.get(blockId) ?? read(note, blockId));
      if (JSON.stringify(restored) !== JSON.stringify(validateVaultObject(object, type))) {
        // Object key order is not semantic; markdown equality is strict.
        if (restored.kind !== "note" || restored.markdown !== document.markdown) fail();
      }
      return result;
    } finally { encoded.fill(0); }
  } finally { raw.fill(0); bodyBytes!.fill(0); }
}
