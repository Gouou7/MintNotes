import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppDatabase } from "../database.js";
import { operationTime, operationExpired, SYNC_LIFETIME_MS } from "@mint-notes/application-client";

export { operationExpired, SYNC_LIFETIME_MS };
export const operationKeySchema = z.string().refine((value) => operationTime(value) !== null);
export class OperationExpiredError extends Error {
  readonly statusCode = 409;
  readonly code = "OPERATION_EXPIRED";
  constructor() { super("Operation expired; reconcile and recover the local proposal before retrying"); }
}
export function requireLiveOperation(key: string) {
  if (operationExpired(key)) throw new OperationExpiredError();
}
export function syncState(db: AppDatabase, userId: string) {
  db.prepare("INSERT OR IGNORE INTO sync_state (user_id, epoch, lease_secret) VALUES (?, ?, ?)").run(userId, randomUUID(), randomUUID() + randomUUID());
  return db.prepare("SELECT epoch, head, floor FROM sync_state WHERE user_id = ?").get(userId) as { epoch: string; head: number; floor: number };
}
export function recordChange(db: AppDatabase, userId: string, objectId: string, revision: number | null, type: "upsert" | "purge", now: string, category = "object"): number {
  syncState(db, userId);
  db.prepare("DELETE FROM changes WHERE user_id = ? AND object_id = ? AND category = ?").run(userId, objectId, category);
  const sequence = Number(db.prepare("INSERT INTO changes (user_id, object_id, revision, change_type, created_at, category) VALUES (?, ?, ?, ?, ?, ?)")
    .run(userId, objectId, revision, type, now, category).lastInsertRowid);
  db.prepare("UPDATE sync_state SET head = MAX(head, ?) WHERE user_id = ?").run(sequence, userId);
  return sequence;
}
export function historyChanged(db: AppDatabase, userId: string, noteId: string) {
  db.prepare("DELETE FROM attachment_gc WHERE user_id = ? AND note_id = ?").run(userId, noteId);
  db.prepare(`INSERT INTO history_versions (user_id, note_id, version) VALUES (?, ?, 1)
    ON CONFLICT(user_id, note_id) DO UPDATE SET version = version + 1`).run(userId, noteId);
  const { version } = db.prepare("SELECT version FROM history_versions WHERE user_id = ? AND note_id = ?").get(userId, noteId) as { version: number };
  recordChange(db, userId, noteId, version, "upsert", new Date().toISOString(), "history");
}
export function cleanupSyncMetadata(db: AppDatabase, now = Date.now()): number {
  const cutoff = new Date(now - SYNC_LIFETIME_MS).toISOString();
  return db.transaction(() => {
    for (const row of db.prepare("SELECT user_id, MAX(sequence) AS floor FROM changes WHERE change_type = 'purge' AND created_at <= ? GROUP BY user_id").all(cutoff) as Array<{ user_id: string; floor: number }>) {
      db.prepare("UPDATE sync_state SET floor = MAX(floor, ?) WHERE user_id = ?").run(row.floor, row.user_id);
    }
    const deleted = db.prepare("DELETE FROM changes WHERE change_type = 'purge' AND created_at <= ?").run(cutoff).changes;
    db.prepare("DELETE FROM sync_receipts WHERE created_at <= ?").run(cutoff);
    return deleted;
  })();
}
