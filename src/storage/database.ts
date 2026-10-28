import Dexie, { type EntityTable } from "dexie";
import type { AuthEndpoint, HistoryCaptureKind, ObjectType, User } from "../types";
import type { EncryptedNoteBodyBlock } from "@mint-notes/application-client";

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
  ownerNoteId?: string;
  serverTrashedAt?: string | null;
  bodyBlockIds?: string[];
  bodyBlocks?: EncryptedNoteBodyBlock[];
}

export interface LocalBodyBlock extends EncryptedNoteBodyBlock { key: string; userId: string; noteId: string; uploaded?: boolean; }
export interface RecoveryRecord {
  kind?: "conflict" | "conversion";
  key: string; userId: string; sourceId: string; copyId: string; source: OutboxEntry;
  attachments: LocalEncryptedObject[]; chunks: LocalAttachmentChunk[];
}

export interface ObjectUploadAttempt extends LocalEncryptedObject {
  operation: "upsert" | "purge";
  baseRevision: number;
  idempotencyKey: string;
  generation: number;
}

export interface OutboxEntry extends ObjectUploadAttempt {
  /** Local writer identity; never sent to the server or included in encrypted Markdown. */
  writerId?: string;
  /** Exact encrypted request retained until its server outcome is known. */
  upload?: ObjectUploadAttempt;
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
  touchedAt?: number;
  ownerNoteId?: string;
}

export interface AttachmentOutboxEntry extends LocalAttachmentChunk {
  idempotencyKey: string;
  generation: number;
}

export interface LocalMeta {
  key: string;
  value: string;
}

export interface VerifiedDeviceSession {
  version: 1;
  user: User;
  endpoint: AuthEndpoint;
  verifiedAt: string;
}

interface DeviceUnlockCredentialBase {
  userId: string;
  endpointId: string;
  mode: "remembered" | "session";
  deviceKey: CryptoKey;
  verifiedSession?: VerifiedDeviceSession;
  failedPinAttempts: number;
  autoLockMinutes: number;
  updatedAt: string;
}

export interface LegacyDeviceUnlockCredential extends DeviceUnlockCredentialBase {
  version: 2;
  ciphertext: string;
  nonce: string;
  pinSalt?: string;
  pinVerifier?: string;
}

export interface DirectDeviceUnlockCredential extends DeviceUnlockCredentialBase {
  version: 3;
  protection: "device";
  ciphertext: string;
  nonce: string;
}

export interface PinProtectedDeviceUnlockCredential extends DeviceUnlockCredentialBase {
  version: 3;
  protection: "pin";
  pinKdfVersion: 1;
  pinSalt: string;
  pinCiphertext: string;
  pinNonce: string;
}

export type DeviceUnlockCredential =
  | LegacyDeviceUnlockCredential
  | DirectDeviceUnlockCredential
  | PinProtectedDeviceUnlockCredential;

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
  metadataCiphertext?: string;
  metadataNonce?: string;
  metadataEncryptionVersion?: 1;
  protected: boolean;
  byteSize: number;
  pending: boolean;
  serverCreatedAt?: string;
  touchedAt?: number;
}

export interface HistoryOutboxEntry extends LocalHistorySnapshot {
  idempotencyKey: string;
  generation: number;
}

export interface LocalHistoryIndex {
  key: string;
  userId: string;
  noteId: string;
  historyId: string;
  capturedAt: string;
  captureKind: HistoryCaptureKind;
  metadataCiphertext?: string;
  metadataNonce?: string;
  metadataEncryptionVersion?: 1;
  protected: boolean;
  byteSize: number;
  pending: boolean;
  serverCreatedAt?: string;
}

export interface HistoryMetadataOutboxEntry {
  key: string;
  userId: string;
  noteId: string;
  historyId: string;
  capturedAt: string;
  metadataCiphertext: string;
  metadataNonce: string;
  metadataEncryptionVersion: 1;
  protected?: boolean;
  generation: number;
}

