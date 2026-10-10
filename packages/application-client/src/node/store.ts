import { ApplicationError } from "../protocol.js";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ApplicationConnectionBootstrap } from "../protocol.js";
import type { EncryptedAttachmentChunk, EncryptedObject } from "../types.js";

export interface ObjectWrite extends EncryptedObject {
  baseRevision: number;
  idempotencyKey: string;
}
export interface HistoryWrite {
  historyId: string;
  capturedAt: string;
  captureKind: "manual";
  ciphertext: string;
  nonce: string;
  encryptionVersion: 1;
  metadataCiphertext: string;
  metadataNonce: string;
  metadataEncryptionVersion: 1;
  protected: false;
  attachmentIds: string[];
  idempotencyKey: string;
}
export interface ConflictDraft {
  note: ObjectWrite;
  attachments: ObjectWrite[];
  chunks: Array<Omit<EncryptedAttachmentChunk, "ciphertext"> & { ciphertext: string; idempotencyKey: string }>;
}
export interface PendingWrite {
  note: ObjectWrite;
  history?: HistoryWrite;
  sourceAttachments: EncryptedObject[];
  conflict?: ConflictDraft;
}
export interface MutationResult {
  operationId: string;
  objectId: string;
  revision?: number;
  status: "committed" | "pending" | "conflict";
  conflictNoteId?: string;
  errorCode?: string;
}
export interface Operation {
  operationId: string;
  requestHash: string;
  body: PendingWrite | null;
  result: MutationResult;
}

