import type {
  EncryptedAttachmentChunk,
  HistoryCaptureKind,
  KdfParams,
  NoteHistoryPayload,
  ObjectType,
  VaultAttachment,
  VaultEnvelopeBinding,
  VaultObject
} from "../types";

export interface RegistrationCrypto {
  authSecret: string;
  kdfSalt: string;
  kdfParams: KdfParams;
  wrappedVaultKey: string;
  wrappedVaultNonce: string;
  recoveryAuthSecret: string;
  recoveryWrappedVaultKey: string;
  recoveryWrappedVaultNonce: string;
  recoveryCode: string;
  envelopeBinding: VaultEnvelopeBinding;
}

export interface EncryptedProfileAvatar {
  ciphertext: string;
  nonce: string;
  encryptionVersion: 1;
}

export function createVaultEnvelopeBinding(): VaultEnvelopeBinding {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    version: 2,
    context: btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
  };
}

export interface CryptoClient {
  createRegistration(username: string, password: string): Promise<RegistrationCrypto>;
  prepareLogin(password: string, kdfSalt: string, kdfParams: KdfParams): Promise<{ authSecret: string }>;
  discardPendingLogin(): Promise<unknown>;
  unlockVault(binding: VaultEnvelopeBinding, wrappedVaultKey: string, wrappedVaultNonce: string): Promise<unknown>;
  unlockRecovery(binding: VaultEnvelopeBinding, recoveryCode: string, wrappedVaultKey: string, wrappedVaultNonce: string): Promise<{ recoveryAuthSecret: string }>;
  rewrapPassword(binding: VaultEnvelopeBinding, password: string): Promise<Omit<RegistrationCrypto, "recoveryAuthSecret" | "recoveryWrappedVaultKey" | "recoveryWrappedVaultNonce" | "recoveryCode" | "envelopeBinding">>;
  rotateRecoveryKey(binding: VaultEnvelopeBinding): Promise<Pick<RegistrationCrypto, "recoveryAuthSecret" | "recoveryWrappedVaultKey" | "recoveryWrappedVaultNonce" | "recoveryCode">>;
  rewrapPasswordEnvelope(binding: VaultEnvelopeBinding): Promise<{ wrappedVaultKey: string; wrappedVaultNonce: string }>;
  rewrapVaultEnvelopes(binding: VaultEnvelopeBinding, recoveryCode: string): Promise<{
    wrappedVaultKey: string;
    wrappedVaultNonce: string;
    recoveryAuthSecret: string;
    recoveryWrappedVaultKey: string;
    recoveryWrappedVaultNonce: string;
  }>;
  encryptProfileAvatar(userId: string, mime: string, data: ArrayBuffer): Promise<EncryptedProfileAvatar>;
  decryptProfileAvatar(userId: string, avatar: EncryptedProfileAvatar): Promise<{ mime: string; data: ArrayBuffer }>;
  wrapVaultForDevice(userId: string, deviceKey: CryptoKey): Promise<{ ciphertext: string; nonce: string; version: 1 }>;
  unlockVaultFromDevice(userId: string, deviceKey: CryptoKey, ciphertext: string, nonce: string): Promise<unknown>;
  wrapVaultForDeviceWithPin(userId: string, endpointId: string, deviceKey: CryptoKey, pin: string, salt: string): Promise<{ ciphertext: string; nonce: string; version: 1 }>;
  unlockVaultFromDeviceWithPin(userId: string, endpointId: string, deviceKey: CryptoKey, pin: string, salt: string, ciphertext: string, nonce: string, kdfVersion: 1): Promise<unknown>;
  derivePinVerifier(pin: string, salt: string): Promise<{ verifier: string }>;
  encryptObject(userId: string, objectId: string, objectType: ObjectType, revision: number, object: VaultObject): Promise<{ ciphertext: string; nonce: string; encryptionVersion: number }>;
  decryptObject(userId: string, objectId: string, objectType: ObjectType, revision: number, ciphertext: string, nonce: string): Promise<VaultObject>;
  encryptHistory(userId: string, noteId: string, historyId: string, capturedAt: string, captureKind: HistoryCaptureKind, payload: NoteHistoryPayload): Promise<{ ciphertext: string; nonce: string; encryptionVersion: 1 }>;
  decryptHistory(userId: string, noteId: string, historyId: string, capturedAt: string, captureKind: HistoryCaptureKind, ciphertext: string, nonce: string): Promise<NoteHistoryPayload>;
  createAttachment(input: { userId: string; attachmentId: string; ownerNoteId: string; originalName: string; mime: VaultAttachment["mime"]; data: ArrayBuffer; chunkSize: number }): Promise<{ metadata: VaultAttachment; chunks: EncryptedAttachmentChunk[] }>;
  decryptAttachment(userId: string, attachmentId: string, metadata: VaultAttachment, chunks: EncryptedAttachmentChunk[]): Promise<ArrayBuffer>;
  lock(): Promise<unknown>;
  dispose(): void;
}