class NotesDatabase extends Dexie {
  bodyBlocks!: EntityTable<LocalBodyBlock, "key">;
  recoveries!: EntityTable<RecoveryRecord, "key">;
  objects!: EntityTable<LocalEncryptedObject, "key">;
  outbox!: EntityTable<OutboxEntry, "key">;
  attachmentChunks!: EntityTable<LocalAttachmentChunk, "key">;
  attachmentOutbox!: EntityTable<AttachmentOutboxEntry, "key">;
  meta!: EntityTable<LocalMeta, "key">;
  deviceCredentials!: EntityTable<DeviceUnlockCredential, "userId">;
  pendingEndpointRevocations!: EntityTable<PendingEndpointRevocation, "endpointId">;
  historySnapshots!: EntityTable<LocalHistorySnapshot, "key">;
  historyIndex!: EntityTable<LocalHistoryIndex, "key">;
  historyOutbox!: EntityTable<HistoryOutboxEntry, "key">;
  historyMetadataOutbox!: EntityTable<HistoryMetadataOutboxEntry, "key">;

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
    this.version(6).stores({
      objects: "key, userId, [userId+objectId], updatedAt",
      outbox: "key, userId, [userId+objectId], generation",
      attachmentChunks: "key, userId, [userId+attachmentId], [userId+attachmentId+chunkIndex]",
      attachmentOutbox: "key, userId, [userId+attachmentId], generation",
      meta: "key",
      deviceCredentials: "userId, endpointId",
      pendingEndpointRevocations: "endpointId, userId",
      historySnapshots: "key, userId, [userId+noteId], [userId+noteId+capturedAt], historyId",
      historyIndex: "key, userId, [userId+noteId], [userId+noteId+capturedAt], historyId",
      historyOutbox: "key, userId, [userId+noteId], generation",
      historyMetadataOutbox: "key, userId, [userId+noteId], generation"
    }).upgrade(async (transaction) => {
      await transaction.table("historySnapshots").toCollection().modify((entry) => {
        if (typeof entry.protected !== "boolean") entry.protected = false;
      });
      await transaction.table("historyOutbox").toCollection().modify((entry) => {
        if (typeof entry.protected !== "boolean") entry.protected = false;
      });
      const snapshots = await transaction.table("historySnapshots").toArray() as LocalHistorySnapshot[];
      if (snapshots.length) {
        await transaction.table("historyIndex").bulkPut(snapshots.map((entry) => ({
          key: entry.key,
          userId: entry.userId,
          noteId: entry.noteId,
          historyId: entry.historyId,
          capturedAt: entry.capturedAt,
          captureKind: entry.captureKind,
          metadataCiphertext: entry.metadataCiphertext,
          metadataNonce: entry.metadataNonce,
          metadataEncryptionVersion: entry.metadataEncryptionVersion,
          protected: entry.protected,
          byteSize: entry.byteSize,
          pending: entry.pending,
          serverCreatedAt: entry.serverCreatedAt
        })));
      }
    });
    this.version(7).stores({
      objects: "key, userId, [userId+objectId], updatedAt",
      outbox: "key, userId, [userId+objectId], generation",
      attachmentChunks: "key, userId, [userId+attachmentId], [userId+attachmentId+chunkIndex], touchedAt",
      attachmentOutbox: "key, userId, [userId+attachmentId], generation",
      meta: "key",
      deviceCredentials: "userId, endpointId",
      pendingEndpointRevocations: "endpointId, userId",
      historySnapshots: "key, userId, [userId+noteId], [userId+noteId+capturedAt], historyId, touchedAt",
      historyIndex: "key, userId, [userId+noteId], [userId+noteId+capturedAt], historyId",
      historyOutbox: "key, userId, [userId+noteId], generation",
      historyMetadataOutbox: "key, userId, [userId+noteId], generation"
    });
    this.version(8).stores({
      bodyBlocks: "key, userId, [userId+noteId]",
      recoveries: "key, userId, sourceId, copyId"
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
      localDb.historySnapshots,
      localDb.historyIndex,
      localDb.historyOutbox,
      localDb.historyMetadataOutbox,
      localDb.bodyBlocks, localDb.recoveries
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
        ,`sync-state:${userId}`, `sync-lease:${userId}`, `attachment-gc:${userId}`
      ]);
      await localDb.meta.where("key").startsWith(`storage-status:${userId}:`).delete();
      await localDb.meta.where("key").startsWith(`history-invalid:${userId}:`).delete();
      await localDb.meta.where("key").startsWith(`history-verified:${userId}:`).delete();
      await localDb.deviceCredentials.delete(userId);
      await localDb.historySnapshots.where("userId").equals(userId).delete();
      await localDb.historyIndex.where("userId").equals(userId).delete();
      await localDb.historyOutbox.where("userId").equals(userId).delete();
      await localDb.historyMetadataOutbox.where("userId").equals(userId).delete();
      await localDb.bodyBlocks.where("userId").equals(userId).delete();
      await localDb.recoveries.where("userId").equals(userId).delete();
    }
  );
}
