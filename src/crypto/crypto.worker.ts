/// <reference lib="webworker" />
import { argon2id } from "hash-wasm";
import { b64, fromB64, ownedBuffer, randomBytes, deriveSubkey, seal, open, sealBinary, openBinary, objectAad, attachmentChunkAad, historyAad, historyMetadataAad, createApplicationCredential, encryptAttachmentBytes, decryptAttachmentBytes } from "@mint-notes/application-client/crypto";

import type { EncryptedAttachmentChunk, KdfParams, NoteHistoryMetadataPayload, NoteHistoryPayload, VaultAttachment, VaultObject } from "../types";

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

function envelopeAad(payload: { envelopeBinding?: { version?: unknown; context?: unknown }; username?: unknown }): string {
  const binding = payload.envelopeBinding;
  if (binding?.version === 2 && typeof binding.context === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(binding.context)) {
    return `webmd:vault-envelope:v2:${binding.context}`;
  }
  if (binding?.version === 1 && typeof binding.context === "string") {
    return `webmd:vault-envelope:v1:${binding.context.toLowerCase()}`;
  }
  if (typeof payload.username === "string") return `webmd:vault-envelope:v1:${payload.username.toLowerCase()}`;
  throw new Error("Invalid vault envelope binding");
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
        const envelopeBinding = { version: 2 as const, context: b64(randomBytes(16)) };
        const wrapped = await seal(vaultKey, wrapKey, envelopeAad({ envelopeBinding }));
        stage = "recovery-envelope";
        const recoveryKey = randomBytes(32);
        const recoveryAuthSecret = b64(await deriveSubkey(recoveryKey, "webmd-recovery-auth-v1"));
        const recoveryWrapKey = await deriveSubkey(recoveryKey, "webmd-recovery-wrap-v1");
        const recoveryWrapped = await seal(vaultKey, recoveryWrapKey, envelopeAad({ envelopeBinding }));
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
          recoveryCode: b64(recoveryKey),
          envelopeBinding
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
      vaultKey = await open(payload.wrappedVaultKey, payload.wrappedVaultNonce, pendingWrapKey, envelopeAad(payload));
      pendingWrapKey.fill(0);
      pendingWrapKey = null;
      return { unlocked: true };
    }
    case "unlockRecovery": {
      const recoveryKey = fromB64(payload.recoveryCode.trim());
      const recoveryAuthSecret = b64(await deriveSubkey(recoveryKey, "webmd-recovery-auth-v1"));
      const recoveryWrapKey = await deriveSubkey(recoveryKey, "webmd-recovery-wrap-v1");
      vaultKey = await open(payload.wrappedVaultKey, payload.wrappedVaultNonce, recoveryWrapKey, envelopeAad(payload));
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
      const wrapped = await seal(vaultKey, wrapKey, envelopeAad(payload));
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
    case "createApplicationCredential": {
      if (!vaultKey) throw new Error("Vault is locked");
      const unlockedKey = vaultKey;
      const credential = await createApplicationCredential(payload.userId, unlockedKey);
      if (vaultKey !== unlockedKey) throw new Error("Vault is locked");
      return credential;
    }
    case "rotateRecoveryKey": {
      if (!vaultKey) throw new Error("Vault is locked");
      const recoveryKey = randomBytes(32);
      const recoveryAuthSecret = b64(await deriveSubkey(recoveryKey, "webmd-recovery-auth-v1"));
      const recoveryWrapKey = await deriveSubkey(recoveryKey, "webmd-recovery-wrap-v1");
      const wrapped = await seal(vaultKey, recoveryWrapKey, envelopeAad(payload));
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
    case "rewrapPasswordEnvelope": {
      if (!vaultKey || !pendingWrapKey) throw new Error("Vault unlock and password verification are required");
      const wrapped = await seal(vaultKey, pendingWrapKey, envelopeAad(payload));
      return { wrappedVaultKey: wrapped.ciphertext, wrappedVaultNonce: wrapped.nonce };
    }
    case "rewrapVaultEnvelopes": {
      if (!vaultKey || !pendingWrapKey) throw new Error("Vault unlock and password verification are required");
      const recoveryKey = fromB64(payload.recoveryCode.trim());
      const recoveryAuthSecret = b64(await deriveSubkey(recoveryKey, "webmd-recovery-auth-v1"));
      const recoveryWrapKey = await deriveSubkey(recoveryKey, "webmd-recovery-wrap-v1");
      try {
        const passwordWrapped = await seal(vaultKey, pendingWrapKey, envelopeAad(payload));
        const recoveryWrapped = await seal(vaultKey, recoveryWrapKey, envelopeAad(payload));
        return {
          wrappedVaultKey: passwordWrapped.ciphertext,
          wrappedVaultNonce: passwordWrapped.nonce,
          recoveryAuthSecret,
          recoveryWrappedVaultKey: recoveryWrapped.ciphertext,
          recoveryWrappedVaultNonce: recoveryWrapped.nonce
        };
      } finally {
        recoveryKey.fill(0);
        recoveryWrapKey.fill(0);
      }
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
    case "encryptHistoryMetadata": {
      if (!vaultKey) throw new Error("Vault is locked");
      const bytes = new TextEncoder().encode(JSON.stringify(payload.metadata));
      return {
        ...await seal(
          bytes,
          vaultKey,
          historyMetadataAad(payload.userId, payload.noteId, payload.historyId, payload.capturedAt)
        ),
        encryptionVersion: ENCRYPTION_VERSION
      };
    }
    case "decryptHistoryMetadata": {
      if (!vaultKey) throw new Error("Vault is locked");
      const bytes = await open(
        payload.ciphertext,
        payload.nonce,
        vaultKey,
        historyMetadataAad(payload.userId, payload.noteId, payload.historyId, payload.capturedAt)
      );
      return JSON.parse(new TextDecoder().decode(bytes)) as NoteHistoryMetadataPayload;
    }
    case "createAttachment": {
      if (!vaultKey) throw new Error("Vault is locked");
      return encryptAttachmentBytes(payload);
    }

    case "decryptAttachment": {
      if (!vaultKey) throw new Error("Vault is locked");
      return decryptAttachmentBytes(payload);
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

function responseTransferables(operation: string, result: any): Transferable[] {
  if (operation === "decryptAttachment" && result instanceof ArrayBuffer) return [result];
  if (operation === "decryptProfileAvatar" && result?.data instanceof ArrayBuffer) return [result.data];
  if (operation === "createAttachment" && Array.isArray(result?.chunks)) {
    return result.chunks.map((chunk: EncryptedAttachmentChunk) => chunk.ciphertext);
  }
  return [];
}

self.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const { id, operation, payload } = event.data;
  try {
    const result = await handle(operation, payload);
    self.postMessage({ id, result }, responseTransferables(operation, result));
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "Cryptographic operation failed" });
  }
};
