import type { ApplicationConnectionBootstrap, ApplicationCredential, VaultEnvelope } from "./protocol.js";
import type { EncryptedObject, VaultObject, VaultAttachment, EncryptedAttachmentChunk } from "./types.js";
import { ApplicationError } from "./protocol.js";
import { validateVaultObject } from "./policy.js";
const ENCRYPTION_VERSION = 1;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function applicationEnvelopeAad(userId: string, connectionId: string): string {
  return `webmd:${userId}:${connectionId}:application-vault-envelope:v1`;
}

export function parseApplicationKey(value: string): { connectionId: string; seed: Uint8Array } {
  const parts = value.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "mint-app-v1" || !uuidPattern.test(parts[1])
    || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) {
    throw new ApplicationError("INVALID_APPLICATION_KEY", "Invalid application key");
  }
  const seed = fromB64(parts[2]);
  if (seed.byteLength !== 32 || b64(seed) !== parts[2]) {
    seed.fill(0);
    throw new ApplicationError("INVALID_APPLICATION_KEY", "Invalid application key");
  }
  return { connectionId: parts[1].toLowerCase(), seed };
}

export async function applicationAuthSecret(applicationKey: string): Promise<{ connectionId: string; authSecret: string }> {
  const { connectionId, seed } = parseApplicationKey(applicationKey);
  try {
    return { connectionId, authSecret: b64(await deriveSubkey(seed, `webmd-application-authentication-v1:${connectionId}`)) };
  } finally { seed.fill(0); }
}

export async function createApplicationCredential(userId: string, vaultKey: Uint8Array): Promise<ApplicationCredential> {
  if (vaultKey.byteLength !== 32) throw new Error("Invalid vault key");
  const snapshot = Uint8Array.from(vaultKey);
  const connectionId = crypto.randomUUID();
  const seed = randomBytes(32);
  let wrappingKey: Uint8Array | undefined;
  try {
    wrappingKey = await deriveSubkey(seed, `webmd-application-vault-wrapping-v1:${connectionId}`);
    return {
      connectionId,
      applicationKey: `mint-app-v1.${connectionId}.${b64(seed)}`,
      authSecret: b64(await deriveSubkey(seed, `webmd-application-authentication-v1:${connectionId}`)),
      vaultEnvelope: { version: 1, ...await seal(snapshot, wrappingKey, applicationEnvelopeAad(userId, connectionId)) }
    };
  } finally { snapshot.fill(0); wrappingKey?.fill(0); seed.fill(0); }
}

