/// <reference lib="webworker" />
import { argon2id } from "hash-wasm";
import type { EncryptedAttachmentChunk, KdfParams, NoteHistoryPayload, VaultAttachment, VaultObject } from "../types";

type RequestMessage = { id: number; operation: string; payload?: any };

const ENCRYPTION_VERSION = 1;
const DEFAULT_KDF: KdfParams = {
  algorithm: "argon2id",
  opsLimit: 3,
  memLimit: 64 * 1024 * 1024,
  version: 1
};
const PIN_KDF: KdfParams = {
  algorithm: "argon2id",
  opsLimit: 3,
  memLimit: 64 * 1024 * 1024,
  version: 1
};

let vaultKey: Uint8Array | null = null;
let pendingWrapKey: Uint8Array | null = null;

function b64(bytes: Uint8Array): string {
  const stableBytes = Uint8Array.from(bytes);
  let binary = "";
  for (let offset = 0; offset < stableBytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...stableBytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function deriveRoot(password: string, salt: Uint8Array, params: KdfParams): Promise<Uint8Array> {
  return Uint8Array.from(await argon2id({
    password,
    salt,
    iterations: params.opsLimit,
    parallelism: 1,
    memorySize: Math.floor(params.memLimit / 1024),
    hashLength: 32,
    outputType: "binary"
  }));
}

async function deriveSubkey(root: Uint8Array, label: string): Promise<Uint8Array> {
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

async function seal(message: Uint8Array, key: Uint8Array, aad: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey("raw", ownedBuffer(key), { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ownedBuffer(nonce), additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    cryptoKey,
    ownedBuffer(message)
  ));
  return { ciphertext: b64(ciphertext), nonce: b64(nonce) };
}

async function open(ciphertext: string, nonce: string, key: Uint8Array, aad: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", ownedBuffer(key), { name: "AES-GCM" }, false, ["decrypt"]);
  const nonceBytes = fromB64(nonce);
  const ciphertextBytes = fromB64(ciphertext);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ownedBuffer(nonceBytes), additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    cryptoKey,
    ownedBuffer(ciphertextBytes)
  ));
}

async function sealBinary(message: Uint8Array, key: Uint8Array, aad: string) {
  const nonce = randomBytes(12);
  const cryptoKey = await crypto.subtle.importKey("raw", ownedBuffer(key), { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ownedBuffer(nonce), additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    cryptoKey,
    ownedBuffer(message)
  );
  return { ciphertext, nonce: b64(nonce) };
}

async function openBinary(ciphertext: ArrayBuffer, nonce: string, key: Uint8Array, aad: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", ownedBuffer(key), { name: "AES-GCM" }, false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ownedBuffer(fromB64(nonce)), additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    cryptoKey,
    ciphertext
  ));
}

function envelopeAad(username: string): string {
  return `webmd:vault-envelope:v1:${username.toLowerCase()}`;
}

function objectAad(userId: string, objectId: string, objectType: string, revision: number): string {
  return `webmd:${userId}:${objectId}:${objectType}:schema:v2:encryption:v${ENCRYPTION_VERSION}:r${revision}`;
}

function attachmentChunkAad(userId: string, attachmentId: string, chunkIndex: number, totalChunks: number): string {
  return `webmd:${userId}:${attachmentId}:attachment-chunk:schema:v2:${chunkIndex}:of:${totalChunks}:encryption:v${ENCRYPTION_VERSION}`;
}

function deviceUnlockAad(userId: string): string {
  return `webmd:${userId}:device-unlock:v1`;
}

function devicePinUnlockAad(userId: string, endpointId: string): string {
  return `webmd:${userId}:${endpointId}:device-pin-unlock:v1`;
}

function profileAvatarAad(userId: string): string {
  return `webmd:${userId}:profile-avatar:v1`;
}

function historyAad(userId: string, noteId: string, historyId: string, capturedAt: string, captureKind: string): string {
  return `webmd:${userId}:${noteId}:note-history:${historyId}:schema:v1:${capturedAt}:${captureKind}:encryption:v${ENCRYPTION_VERSION}`;
}

function validateDeviceKey(key: CryptoKey, usage: "encrypt" | "decrypt") {
  if (key.type !== "secret" || key.extractable || key.algorithm.name !== "AES-GCM" || !key.usages.includes(usage)) {
    throw new Error("Invalid device unlock key");
  }
}

async function wrapVaultBytesForDevice(userId: string, deviceKey: CryptoKey, bytes: Uint8Array) {
  validateDeviceKey(deviceKey, "encrypt");
  const nonce = randomBytes(12);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ownedBuffer(nonce), additionalData: new TextEncoder().encode(deviceUnlockAad(userId)), tagLength: 128 },
    deviceKey,
    ownedBuffer(bytes)
  ));
  return { ciphertext: b64(ciphertext), nonce: b64(nonce), version: 1 as const };
}

