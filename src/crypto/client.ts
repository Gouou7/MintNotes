import type {
  EncryptedAttachmentChunk,
  HistoryCaptureKind,
  KdfParams,
  NoteHistoryPayload,
  ObjectType,
  VaultAttachment,
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
}

export interface EncryptedProfileAvatar {
  ciphertext: string;
  nonce: string;
  encryptionVersion: 1;
}

export interface CryptoClient {
  createRegistration(username: string, password: string): Promise<RegistrationCrypto>;
  prepareLogin(password: string, kdfSalt: string, kdfParams: KdfParams): Promise<{ authSecret: string }>;
  discardPendingLogin(): Promise<unknown>;
  unlockVault(username: string, wrappedVaultKey: string, wrappedVaultNonce: string): Promise<unknown>;
  unlockRecovery(username: string, recoveryCode: string, wrappedVaultKey: string, wrappedVaultNonce: string): Promise<{ recoveryAuthSecret: string }>;
  rewrapPassword(username: string, password: string): Promise<Omit<RegistrationCrypto, "recoveryAuthSecret" | "recoveryWrappedVaultKey" | "recoveryWrappedVaultNonce" | "recoveryCode">>;
  rotateRecoveryKey(username: string): Promise<Pick<RegistrationCrypto, "recoveryAuthSecret" | "recoveryWrappedVaultKey" | "recoveryWrappedVaultNonce" | "recoveryCode">>;
  encryptProfileAvatar(userId: string, mime: string, data: ArrayBuffer): Promise<EncryptedProfileAvatar>;
  decryptProfileAvatar(userId: string, avatar: EncryptedProfileAvatar): Promise<{ mime: string; data: ArrayBuffer }>;
  wrapVaultForDevice(userId: string, deviceKey: CryptoKey): Promise<{ ciphertext: string; nonce: string; version: 1 }>;
  unlockVaultFromDevice(userId: string, deviceKey: CryptoKey, ciphertext: string, nonce: string): Promise<unknown>;
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
    unlockVault: (username, wrappedVaultKey, wrappedVaultNonce) => call("unlockVault", { username, wrappedVaultKey, wrappedVaultNonce }),
    unlockRecovery: (username, recoveryCode, wrappedVaultKey, wrappedVaultNonce) => call("unlockRecovery", { username, recoveryCode, wrappedVaultKey, wrappedVaultNonce }),
    rewrapPassword: (username, password) => call("rewrapPassword", { username, password }),
    rotateRecoveryKey: (username) => call("rotateRecoveryKey", { username }),
    encryptProfileAvatar: (userId, mime, data) => call("encryptProfileAvatar", { userId, mime, data }, [data]),
    decryptProfileAvatar: (userId, avatar) => call("decryptProfileAvatar", { userId, ...avatar }),
    wrapVaultForDevice: (userId, deviceKey) => call("wrapVaultForDevice", { userId, deviceKey }),
    unlockVaultFromDevice: (userId, deviceKey, ciphertext, nonce) => call("unlockVaultFromDevice", { userId, deviceKey, ciphertext, nonce }),
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