export class VaultCipher {
  #key: Uint8Array;
  #disposed = false;
  private requireActive(): void { if (this.#disposed) throw new ApplicationError("CLIENT_STOPPED", "Vault cipher was disposed"); }
  private constructor(private userId: string, key: Uint8Array) { this.#key = key; }

  static async unlock(applicationKey: string, bootstrap: ApplicationConnectionBootstrap): Promise<VaultCipher> {
    const { seed, connectionId } = parseApplicationKey(applicationKey);
    if (bootstrap.protocolVersion !== 1 || bootstrap.objectSchemaVersion !== 2 || bootstrap.encryptionVersion !== 1
      || bootstrap.connection.connectionId !== connectionId || bootstrap.vaultEnvelope.version !== 1) {
      seed.fill(0);
      throw new ApplicationError("PROTOCOL_UNSUPPORTED", "Application protocol is unsupported");
    }
    const wrappingKey = await deriveSubkey(seed, `webmd-application-vault-wrapping-v1:${connectionId}`);
    try {
      const key = await open(bootstrap.vaultEnvelope.ciphertext, bootstrap.vaultEnvelope.nonce,
        wrappingKey, applicationEnvelopeAad(bootstrap.userId, connectionId));
      if (key.byteLength !== 32) { key.fill(0); throw new Error("Invalid vault key"); }
      return new VaultCipher(bootstrap.userId, key);
    } finally { seed.fill(0); wrappingKey.fill(0); }
  }

  async decryptObject(object: EncryptedObject): Promise<VaultObject> {
    this.requireActive();
    if (object.encryptionVersion !== 1 || !Number.isSafeInteger(object.revision) || object.revision < 1) {
      throw new ApplicationError("PROTOCOL_UNSUPPORTED", "Object encryption version is unsupported");
    }
    const bytes = await open(object.ciphertext, object.nonce, this.#key,
      objectAad(this.userId, object.objectId, object.objectType, object.revision));
    try {
      const result = validateVaultObject(JSON.parse(new TextDecoder().decode(bytes)), object.objectType);
      if (result.deleted !== object.deleted) throw new ApplicationError("INVALID_OBJECT", "Object deletion state mismatch");
      return result;
    } finally { bytes.fill(0); }
  }

  async encryptObject(objectId: string, objectType: string, revision: number, object: VaultObject) {
    return { ...await this.encryptJson(object, objectAad(this.userId, objectId, objectType, revision)), encryptionVersion: 1 as const };
  }

  async encryptJson(value: unknown, aad: string): Promise<Omit<VaultEnvelope, "version">> {
    this.requireActive();
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    try { return await seal(bytes, this.#key, aad); } finally { bytes.fill(0); }
  }

  async fingerprint(value: unknown): Promise<string> {
    this.requireActive();
    const digestKey = await deriveSubkey(this.#key, "webmd-application-operation-digest-v1");
    try { return b64(await deriveSubkey(digestKey, canonicalJson(value))); } finally { digestKey.fill(0); }
  }

  dispose(): void { this.#disposed = true; this.#key.fill(0); }
}

export function b64(bytes: Uint8Array): string {
  const stableBytes = Uint8Array.from(bytes);
  let binary = "";
  for (let offset = 0; offset < stableBytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...stableBytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromB64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export async function deriveSubkey(root: Uint8Array, label: string): Promise<Uint8Array> {
  // Keep domain separation outside the Argon2id WASM runtime. HMAC-SHA-256 via
  // Web Crypto is deterministic across fresh workers and copies the root key
  // before the next operation.
  const key = await crypto.subtle.importKey(
    "raw",
    ownedBuffer(root),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(label)));
}

export async function seal(message: Uint8Array, key: Uint8Array, aad: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey("raw", ownedBuffer(key), { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ownedBuffer(nonce), additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    cryptoKey,
    ownedBuffer(message)
  ));
  return { ciphertext: b64(ciphertext), nonce: b64(nonce) };
}

export async function open(ciphertext: string, nonce: string, key: Uint8Array, aad: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", ownedBuffer(key), { name: "AES-GCM" }, false, ["decrypt"]);
  const nonceBytes = fromB64(nonce);
  const ciphertextBytes = fromB64(ciphertext);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ownedBuffer(nonceBytes), additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    cryptoKey,
    ownedBuffer(ciphertextBytes)
  ));
}

export async function sealBinary(message: Uint8Array, key: Uint8Array, aad: string) {
  const nonce = randomBytes(12);
  const cryptoKey = await crypto.subtle.importKey("raw", ownedBuffer(key), { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ownedBuffer(nonce), additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    cryptoKey,
    ownedBuffer(message)
  );
  return { ciphertext, nonce: b64(nonce) };
}

export async function openBinary(ciphertext: ArrayBuffer, nonce: string, key: Uint8Array, aad: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", ownedBuffer(key), { name: "AES-GCM" }, false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ownedBuffer(fromB64(nonce)), additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    cryptoKey,
    ciphertext
  ));
}

export function objectAad(userId: string, objectId: string, objectType: string, revision: number): string {
  return `webmd:${userId}:${objectId}:${objectType}:schema:v2:encryption:v${ENCRYPTION_VERSION}:r${revision}`;
}

export function attachmentChunkAad(userId: string, attachmentId: string, chunkIndex: number, totalChunks: number): string {
  return `webmd:${userId}:${attachmentId}:attachment-chunk:schema:v2:${chunkIndex}:of:${totalChunks}:encryption:v${ENCRYPTION_VERSION}`;
}

export function historyAad(userId: string, noteId: string, historyId: string, capturedAt: string, captureKind: string): string {
  return `webmd:${userId}:${noteId}:note-history:${historyId}:schema:v1:${capturedAt}:${captureKind}:encryption:v${ENCRYPTION_VERSION}`;
}

export function historyMetadataAad(userId: string, noteId: string, historyId: string, capturedAt: string): string {
  return `webmd:${userId}:${noteId}:note-history-metadata:${historyId}:schema:v1:${capturedAt}:encryption:v${ENCRYPTION_VERSION}`;
}

export async function encryptAttachmentBytes(input: { userId: string; attachmentId: string; ownerNoteId: string; originalName: string; mime: VaultAttachment["mime"]; data: ArrayBuffer; chunkSize: number }) {
  const bytes = new Uint8Array(input.data as ArrayBuffer);
  const attachmentKey = randomBytes(32);
  const chunkSize = Number(input.chunkSize);
  const chunkCount = Math.max(1, Math.ceil(bytes.byteLength / chunkSize));
  const chunks: EncryptedAttachmentChunk[] = [];
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const start = chunkIndex * chunkSize;
    const sealed = await sealBinary(
      bytes.subarray(start, Math.min(bytes.byteLength, start + chunkSize)),
      attachmentKey,
      attachmentChunkAad(input.userId, input.attachmentId, chunkIndex, chunkCount)
    );
    chunks.push({
      attachmentId: input.attachmentId,
      chunkIndex,
      totalChunks: chunkCount,
      ciphertext: sealed.ciphertext,
      nonce: sealed.nonce,
      encryptionVersion: ENCRYPTION_VERSION
    });
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", ownedBuffer(bytes)));
  const now = new Date().toISOString();
  const metadata: VaultAttachment = {
    kind: "attachment",
    ownerNoteId: input.ownerNoteId,
    originalName: input.originalName,
    mime: input.mime,
    size: bytes.byteLength,
    sha256: b64(digest),
    chunkCount,
    chunkSize,
    attachmentKey: b64(attachmentKey),
    deleted: false,
    createdAt: now,
    updatedAt: now,
    schemaVersion: 2
  };
  attachmentKey.fill(0);
  return { metadata, chunks };
}

export async function decryptAttachmentBytes(input: { userId: string; attachmentId: string; metadata: VaultAttachment; chunks: EncryptedAttachmentChunk[] }) {
  const metadata = input.metadata as VaultAttachment;
  const attachmentKey = fromB64(metadata.attachmentKey);
  const chunks = (input.chunks as EncryptedAttachmentChunk[]).slice().sort((a, b) => a.chunkIndex - b.chunkIndex);
  if (chunks.length !== metadata.chunkCount) throw new Error("Attachment is incomplete");
  const parts: Uint8Array[] = [];
  let size = 0;
  for (let expectedIndex = 0; expectedIndex < chunks.length; expectedIndex += 1) {
    const chunk = chunks[expectedIndex];
    if (chunk.attachmentId !== input.attachmentId) throw new Error("Attachment chunk ID mismatch");
    if (chunk.chunkIndex !== expectedIndex) throw new Error("Attachment chunk index mismatch");
    if (chunk.totalChunks !== metadata.chunkCount) throw new Error("Attachment chunk count mismatch");
    if (chunk.encryptionVersion !== ENCRYPTION_VERSION) throw new Error("Attachment encryption version mismatch");
    const part = await openBinary(
      chunk.ciphertext,
      chunk.nonce,
      attachmentKey,
      attachmentChunkAad(input.userId, input.attachmentId, chunk.chunkIndex, chunk.totalChunks)
    );
    parts.push(part);
    size += part.byteLength;
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  const digest = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", ownedBuffer(result))));
  attachmentKey.fill(0);
  if (digest !== metadata.sha256 || result.byteLength !== metadata.size) throw new Error("Attachment integrity check failed");
  return result.buffer;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ":" + canonicalJson(item)).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