async function unwrapVaultBytesFromDevice(userId: string, deviceKey: CryptoKey, ciphertext: string, nonce: string): Promise<Uint8Array> {
  validateDeviceKey(deviceKey, "decrypt");
  const restored = new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ownedBuffer(fromB64(nonce)), additionalData: new TextEncoder().encode(deviceUnlockAad(userId)), tagLength: 128 },
    deviceKey,
    ownedBuffer(fromB64(ciphertext))
  ));
  if (restored.byteLength !== 32) {
    restored.fill(0);
    throw new Error("Invalid device unlock credential");
  }
  return restored;
}

async function handle(operation: string, payload: any): Promise<any> {
  switch (operation) {
    case "createRegistration": {
      let stage = "salt";
      try {
        const kdfSalt = randomBytes(16);
        stage = "argon2id";
        const root = await deriveRoot(payload.password, kdfSalt, DEFAULT_KDF);
        stage = "domain-separation";
        // Encode derived authentication values immediately and do not retain
        // authentication bytes longer than the current operation.
        const authSecret = b64(await deriveSubkey(root, "webmd-authentication-v1"));
        const wrapKey = await deriveSubkey(root, "webmd-vault-wrapping-v1");
        stage = "vault-envelope";
        vaultKey = randomBytes(32);
        const wrapped = await seal(vaultKey, wrapKey, envelopeAad(payload.username));
        stage = "recovery-envelope";
        const recoveryKey = randomBytes(32);
        const recoveryAuthSecret = b64(await deriveSubkey(recoveryKey, "webmd-recovery-auth-v1"));
        const recoveryWrapKey = await deriveSubkey(recoveryKey, "webmd-recovery-wrap-v1");
        const recoveryWrapped = await seal(vaultKey, recoveryWrapKey, envelopeAad(payload.username));
        stage = "encoding";
        const result = {
          authSecret,
          kdfSalt: b64(kdfSalt),
          kdfParams: DEFAULT_KDF,
          wrappedVaultKey: wrapped.ciphertext,
          wrappedVaultNonce: wrapped.nonce,
          recoveryAuthSecret,
          recoveryWrappedVaultKey: recoveryWrapped.ciphertext,
          recoveryWrappedVaultNonce: recoveryWrapped.nonce,
          recoveryCode: b64(recoveryKey)
        };
        root.fill(0);
        wrapKey.fill(0);
        recoveryWrapKey.fill(0);
        return result;
      } catch (error) {
        throw new Error(`createRegistration/${stage}: ${error instanceof Error ? error.message : "failed"}`);
      }
    }
    case "prepareLogin": {
      if (pendingWrapKey) pendingWrapKey.fill(0);
      pendingWrapKey = null;
      const root = await deriveRoot(payload.password, fromB64(payload.kdfSalt), payload.kdfParams);
      const authSecret = b64(await deriveSubkey(root, "webmd-authentication-v1"));
      pendingWrapKey = await deriveSubkey(root, "webmd-vault-wrapping-v1");
      root.fill(0);
      return { authSecret };
    }
    case "discardPendingLogin": {
      if (pendingWrapKey) pendingWrapKey.fill(0);
      pendingWrapKey = null;
      return { discarded: true };
    }
    case "unlockVault": {
      if (!pendingWrapKey) throw new Error("Login derivation is missing");
      vaultKey = await open(payload.wrappedVaultKey, payload.wrappedVaultNonce, pendingWrapKey, envelopeAad(payload.username));
      pendingWrapKey.fill(0);
      pendingWrapKey = null;
      return { unlocked: true };
    }
    case "unlockRecovery": {
      const recoveryKey = fromB64(payload.recoveryCode.trim());
      const recoveryAuthSecret = b64(await deriveSubkey(recoveryKey, "webmd-recovery-auth-v1"));
      const recoveryWrapKey = await deriveSubkey(recoveryKey, "webmd-recovery-wrap-v1");
      vaultKey = await open(payload.wrappedVaultKey, payload.wrappedVaultNonce, recoveryWrapKey, envelopeAad(payload.username));
      recoveryWrapKey.fill(0);
      return { recoveryAuthSecret };
    }
    case "rewrapPassword": {
      if (!vaultKey) throw new Error("Vault is locked");
      if (pendingWrapKey) {
        pendingWrapKey.fill(0);
        pendingWrapKey = null;
      }
      const kdfSalt = randomBytes(16);
      const root = await deriveRoot(payload.password, kdfSalt, DEFAULT_KDF);
      const authSecret = b64(await deriveSubkey(root, "webmd-authentication-v1"));
      const wrapKey = await deriveSubkey(root, "webmd-vault-wrapping-v1");
      const wrapped = await seal(vaultKey, wrapKey, envelopeAad(payload.username));
      root.fill(0);
      wrapKey.fill(0);
      return {
        authSecret,
        kdfSalt: b64(kdfSalt),
        kdfParams: DEFAULT_KDF,
        wrappedVaultKey: wrapped.ciphertext,
        wrappedVaultNonce: wrapped.nonce
      };
    }
    case "rotateRecoveryKey": {
      if (!vaultKey) throw new Error("Vault is locked");
      const recoveryKey = randomBytes(32);
      const recoveryAuthSecret = b64(await deriveSubkey(recoveryKey, "webmd-recovery-auth-v1"));
      const recoveryWrapKey = await deriveSubkey(recoveryKey, "webmd-recovery-wrap-v1");
      const wrapped = await seal(vaultKey, recoveryWrapKey, envelopeAad(payload.username));
      const result = {
        recoveryAuthSecret,
        recoveryWrappedVaultKey: wrapped.ciphertext,
        recoveryWrappedVaultNonce: wrapped.nonce,
        recoveryCode: b64(recoveryKey)
      };
      recoveryKey.fill(0);
      recoveryWrapKey.fill(0);
      return result;
    }
    case "encryptProfileAvatar": {
      if (!vaultKey) throw new Error("Vault is locked");
      if (typeof payload.mime !== "string" || !payload.mime.startsWith("image/")) throw new Error("Invalid avatar format");
      const encoded = new TextEncoder().encode(JSON.stringify({
        mime: payload.mime,
        data: b64(new Uint8Array(payload.data as ArrayBuffer))
      }));
      return { ...await seal(encoded, vaultKey, profileAvatarAad(payload.userId)), encryptionVersion: ENCRYPTION_VERSION };
    }
    case "decryptProfileAvatar": {
      if (!vaultKey) throw new Error("Vault is locked");
      if (payload.encryptionVersion !== ENCRYPTION_VERSION) throw new Error("Unsupported avatar encryption version");
      const decoded = JSON.parse(new TextDecoder().decode(await open(
        payload.ciphertext,
        payload.nonce,
        vaultKey,
        profileAvatarAad(payload.userId)
      ))) as { mime?: unknown; data?: unknown };
      if (typeof decoded.mime !== "string" || !decoded.mime.startsWith("image/") || typeof decoded.data !== "string") {
        throw new Error("Invalid encrypted avatar");
      }
      return { mime: decoded.mime, data: ownedBuffer(fromB64(decoded.data)) };
    }
    case "wrapVaultForDevice": {
      if (!vaultKey) throw new Error("Vault is locked");
      return wrapVaultBytesForDevice(payload.userId, payload.deviceKey as CryptoKey, vaultKey);
    }
    case "unlockVaultFromDevice": {
      const restored = await unwrapVaultBytesFromDevice(payload.userId, payload.deviceKey as CryptoKey, payload.ciphertext, payload.nonce);
      if (vaultKey) vaultKey.fill(0);
      vaultKey = restored;
      return { unlocked: true };
    }
    case "wrapVaultForDeviceWithPin": {
      if (!vaultKey) throw new Error("Vault is locked");
      if (payload.kdfVersion !== undefined && payload.kdfVersion !== PIN_KDF.version) throw new Error("Unsupported PIN KDF version");
      const inner = await wrapVaultBytesForDevice(payload.userId, payload.deviceKey as CryptoKey, vaultKey);
      const encoded = new TextEncoder().encode(JSON.stringify({ ciphertext: inner.ciphertext, nonce: inner.nonce }));
      const root = await deriveRoot(payload.pin, fromB64(payload.salt), PIN_KDF);
      const pinKey = await deriveSubkey(root, "webmd-local-pin-wrapping-v1");
      try {
        return { ...await seal(encoded, pinKey, devicePinUnlockAad(payload.userId, payload.endpointId)), version: 1 };
      } finally {
        encoded.fill(0);
        root.fill(0);
        pinKey.fill(0);
      }
    }
    case "unlockVaultFromDeviceWithPin": {
      if (payload.kdfVersion !== PIN_KDF.version) throw new Error("Unsupported PIN KDF version");
      const root = await deriveRoot(payload.pin, fromB64(payload.salt), PIN_KDF);
      const pinKey = await deriveSubkey(root, "webmd-local-pin-wrapping-v1");
      let encoded: Uint8Array | null = null;
      try {
        encoded = await open(
          payload.ciphertext,
          payload.nonce,
          pinKey,
          devicePinUnlockAad(payload.userId, payload.endpointId)
        );
        const inner = JSON.parse(new TextDecoder().decode(encoded)) as { ciphertext?: unknown; nonce?: unknown };
        if (typeof inner.ciphertext !== "string" || typeof inner.nonce !== "string") throw new Error("Invalid PIN-protected device credential");
        const restored = await unwrapVaultBytesFromDevice(payload.userId, payload.deviceKey as CryptoKey, inner.ciphertext, inner.nonce);
        if (vaultKey) vaultKey.fill(0);
        vaultKey = restored;
        return { unlocked: true };
      } finally {
        encoded?.fill(0);
        root.fill(0);
        pinKey.fill(0);
      }
    }
    case "derivePinVerifier": {
      const params: KdfParams = { ...DEFAULT_KDF, memLimit: 32 * 1024 * 1024 };
      const root = await deriveRoot(payload.pin, fromB64(payload.salt), params);
      const verifier = b64(await deriveSubkey(root, "webmd-local-pin-verifier-v1"));
      root.fill(0);
      return { verifier };
    }
    case "encryptObject": {
      if (!vaultKey) throw new Error("Vault is locked");
      const bytes = new TextEncoder().encode(JSON.stringify(payload.document));
      return { ...await seal(bytes, vaultKey, objectAad(payload.userId, payload.objectId, payload.objectType, payload.revision)), encryptionVersion: ENCRYPTION_VERSION };
    }
    case "decryptObject": {
      if (!vaultKey) throw new Error("Vault is locked");
      const bytes = await open(
        payload.ciphertext,
        payload.nonce,
        vaultKey,
        objectAad(payload.userId, payload.objectId, payload.objectType, payload.revision)
      );
      return JSON.parse(new TextDecoder().decode(bytes)) as VaultObject;
    }
    case "encryptHistory": {
      if (!vaultKey) throw new Error("Vault is locked");
      const bytes = new TextEncoder().encode(JSON.stringify(payload.document));
      return {
        ...await seal(
          bytes,
          vaultKey,
          historyAad(payload.userId, payload.noteId, payload.historyId, payload.capturedAt, payload.captureKind)
        ),
        encryptionVersion: ENCRYPTION_VERSION
      };
    }
    case "decryptHistory": {
      if (!vaultKey) throw new Error("Vault is locked");
      const bytes = await open(
        payload.ciphertext,
        payload.nonce,
        vaultKey,
        historyAad(payload.userId, payload.noteId, payload.historyId, payload.capturedAt, payload.captureKind)
      );
      return JSON.parse(new TextDecoder().decode(bytes)) as NoteHistoryPayload;
    }
    case "createAttachment": {
      if (!vaultKey) throw new Error("Vault is locked");
      const bytes = new Uint8Array(payload.data as ArrayBuffer);
      const attachmentKey = randomBytes(32);
      const chunkSize = Number(payload.chunkSize);
      const chunkCount = Math.max(1, Math.ceil(bytes.byteLength / chunkSize));
      const chunks: EncryptedAttachmentChunk[] = [];
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        const start = chunkIndex * chunkSize;
        const sealed = await sealBinary(
          bytes.subarray(start, Math.min(bytes.byteLength, start + chunkSize)),
          attachmentKey,
          attachmentChunkAad(payload.userId, payload.attachmentId, chunkIndex, chunkCount)
        );
        chunks.push({
          attachmentId: payload.attachmentId,
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
        ownerNoteId: payload.ownerNoteId,
        originalName: payload.originalName,
        mime: payload.mime,
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
    case "decryptAttachment": {
      if (!vaultKey) throw new Error("Vault is locked");
      const metadata = payload.metadata as VaultAttachment;
      const attachmentKey = fromB64(metadata.attachmentKey);
      const chunks = (payload.chunks as EncryptedAttachmentChunk[]).slice().sort((a, b) => a.chunkIndex - b.chunkIndex);
      if (chunks.length !== metadata.chunkCount) throw new Error("Attachment is incomplete");
      const parts: Uint8Array[] = [];
      let size = 0;
      for (const chunk of chunks) {
        if (chunk.totalChunks !== metadata.chunkCount) throw new Error("Attachment chunk count mismatch");
        const part = await openBinary(
          chunk.ciphertext,
          chunk.nonce,
          attachmentKey,
          attachmentChunkAad(payload.userId, payload.attachmentId, chunk.chunkIndex, chunk.totalChunks)
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
    case "lock": {
      if (vaultKey) vaultKey.fill(0);
      if (pendingWrapKey) pendingWrapKey.fill(0);
      vaultKey = null;
      pendingWrapKey = null;
      return { locked: true };
    }
    default:
      throw new Error(`Unknown crypto operation: ${operation}`);
  }
}

self.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const { id, operation, payload } = event.data;
  try {
    const result = await handle(operation, payload);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "Cryptographic operation failed" });
  }
};