export class ApplicationStore {
  readonly db: DatabaseSync;
  constructor(stateDir: string, baseUrl: string, connectionId: string) {
    const directory = join(stateDir, "mint-notes");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const originHash = createHash("sha256").update(baseUrl).digest("hex").slice(0, 24);
    const path = join(directory, `${originHash}-${connectionId}.sqlite`);
    this.db = new DatabaseSync(path);
    const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version);
    if (version > 1) { this.db.close(); throw new ApplicationError("CACHE_VERSION_UNSUPPORTED", "Unsupported cache version"); }
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chunks (attachment_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
        data BLOB NOT NULL, nonce TEXT NOT NULL, total_chunks INTEGER NOT NULL, encryption_version INTEGER NOT NULL,
        touched_at INTEGER NOT NULL, PRIMARY KEY (attachment_id, chunk_index));
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
        body TEXT, result TEXT NOT NULL, created_at INTEGER NOT NULL);
      PRAGMA user_version = 1;`);
  }

  transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  get<T>(key: string): T | null {
    const row = this.db.prepare("SELECT data FROM metadata WHERE key = ?").get(key);
    return row ? JSON.parse(String(row.data)) as T : null;
  }
  set(key: string, value: unknown): void {
    this.db.prepare("INSERT INTO metadata (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data")
      .run(key, JSON.stringify(value));
  }
  bootstrap(): ApplicationConnectionBootstrap | null { return this.get("bootstrap"); }
  object(id: string): EncryptedObject | null {
    const row = this.db.prepare("SELECT data FROM objects WHERE id = ?").get(id);
    return row ? JSON.parse(String(row.data)) as EncryptedObject : null;
  }
  removeObject(id: string): void { this.db.prepare("DELETE FROM objects WHERE id = ?").run(id); }
  putObject(object: EncryptedObject): void {
    this.db.prepare("INSERT INTO objects (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(object.objectId, JSON.stringify(object));
  }
  applyPage(objects: EncryptedObject[], cursor: number, reset = false): void {
    this.transaction(() => {
      if (reset) this.db.exec("DELETE FROM objects");
      for (const object of objects) {
        if (object.purged) this.db.prepare("DELETE FROM objects WHERE id = ?").run(object.objectId);
        else this.putObject(object);
      }
      this.set("cursor", cursor);
    });
  }
  *objects(): Generator<EncryptedObject> {
    for (const row of this.db.prepare("SELECT data FROM objects ORDER BY id").iterate()) yield JSON.parse(String(row.data)) as EncryptedObject;
  }
  visibleObjects(): EncryptedObject[] {
    const objects = new Map([...this.objects()].map((object) => [object.objectId, object]));
    for (const operation of this.pending()) {
      if (!operation.body) continue;
      const note = operation.body.conflict?.note ?? operation.body.note;
      objects.set(note.objectId, note);
      for (const attachment of operation.body.conflict?.attachments ?? []) objects.set(attachment.objectId, attachment);
    }
    return [...objects.values()];
  }
  operation(id: string): Operation | null {
    const row = this.db.prepare("SELECT * FROM operations WHERE id = ?").get(id);
    return row ? { operationId: String(row.id), requestHash: String(row.request_hash),
      body: row.body === null ? null : JSON.parse(String(row.body)) as PendingWrite,
      result: JSON.parse(String(row.result)) as MutationResult } : null;
  }
  pending(): Operation[] {
    return [...this.db.prepare("SELECT id FROM operations WHERE body IS NOT NULL ORDER BY created_at, id").iterate()]
      .map((row) => this.operation(String(row.id))!);
  }
  pendingForObject(id: string): Operation | undefined {
    return this.pending().find((operation) => operation.body?.note.objectId === id || operation.body?.conflict?.note.objectId === id);
  }
  stage(operation: Operation): void {
    this.transaction(() => {
      this.db.prepare("INSERT INTO operations (id, request_hash, body, result, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(operation.operationId, operation.requestHash, JSON.stringify(operation.body), JSON.stringify(operation.result), Date.now());
      if (operation.body) this.putObject(operation.body.note);
    });
  }
  saveOperation(operation: Operation): void {
    this.db.prepare("UPDATE operations SET body = ?, result = ? WHERE id = ?")
      .run(operation.body ? JSON.stringify(operation.body) : null, JSON.stringify(operation.result), operation.operationId);
  }
  complete(operation: Operation, result: MutationResult, objects: EncryptedObject[], removedId?: string): void {
    this.transaction(() => {
      if (removedId) this.removeObject(removedId);
      for (const object of objects) this.putObject(object);
      this.saveOperation({ ...operation, body: null, result });
    });
  }
  chunk(id: string, index: number): EncryptedAttachmentChunk | null {
    const row = this.db.prepare("SELECT * FROM chunks WHERE attachment_id = ? AND chunk_index = ?").get(id, index);
    if (!row) return null;
    this.db.prepare("UPDATE chunks SET touched_at = ? WHERE attachment_id = ?").run(Date.now(), id);
    return { attachmentId: id, chunkIndex: index, ciphertext: Uint8Array.from(row.data as Uint8Array).buffer,
      nonce: String(row.nonce), totalChunks: Number(row.total_chunks), encryptionVersion: Number(row.encryption_version) };
  }
  removeChunks(id: string): void { this.db.prepare("DELETE FROM chunks WHERE attachment_id = ?").run(id); }
  putChunk(chunk: EncryptedAttachmentChunk): void {
    this.db.prepare(`INSERT INTO chunks (attachment_id, chunk_index, data, nonce, total_chunks, encryption_version, touched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(attachment_id, chunk_index) DO UPDATE SET data = excluded.data,
      nonce = excluded.nonce, total_chunks = excluded.total_chunks, encryption_version = excluded.encryption_version, touched_at = excluded.touched_at`)
      .run(chunk.attachmentId, chunk.chunkIndex, new Uint8Array(chunk.ciphertext), chunk.nonce, chunk.totalChunks, chunk.encryptionVersion, Date.now());
  }
  evictAttachments(limit = 128 * 1024 * 1024): void {
    const protectedIds = new Set(this.pending().flatMap((operation) => operation.body?.sourceAttachments.map((object) => object.objectId) ?? []));
    const groups = [...this.db.prepare("SELECT attachment_id, SUM(LENGTH(data)) AS size FROM chunks GROUP BY attachment_id ORDER BY MAX(touched_at)").iterate()];
    let size = groups.reduce((total, row) => total + Number(row.size), 0);
    for (const row of groups) {
      if (size <= limit) break;
      if (protectedIds.has(String(row.attachment_id))) continue;
      this.db.prepare("DELETE FROM chunks WHERE attachment_id = ?").run(row.attachment_id);
      size -= Number(row.size);
    }
  }
  close(): void { this.db.close(); }
}
