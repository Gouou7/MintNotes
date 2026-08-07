import type { CryptoClient } from "../../crypto/client";
import { cryptoClient } from "../../crypto/client";
import {
  historyKey,
  localDb,
  type HistoryMetadataOutboxEntry,
  type HistoryOutboxEntry,
  type LocalHistoryIndex,
  type LocalHistorySnapshot
} from "../../storage/database";
import type {
  EncryptedHistoryMetadata,
  EncryptedHistorySnapshot,
  HistoryCaptureKind,
  HistoryListItem,
  NoteHistoryMetadataPayload,
  NoteHistoryPayload,
  OpenDocument
} from "../../types";
import {
  historyContentSignature,
  localHistoryListItem,
  makeHistoryMetadata,
  makeHistoryPayload,
  mergeHistoryItems
} from "../history";

export type HistoryIndexEnvelope = Omit<HistoryListItem, "name"> & Partial<EncryptedHistoryMetadata>;

interface MetadataEnvelope {
  noteId: string;
  historyId: string;
  capturedAt: string;
  metadataCiphertext?: string;
  metadataNonce?: string;
  metadataEncryptionVersion?: 1;
}

export interface CreatedHistorySnapshot {
  snapshot: LocalHistorySnapshot;
  payload: NoteHistoryPayload;
  metadata: NoteHistoryMetadataPayload;
  signature: string;
}

export interface UpdatedHistoryMetadata {
  snapshot?: LocalHistorySnapshot;
  item: HistoryListItem;
  metadata: NoteHistoryMetadataPayload;
}

interface HistoryControllerOptions {
  userId: string;
  nextGeneration: () => number;
  isActive: () => boolean;
  crypto?: CryptoClient;
}

/** Owns encrypted history persistence so the workspace remains a UI/sync coordinator. */
export class VaultHistoryController {
  private readonly userId: string;
  private readonly nextGeneration: () => number;
  private readonly isActive: () => boolean;
  private readonly crypto: CryptoClient;

  constructor(options: HistoryControllerOptions) {
    this.userId = options.userId;
    this.nextGeneration = options.nextGeneration;
    this.isActive = options.isActive;
    this.crypto = options.crypto ?? cryptoClient;
  }

  private indexFor(record: HistoryIndexEnvelope | LocalHistorySnapshot, pending = record.pending): LocalHistoryIndex {
    return {
      key: historyKey(this.userId, record.noteId, record.historyId),
      userId: this.userId,
      noteId: record.noteId,
      historyId: record.historyId,
      capturedAt: record.capturedAt,
      captureKind: record.captureKind,
      metadataCiphertext: record.metadataCiphertext,
      metadataNonce: record.metadataNonce,
      metadataEncryptionVersion: record.metadataEncryptionVersion,
      protected: record.protected,
      byteSize: record.byteSize,
      pending,
      serverCreatedAt: record.serverCreatedAt
    };
  }

  async localForNote(noteId: string): Promise<LocalHistorySnapshot[]> {
    const rows = await localDb.historySnapshots.where("[userId+noteId]").equals([this.userId, noteId]).toArray();
    return rows.sort((left, right) => (
      right.capturedAt.localeCompare(left.capturedAt) || right.historyId.localeCompare(left.historyId)
    ));
  }

  async localIndexesForNote(noteId: string): Promise<LocalHistoryIndex[]> {
    const rows = await localDb.historyIndex.where("[userId+noteId]").equals([this.userId, noteId]).toArray();
    return rows.sort((left, right) => (
      right.capturedAt.localeCompare(left.capturedAt) || right.historyId.localeCompare(left.historyId)
    ));
  }

  async decryptMetadata(record: MetadataEnvelope): Promise<NoteHistoryMetadataPayload | null> {
    if (!record.metadataCiphertext || !record.metadataNonce || record.metadataEncryptionVersion !== 1) return null;
    const metadata = await this.crypto.decryptHistoryMetadata(
      this.userId,
      record.noteId,
      record.historyId,
      record.capturedAt,
      record.metadataCiphertext,
      record.metadataNonce
    );
    if (metadata.schemaVersion !== 1) throw new Error("Unsupported history metadata");
    return metadata;
  }

