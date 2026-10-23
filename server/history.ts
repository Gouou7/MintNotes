import { historyChanged } from "./sync/lifecycle.js";
import type { AppDatabase } from "./database.js";

export const HISTORY_CAPTURE_KINDS = ["baseline", "interval", "idle", "manual", "restore-safety", "application-edit"] as const;
export type HistoryCaptureKind = (typeof HISTORY_CAPTURE_KINDS)[number];

const AUTOMATIC_KINDS = new Set<HistoryCaptureKind>(["baseline", "interval", "idle", "application-edit", "restore-safety"]);
const DAY_MS = 24 * 60 * 60 * 1000;

interface HistoryRow {
  note_id: string;
  history_id: string;
  captured_at: string;
  capture_kind: HistoryCaptureKind;
}

export function historyUsage(db: AppDatabase, userId: string): { count: number; usedBytes: number } {
  const row = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS used_bytes
    FROM note_history
    WHERE user_id = ?
  `).get(userId) as { count: number; used_bytes: number };
  return { count: Number(row.count), usedBytes: Number(row.used_bytes) };
}

export function cleanupUserHistory(
  db: AppDatabase,
  userId: string,
  now = new Date().toISOString()
): number {
  const settings = db.prepare(`
    SELECT history_retention_days
    FROM users
    WHERE id = ?
  `).get(userId) as { history_retention_days: number | null } | undefined;
  if (!settings) return 0;

  const nowMs = new Date(now).getTime();
  const removalKey = (noteId: string, historyId: string) => `${noteId}\u0000${historyId}`;
  const removeIds = new Set<string>();
  if (settings.history_retention_days !== null) {
    const cutoff = new Date(nowMs - settings.history_retention_days * DAY_MS).toISOString();
    const expired = db.prepare(`
      SELECT note_id, history_id
      FROM note_history
      WHERE user_id = ? AND is_protected = 0 AND COALESCE(retention_at, captured_at) <= ? AND capture_kind != 'manual'
        AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.user_id = note_history.user_id AND o.object_id = note_history.note_id AND o.deleted = 1)
    `).all(userId, cutoff) as Array<{ note_id: string; history_id: string }>;
    for (const row of expired) removeIds.add(removalKey(row.note_id, row.history_id));
  }

  const automatic = db.prepare(`
    SELECT note_id, history_id, COALESCE(retention_at, captured_at) AS captured_at, capture_kind
    FROM note_history
    WHERE user_id = ? AND is_protected = 0 AND COALESCE(retention_at, captured_at) < ?
      AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.user_id = note_history.user_id AND o.object_id = note_history.note_id AND o.deleted = 1)
      AND capture_kind IN ('baseline', 'interval', 'idle', 'application-edit', 'restore-safety')
    ORDER BY note_id ASC, captured_at DESC, history_id DESC
  `).all(userId, new Date(nowMs - DAY_MS).toISOString()) as HistoryRow[];
  const buckets = new Set<string>();
  for (const row of automatic) {
    const rowKey = removalKey(row.note_id, row.history_id);
    if (removeIds.has(rowKey) || !AUTOMATIC_KINDS.has(row.capture_kind)) continue;
    const capturedMs = new Date(row.captured_at).getTime();
    if (!Number.isFinite(capturedMs)) {
      removeIds.add(rowKey);
      continue;
    }
    const ageMs = nowMs - capturedMs;
    const bucketTime = ageMs < 7 * DAY_MS ? row.captured_at.slice(0, 13) : row.captured_at.slice(0, 10);
    const bucket = `${row.note_id}:${bucketTime}`;
    if (buckets.has(bucket)) removeIds.add(rowKey);
    else buckets.add(bucket);
  }

  if (!removeIds.size) return 0;
  const remove = db.prepare("DELETE FROM note_history WHERE user_id = ? AND note_id = ? AND history_id = ? AND is_protected = 0");
  return db.transaction(() => {
    let deleted = 0;
    for (const key of removeIds) {
      const [noteId, historyId] = key.split("\u0000");
      const count = remove.run(userId, noteId, historyId).changes;
      deleted += count;
      if (count) historyChanged(db, userId, noteId);
    }
    return deleted;
  })();
}

export function cleanupAllHistory(db: AppDatabase, now = new Date().toISOString()): number {
  const users = db.prepare("SELECT id FROM users").all() as Array<{ id: string }>;
  let deleted = 0;
  for (const user of users) deleted += cleanupUserHistory(db, user.id, now);
  return deleted;
}

/** Reclaim only automatic, unprotected versions belonging to live notes. */
export function reclaimHistorySpace(db: AppDatabase, userId: string, incoming: number, quota: number): boolean {
  return db.transaction(() => {
    let used = historyUsage(db, userId).usedBytes;
    if (used + incoming <= quota) return true;
    const rows = db.prepare(`SELECT h.note_id, h.history_id, h.byte_size FROM note_history h
      JOIN objects o ON o.user_id = h.user_id AND o.object_id = h.note_id
      WHERE h.user_id = ? AND h.is_protected = 0 AND h.capture_kind != 'manual' AND o.deleted = 0
      ORDER BY COALESCE(h.retention_at, h.captured_at), h.history_id`).all(userId) as Array<{ note_id: string; history_id: string; byte_size: number }>;
    // Do not destroy old history when even all eligible versions cannot fit the new one.
    if (used + incoming - rows.reduce((sum, r) => sum + r.byte_size, 0) > quota) return false;
    for (const row of rows) {
      if (used + incoming <= quota) break;
      db.prepare("DELETE FROM note_history WHERE user_id = ? AND note_id = ? AND history_id = ?").run(userId, row.note_id, row.history_id);
      used -= row.byte_size;
      historyChanged(db, userId, row.note_id);
    }
    return true;
  })();
}
