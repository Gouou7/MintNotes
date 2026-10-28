import type { AppDatabase } from "./database.js";
import { statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The same logical accounting is used by admission, account and admin views. */
export function storageUsage(db: AppDatabase, userId: string) {
  const row = db.prepare(`SELECT
    (SELECT COUNT(*) FROM objects WHERE user_id = ?) AS objectCount,
    COALESCE((SELECT SUM(LENGTH(CAST(ciphertext AS BLOB)) + LENGTH(CAST(nonce AS BLOB))) FROM objects WHERE user_id = ?), 0)
    + COALESCE((SELECT SUM(LENGTH(ciphertext) + LENGTH(CAST(nonce AS BLOB))) FROM attachment_chunks WHERE user_id = ?), 0) AS contentBytes,
    COALESCE((SELECT SUM(LENGTH(CAST(ciphertext AS BLOB)) + LENGTH(CAST(nonce AS BLOB))) FROM objects WHERE user_id = ? AND object_type != 'attachment'), 0) AS noteBytes,
    COALESCE((SELECT SUM(LENGTH(CAST(ciphertext AS BLOB)) + LENGTH(CAST(nonce AS BLOB))) FROM objects WHERE user_id = ? AND deleted = 1), 0)
    + COALESCE((SELECT SUM(LENGTH(c.ciphertext) + LENGTH(CAST(c.nonce AS BLOB))) FROM attachment_chunks c JOIN attachment_owners a ON a.user_id = c.user_id AND a.attachment_id = c.attachment_id
      WHERE c.user_id = ? AND EXISTS (SELECT 1 FROM objects o WHERE o.user_id = c.user_id AND o.object_id = a.note_id AND o.deleted = 1)), 0)
    + COALESCE((SELECT SUM(h.byte_size) FROM note_history h JOIN objects o ON o.user_id = h.user_id AND o.object_id = h.note_id WHERE h.user_id = ? AND o.deleted = 1), 0) AS trashBytes,
    COALESCE((SELECT SUM(byte_size) FROM note_history WHERE user_id = ?), 0) AS historyBytes,
    COALESCE((SELECT LENGTH(CAST(ciphertext AS BLOB)) + LENGTH(CAST(nonce AS BLOB)) FROM profile_assets WHERE user_id = ?), 0) AS profileBytes
  `).get(userId, userId, userId, userId, userId, userId, userId, userId, userId) as { objectCount: number; contentBytes: number; historyBytes: number; profileBytes: number; noteBytes: number; trashBytes: number };
  const body = db.prepare(`SELECT COALESCE(SUM(LENGTH(CAST(b.ciphertext AS BLOB)) + LENGTH(CAST(b.nonce AS BLOB))), 0) AS bytes,
    COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM objects o WHERE o.user_id = b.user_id AND o.object_id = b.note_id AND o.deleted = 1)
      THEN LENGTH(CAST(b.ciphertext AS BLOB)) + LENGTH(CAST(b.nonce AS BLOB)) ELSE 0 END), 0) AS trash
    FROM note_body_blocks b WHERE b.user_id = ?`).get(userId) as { bytes: number; trash: number };
  row.contentBytes += body.bytes; row.noteBytes += body.bytes; row.trashBytes += body.trash;
  return { ...row, attachmentBytes: row.contentBytes - row.noteBytes, totalBytes: row.contentBytes + row.historyBytes + row.profileBytes, ...metadataUsage(db, userId), encryptedBytes: row.contentBytes + row.historyBytes + row.profileBytes };
}
export function physicalStorageUsage(db: AppDatabase) {
  const size = (path: string) => { try { return statSync(path).size; } catch { return 0; } };
  const directory = resolve(process.env.BACKUP_DIR ?? join(dirname(db.name), "backups"));
  let backupsBytes = 0;
  try { for (const name of readdirSync(directory)) if (/\.(?:sqlite|sha256|json)$/.test(name)) backupsBytes += size(join(directory, name)); } catch { /* No backups yet. */ }
  return { databaseBytes: size(db.name), walBytes: size(`${db.name}-wal`), shmBytes: size(`${db.name}-shm`), backupsBytes };
}

export function metadataUsage(db: AppDatabase, userId: string) {
  const row = db.prepare(`SELECT (SELECT COUNT(*) * 2 FROM objects WHERE user_id = ?) +
    (SELECT COUNT(*) FROM sync_receipts WHERE user_id = ?) + (SELECT COUNT(*) FROM changes WHERE user_id = ?) + (SELECT COUNT(*) FROM note_trash_periods WHERE user_id = ?)
    + (SELECT COUNT(*) * 2 FROM note_body_blocks WHERE user_id = ?) AS used`)
    .get(userId, userId, userId, userId, userId) as { used: number };
  return { metadataUsedSlots: row.used, metadataLimit: 100_000 };
}

export function databaseStorageStatus(db: AppDatabase) {
  const pageSize = Number(db.pragma("page_size", { simple: true }));
  const freePages = Number(db.pragma("freelist_count", { simple: true }));
  const users = db.prepare("SELECT id FROM users").all() as Array<{ id: string }>;
  return { ...physicalStorageUsage(db), reusableBytes: pageSize * freePages,
    logicalBytes: users.reduce((sum, row) => sum + storageUsage(db, row.id).totalBytes, 0), userCount: users.length,
    sqliteVersion: (db.prepare("SELECT sqlite_version() AS version").get() as { version: string }).version,
    schemaVersion: Number(db.pragma("user_version", { simple: true })), journalMode: db.pragma("journal_mode", { simple: true }),
    checkedAt: new Date().toISOString(), available: db.open };
}