  async metadataForSnapshot(
    snapshot: LocalHistorySnapshot,
    payload?: NoteHistoryPayload
  ): Promise<NoteHistoryMetadataPayload> {
    const metadata = await this.decryptMetadata(snapshot);
    if (metadata) return metadata;
    const historyPayload = payload ?? await this.crypto.decryptHistory(
      this.userId,
      snapshot.noteId,
      snapshot.historyId,
      snapshot.capturedAt,
      snapshot.captureKind,
      snapshot.ciphertext,
      snapshot.nonce
    );
    return makeHistoryMetadata(historyPayload, null);
  }

  async localListItems(
    snapshots: LocalHistorySnapshot[],
    indexes: LocalHistoryIndex[] = []
  ): Promise<HistoryListItem[]> {
    const toItem = async (snapshot: LocalHistorySnapshot | LocalHistoryIndex): Promise<HistoryListItem> => {
      try {
        const metadata = await this.decryptMetadata(snapshot);
        return localHistoryListItem(snapshot, metadata?.name ?? "");
      } catch {
        return localHistoryListItem(snapshot);
      }
    };
    const [indexItems, snapshotItems] = await Promise.all([
      Promise.all(indexes.map(toItem)),
      Promise.all(snapshots.map(toItem))
    ]);
    return mergeHistoryItems(indexItems, snapshotItems);
  }

  async remoteListItems(items: HistoryIndexEnvelope[]): Promise<HistoryListItem[]> {
    return Promise.all(items.map(async (item) => {
      try {
        const metadata = await this.decryptMetadata(item);
        return { ...item, name: metadata?.name ?? "" };
      } catch {
        return { ...item, name: "" };
      }
    }));
  }

  async cacheRemoteItems(items: HistoryIndexEnvelope[]): Promise<void> {
    if (!items.length) return;
    const keys = items.map((item) => historyKey(this.userId, item.noteId, item.historyId));
    const [createPending, metadataPending] = await Promise.all([
      localDb.historyOutbox.bulkGet(keys),
      localDb.historyMetadataOutbox.bulkGet(keys)
    ]);
    const safe = items.filter((_item, index) => !createPending[index] && !metadataPending[index]);
    if (safe.length) await localDb.historyIndex.bulkPut(safe.map((item) => this.indexFor(item, false)));
  }

  async createSnapshot(
    document: OpenDocument,
    captureKind: HistoryCaptureKind,
    options: { name?: string | null; protected?: boolean; capturedAt?: string } = {}
  ): Promise<CreatedHistorySnapshot | null> {
    if (!this.isActive() || document.kind !== "note" || document.deleted) return null;
    const capturedAt = options.capturedAt ?? new Date().toISOString();
    const payload = makeHistoryPayload(document, capturedAt);
    const signature = historyContentSignature(payload);
    const historyId = crypto.randomUUID();
    const encrypted = await this.crypto.encryptHistory(
      this.userId,
      document.objectId,
      historyId,
      capturedAt,
      captureKind,
      payload
    );
    const metadata = makeHistoryMetadata(payload, options.name ?? null);
    const encryptedMetadata = await this.crypto.encryptHistoryMetadata(
      this.userId,
      document.objectId,
      historyId,
      capturedAt,
      metadata
    );
    const key = historyKey(this.userId, document.objectId, historyId);
    const snapshot: LocalHistorySnapshot = {
      key,
      userId: this.userId,
      noteId: document.objectId,
      historyId,
      capturedAt,
      captureKind,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      encryptionVersion: encrypted.encryptionVersion,
      metadataCiphertext: encryptedMetadata.ciphertext,
      metadataNonce: encryptedMetadata.nonce,
      metadataEncryptionVersion: encryptedMetadata.encryptionVersion,
      protected: options.protected ?? false,
      byteSize: encrypted.ciphertext.length + encryptedMetadata.ciphertext.length,
      pending: true
    };
    const outbox: HistoryOutboxEntry = {
      ...snapshot,
      idempotencyKey: crypto.randomUUID(),
      generation: this.nextGeneration()
    };
    await localDb.transaction("rw", localDb.historySnapshots, localDb.historyIndex, localDb.historyOutbox, async () => {
      if (!this.isActive()) return;
      await localDb.historySnapshots.put(snapshot);
      await localDb.historyIndex.put(this.indexFor(snapshot));
      await localDb.historyOutbox.put(outbox);
    });
    return this.isActive() ? { snapshot, payload, metadata, signature } : null;
  }