export function createCryptoClient(): CryptoClient {
  const worker = new Worker(new URL("./crypto.worker.ts", import.meta.url), { type: "module" });
  let requestId = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

  worker.onmessage = (event: MessageEvent<{ id: number; result?: any; error?: string }>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.error) entry.reject(new Error(event.data.error));
    else entry.resolve(event.data.result);
  };

  const call = <T,>(operation: string, payload?: unknown, transfer: Transferable[] = []): Promise<T> => {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, operation, payload }, transfer);
    });
  };

  return {
    createRegistration: (username, password) => call("createRegistration", { username, password }),
    prepareLogin: (password, kdfSalt, kdfParams) => call("prepareLogin", { password, kdfSalt, kdfParams }),
    discardPendingLogin: () => call("discardPendingLogin"),
    unlockVault: (binding, wrappedVaultKey, wrappedVaultNonce) => call("unlockVault", { envelopeBinding: binding, wrappedVaultKey, wrappedVaultNonce }),
    unlockRecovery: (binding, recoveryCode, wrappedVaultKey, wrappedVaultNonce) => call("unlockRecovery", { envelopeBinding: binding, recoveryCode, wrappedVaultKey, wrappedVaultNonce }),
    rewrapPassword: (binding, password) => call("rewrapPassword", { envelopeBinding: binding, password }),
    rotateRecoveryKey: (binding) => call("rotateRecoveryKey", { envelopeBinding: binding }),
    rewrapPasswordEnvelope: (binding) => call("rewrapPasswordEnvelope", { envelopeBinding: binding }),
    rewrapVaultEnvelopes: (binding, recoveryCode) => call("rewrapVaultEnvelopes", { envelopeBinding: binding, recoveryCode }),
    encryptProfileAvatar: (userId, mime, data) => call("encryptProfileAvatar", { userId, mime, data }, [data]),
    decryptProfileAvatar: (userId, avatar) => call("decryptProfileAvatar", { userId, ...avatar }),
    wrapVaultForDevice: (userId, deviceKey) => call("wrapVaultForDevice", { userId, deviceKey }),
    unlockVaultFromDevice: (userId, deviceKey, ciphertext, nonce) => call("unlockVaultFromDevice", { userId, deviceKey, ciphertext, nonce }),
    wrapVaultForDeviceWithPin: (userId, endpointId, deviceKey, pin, salt) => call("wrapVaultForDeviceWithPin", { userId, endpointId, deviceKey, pin, salt }),
    unlockVaultFromDeviceWithPin: (userId, endpointId, deviceKey, pin, salt, ciphertext, nonce, kdfVersion) => call("unlockVaultFromDeviceWithPin", { userId, endpointId, deviceKey, pin, salt, ciphertext, nonce, kdfVersion }),
    derivePinVerifier: (pin, salt) => call("derivePinVerifier", { pin, salt }),
    encryptObject: (userId, objectId, objectType, revision, object) => call("encryptObject", { userId, objectId, objectType, revision, document: object }),
    decryptObject: (userId, objectId, objectType, revision, ciphertext, nonce) => call("decryptObject", { userId, objectId, objectType, revision, ciphertext, nonce }),
    encryptHistory: (userId, noteId, historyId, capturedAt, captureKind, payload) => call("encryptHistory", { userId, noteId, historyId, capturedAt, captureKind, document: payload }),
    decryptHistory: (userId, noteId, historyId, capturedAt, captureKind, ciphertext, nonce) => call("decryptHistory", { userId, noteId, historyId, capturedAt, captureKind, ciphertext, nonce }),
    createAttachment: (input) => call("createAttachment", input, [input.data]),
    decryptAttachment: (userId, attachmentId, metadata, chunks) => call("decryptAttachment", { userId, attachmentId, metadata, chunks }),
    lock: () => call("lock"),
    dispose: () => {
      worker.terminate();
      for (const entry of pending.values()) entry.reject(new Error("Crypto worker was terminated"));
      pending.clear();
    }
  };
}

export const cryptoClient = createCryptoClient();
