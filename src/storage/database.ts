import Dexie, { type EntityTable } from "dexie";
import type { HistoryCaptureKind, ObjectType } from "../types";

export interface LocalEncryptedObject {
  key: string;
  userId: string;
  objectId: string;
  objectType: ObjectType;
  ciphertext: string;
  nonce: string;
  encryptionVersion: number;
  revision: number;
  deleted: boolean;
  updatedAt: string;
}

export interface OutboxEntry extends LocalEncryptedObject {
  operation: "upsert" | "purge";
  baseRevision: number;
  idempotencyKey: string;
  generation: number;
}

export interface LocalAttachmentChunk {
  key: string;
  userId: string;
  attachmentId: string;
  chunkIndex: number;
  totalChunks: number;
  ciphertext: ArrayBuffer;
  nonce: string;
  encryptionVersion: number;
  updatedAt: string;
}

export interface AttachmentOutboxEntry extends LocalAttachmentChunk {
  idempotencyKey: string;
  generation: number;
}

export interface LocalMeta {
  key: string;
  value: string;
}

export interface DeviceUnlockCredential {
  userId: string;
  endpointId: string;
  mode: "remembered" | "session";
  deviceKey: CryptoKey;
  ciphertext: string;
  nonce: string;
  version: 2;
  pinSalt?: string;
  pinVerifier?: string;
  failedPinAttempts: number;
  autoLockMinutes: number;
  updatedAt: string;
}

export interface PendingEndpointRevocation {
  endpointId: string;
  userId: string;
  createdAt: string;
}

export interface LocalHistorySnapshot {
  key: string;
  userId: string;
  noteId: string;
  historyId: string;
  capturedAt: string;
  captureKind: HistoryCaptureKind;
  ciphertext: string;
  nonce: string;
  encryptionVersion: 1;
  byteSize: number;
  pending: boolean;
  serverCreatedAt?: string;
}

export interface HistoryOutboxEntry extends LocalHistorySnapshot {
  idempotencyKey: string;
  generation: number;
}

class NotesDatabase extends Dexie {
  objects!: EntityTable<LocalEncryptedObject, "key">;
  outbox!: EntityTable<OutboxEntry, "key">;
  attachmentChunks!: EntityTable<LocalAttachmentChunk, "key">;
  attachmentOutbox!: EntityTable<AttachmentOutboxEntry, "key">;
  meta!: EntityTable<LocalMeta, "key">;
  deviceCredentials!: EntityTable<DeviceUnlockCredential, "userId">;
  pendingEndpointRevocations!: EntityTable<PendingEndpointRevocation, "endpointId">;
  historySnapshots!: EntityTable<LocalHistorySnapshot, "key">;
  historyOutbox!: EntityTable<HistoryOutboxEntry, "key">;

  constructor() {
    // v2 intentionally uses a new database name. The application never
    // destroys an older vault implicitly when an incompatible schema ships.
    super("webmd-notes-v2");
    this.version(1).stores({
      objects: "key, userId, [userId+objectId], updatedAt",
      outbox: "key, userId, [userId+objectId], generation",
      attachmentChunks: "key, userId, [userId+attachmentId], [userId+attachmentId+chunkIndex]",
      attachmentOutbox: "key, userId, [userId+attachmentId], generation",
      meta: "key"
    });
    this.version(2).stores({
      objects: "key, userId, [userId+objectId], updatedAt",
      outbox: "key, userId, [userId+objectId], generation",
      attachmentChunks: "key, userId, [userId+attachmentId], [userId+attachmentId+chunkIndex]",
      attachmentOutbox: "key, userId, [userId+attachmentId], generation",
      meta: "key",
      deviceCredentials: "userId"
    });
    this.version(3).stores({
      objects: "key, userId, [userId+objectId], updatedAt",
      outbox: "key, userId, [userId+objectId], generation",
      attachmentChunks: "key, userId, [userId+attachmentId], [userId+attachmentId+chunkIndex]",
      attachmentOutbox: "key, userId, [userId+attachmentId], generation",
      meta: "key",
      deviceCredentials: "userId, endpointId"
    });
    this.version(4).stores({
      objects: "key, userId, [userId+objectId], updatedAt",
      outbox: "key, userId, [userId+objectId], generation",
      attachmentChunks: "key, userId, [userId+attachmentId], [userId+attachmentId+chunkIndex]",
      attachmentOutbox: "key, userId, [userId+attachmentId], generation",
      meta: "key",
      deviceCredentials: "userId, endpointId",
      pendingEndpointRevocations: "endpointId, userId"
    });
    this.version(5).stores({
      objects: "key, userId, [userId+objectId], updatedAt",
      outbox: "key, userId, [userId+objectId], generation",
      attachmentChunks: "key, userId, [userId+attachmentId], [userId+attachmentId+chunkIndex]",
      attachmentOutbox: "key, userId, [userId+attachmentId], generation",
      meta: "key",
      deviceCredentials: "userId, endpointId",
      pendingEndpointRevocations: "endpointId, userId",
      historySnapshots: "key, userId, [userId+noteId], [userId+noteId+capturedAt], historyId",
      historyOutbox: "key, userId, [userId+noteId], generation"
    });
  }
}

export const localDb = new NotesDatabase();

export function localKey(userId: string, objectId: string): string {
  return `${userId}:${objectId}`;
}

export function chunkKey(userId: string, attachmentId: string, chunkIndex: number): string {
  return `${userId}:${attachmentId}:${chunkIndex}`;
}

export function cursorKey(userId: string): string {
  return `sync-cursor:${userId}`;
}

export function preferencesKey(userId: string): string {
  return `ui-preferences:${userId}`;
}

export function ignoredDecryptFailuresKey(userId: string): string {
  return `ignored-decrypt-failures:${userId}`;
}

export function historyKey(userId: string, noteId: string, historyId: string): string {
  return `${userId}:${noteId}:${historyId}`;
}

export function historySettingsKey(userId: string): string {
  return `note-history-settings:${userId}`;
}

export async function deleteLocalUserData(userId: string): Promise<void> {
  await localDb.transaction(
    "rw",
    [
      localDb.objects,
      localDb.outbox,
      localDb.attachmentChunks,
      localDb.attachmentOutbox,
      localDb.meta,
      localDb.deviceCredentials,
      localDb.pendingEndpointRevocations,
      localDb.historySnapshots,
      localDb.historyOutbox
    ],
    async () => {
      await localDb.objects.where("userId").equals(userId).delete();
      await localDb.outbox.where("userId").equals(userId).delete();
      await localDb.attachmentChunks.where("userId").equals(userId).delete();
      await localDb.attachmentOutbox.where("userId").equals(userId).delete();
      await localDb.meta.bulkDelete([
        cursorKey(userId),
        preferencesKey(userId),
        ignoredDecryptFailuresKey(userId),
        historySettingsKey(userId)
      ]);
      await localDb.deviceCredentials.delete(userId);
      await localDb.pendingEndpointRevocations.where("userId").equals(userId).delete();
      await localDb.historySnapshots.where("userId").equals(userId).delete();
      await localDb.historyOutbox.where("userId").equals(userId).delete();
    }
  );
}