  async ensureSnapshot(
    item: HistoryListItem,
    fetchRemote: () => Promise<EncryptedHistorySnapshot>
  ): Promise<LocalHistorySnapshot> {
    const key = historyKey(this.userId, item.noteId, item.historyId);
    const cached = await localDb.historySnapshots.get(key);
    if (cached) {
      const snapshot = {
        ...cached,
        protected: item.protected,
        metadataCiphertext: item.metadataCiphertext ?? cached.metadataCiphertext,
        metadataNonce: item.metadataNonce ?? cached.metadataNonce,
        metadataEncryptionVersion: item.metadataEncryptionVersion ?? cached.metadataEncryptionVersion
      };
      await localDb.transaction("rw", localDb.historySnapshots, localDb.historyIndex, async () => {
        await localDb.historySnapshots.put(snapshot);
        await localDb.historyIndex.put(this.indexFor(snapshot));
      });
      return snapshot;
    }
    const remote = await fetchRemote();
    const snapshot: LocalHistorySnapshot = { ...remote, key, userId: this.userId };
    await localDb.transaction("rw", localDb.historySnapshots, localDb.historyIndex, async () => {
      await localDb.historySnapshots.put(snapshot);
      await localDb.historyIndex.put(this.indexFor(snapshot));
    });
    return snapshot;
  }

  async queueMetadataUpdate(
    item: HistoryListItem,
    snapshot: LocalHistorySnapshot | null,
    currentMetadata: NoteHistoryMetadataPayload,
    change: { name?: string | null; protected?: boolean }
  ): Promise<UpdatedHistoryMetadata> {
    const metadata: NoteHistoryMetadataPayload = {
      ...currentMetadata,
      name: change.name === undefined ? currentMetadata.name : change.name
    };
    const encrypted = await this.crypto.encryptHistoryMetadata(
      this.userId,
      item.noteId,
      item.historyId,
      item.capturedAt,
      metadata
    );
    const key = historyKey(this.userId, item.noteId, item.historyId);
    const nextProtected = change.protected ?? snapshot?.protected ?? item.protected;
    const currentMutation = await localDb.historyMetadataOutbox.get(key);
    const byteSize = snapshot
      ? snapshot.ciphertext.length + encrypted.ciphertext.length
      : item.byteSize - (item.metadataCiphertext?.length ?? 0) + encrypted.ciphertext.length;
    const nextSnapshot: LocalHistorySnapshot | null = snapshot ? {
      ...snapshot,
      metadataCiphertext: encrypted.ciphertext,
      metadataNonce: encrypted.nonce,
      metadataEncryptionVersion: encrypted.encryptionVersion,
      protected: nextProtected,
      byteSize,
      pending: true
    } : null;
    const mutation: HistoryMetadataOutboxEntry = {
      key,
      userId: this.userId,
      noteId: item.noteId,
      historyId: item.historyId,
      capturedAt: item.capturedAt,
      metadataCiphertext: encrypted.ciphertext,
      metadataNonce: encrypted.nonce,
      metadataEncryptionVersion: encrypted.encryptionVersion,
      protected: change.protected === undefined ? currentMutation?.protected : change.protected,
      generation: this.nextGeneration()
    };
    const nextItem: HistoryListItem = {
      ...item,
      name: metadata.name ?? "",
      protected: nextProtected,
      metadataCiphertext: encrypted.ciphertext,
      metadataNonce: encrypted.nonce,
      metadataEncryptionVersion: encrypted.encryptionVersion,
      byteSize,
      pending: true
    };
    await localDb.transaction("rw", localDb.historySnapshots, localDb.historyIndex, localDb.historyMetadataOutbox, async () => {
      if (nextSnapshot) await localDb.historySnapshots.put(nextSnapshot);
      await localDb.historyIndex.put(this.indexFor(nextItem));
      await localDb.historyMetadataOutbox.put(mutation);
    });
    return {
      snapshot: nextSnapshot ?? undefined,
      metadata,
      item: nextItem
    };
  }
}
