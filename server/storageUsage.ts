import type { AppDatabase } from "./database.js";
import { statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The same logical accounting is used by admission, account and admin views. */
export function storageUsage(db: AppDatabase, userId: string) {
  const row = db.prepare(`SELECT
    (SELECT COUNT(*) FROM objects WHERE user_id = ?) AS objectCount,
    COALESCE((SELECT SUM(LENGTH(CAST(ciphertext AS BLOB)) + LENGTH(CAST(nonce AS BLOB))) FROM objects WHERE user_id = ?), 0)
    + COALESCE((SELECT SUM(LENGTH(ciphertext) + LENGTH(CAST(nonce AS BLOB))) FROM attachment_chunks WHERE user_id = ?), 0) AS contentBytes,
    COALESCE((SELECT SUM(byte_size) FROM note_history WHERE user_id = ?), 0) AS historyBytes,
    COALESCE((SELECT LENGTH(CAST(ciphertext AS BLOB)) + LENGTH(CAST(nonce AS BLOB)) FROM profile_assets WHERE user_id = ?), 0) AS profileBytes
  `).get(userId, userId, userId, userId, userId) as { objectCount: number; contentBytes: number; historyBytes: number; profileBytes: number };
  return { ...row, ...metadataUsage(db, userId), encryptedBytes: row.contentBytes + row.historyBytes + row.profileBytes };
}
export function physicalStorageUsage(db: AppDatabase) {
  const size = (path: string) => { try { return statSync(path).size; } catch { return 0; } };
  const directory = resolve(process.env.BACKUP_DIR ?? join(dirname(db.name), "backups"));
  let backupsBytes = 0;
  try { for (const name of readdirSync(directory)) if (/\.(?:sqlite|sha256|json)$/.test(name)) backupsBytes += size(join(directory, name)); } catch { /* No backups yet. */ }
  return { databaseBytes: size(db.name), walBytes: size(`${db.name}-wal`), backupsBytes };
}

export function metadataUsage(db: AppDatabase, userId: string) {
  const row = db.prepare(`SELECT (SELECT COUNT(*) * 2 FROM objects WHERE user_id = ?) +
    (SELECT COUNT(*) FROM sync_receipts WHERE user_id = ?) + (SELECT COUNT(*) FROM changes WHERE user_id = ?) + (SELECT COUNT(*) FROM note_trash_periods WHERE user_id = ?) AS used`)
    .get(userId, userId, userId, userId) as { used: number };
  return { metadataUsedSlots: row.used, metadataLimit: 100_000 };
}
