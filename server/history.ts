import type { AppDatabase } from "./database.js";

export const HISTORY_CAPTURE_KINDS = ["baseline", "interval", "idle", "manual", "restore-safety"] as const;
export type HistoryCaptureKind = (typeof HISTORY_CAPTURE_KINDS)[number];

const AUTOMATIC_KINDS = new Set<HistoryCaptureKind>(["baseline", "interval", "idle"]);
const DAY_MS = 24 * 60 * 60 * 1000;

interface HistoryRow {
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
  const removeIds = new Set<string>();
  if (settings.history_retention_days !== null) {
    const cutoff = new Date(nowMs - settings.history_retention_days * DAY_MS).toISOString();
    const expired = db.prepare(`
      SELECT history_id
      FROM note_history
      WHERE user_id = ? AND captured_at <= ?
    `).all(userId, cutoff) as Array<{ history_id: string }>;
    for (const row of expired) removeIds.add(row.history_id);
  }

  const automatic = db.prepare(`
    SELECT history_id, captured_at, capture_kind
    FROM note_history
    WHERE user_id = ? AND captured_at < ?
      AND capture_kind IN ('baseline', 'interval', 'idle')
    ORDER BY note_id ASC, captured_at DESC, history_id DESC
  `).all(userId, new Date(nowMs - DAY_MS).toISOString()) as HistoryRow[];
  const buckets = new Set<string>();
  const noteByHistory = new Map<string, string>();
  const noteRows = db.prepare(`
    SELECT history_id, note_id
    FROM note_history
    WHERE user_id = ? AND captured_at < ?
      AND capture_kind IN ('baseline', 'interval', 'idle')
  `).all(userId, new Date(nowMs - DAY_MS).toISOString()) as Array<{ history_id: string; note_id: string }>;
  for (const row of noteRows) noteByHistory.set(row.history_id, row.note_id);

  for (const row of automatic) {
    if (removeIds.has(row.history_id) || !AUTOMATIC_KINDS.has(row.capture_kind)) continue;
    const capturedMs = new Date(row.captured_at).getTime();
    if (!Number.isFinite(capturedMs)) {
      removeIds.add(row.history_id);
      continue;
    }
    const ageMs = nowMs - capturedMs;
    const bucketTime = ageMs < 7 * DAY_MS ? row.captured_at.slice(0, 13) : row.captured_at.slice(0, 10);
    const bucket = `${noteByHistory.get(row.history_id) ?? ""}:${bucketTime}`;
    if (buckets.has(bucket)) removeIds.add(row.history_id);
    else buckets.add(bucket);
  }

  if (!removeIds.size) return 0;
  const remove = db.prepare("DELETE FROM note_history WHERE user_id = ? AND history_id = ?");
  return db.transaction(() => {
    let deleted = 0;
    for (const historyId of removeIds) deleted += remove.run(userId, historyId).changes;
    return deleted;
  })();
}

export function cleanupAllHistory(db: AppDatabase, now = new Date().toISOString()): number {
  const users = db.prepare("SELECT id FROM users").all() as Array<{ id: string }>;
  let deleted = 0;
  for (const user of users) deleted += cleanupUserHistory(db, user.id, now);
  return deleted;
}
