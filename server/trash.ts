import type { AppDatabase } from "./database.js";

export interface PurgeTarget {
  objectId: string;
  baseRevision: number;
}

export interface PurgeChange {
  userId: string;
  cursor: number;
}

function removeObject(db: AppDatabase, userId: string, objectId: string, objectType: string, now: string): PurgeChange {
  if (objectType === "attachment") {
    db.prepare("DELETE FROM attachment_chunks WHERE user_id = ? AND attachment_id = ?").run(userId, objectId);
  }
  if (objectType === "note") {
    db.prepare("DELETE FROM note_history WHERE user_id = ? AND note_id = ?").run(userId, objectId);
    db.prepare("DELETE FROM note_history_clear_markers WHERE user_id = ? AND note_id = ?").run(userId, objectId);
  }
  db.prepare("DELETE FROM changes WHERE user_id = ? AND object_id = ?").run(userId, objectId);
  db.prepare("DELETE FROM objects WHERE user_id = ? AND object_id = ?").run(userId, objectId);
  db.prepare("DELETE FROM object_revisions WHERE user_id = ? AND object_id = ?").run(userId, objectId);
  const cursor = Number(db.prepare("INSERT INTO changes (user_id, object_id, revision, change_type, created_at) VALUES (?, ?, NULL, 'purge', ?)")
    .run(userId, objectId, now).lastInsertRowid);
  return { userId, cursor };
}

export function purgeTargets(db: AppDatabase, userId: string, targets: PurgeTarget[], now = new Date().toISOString()): PurgeChange[] {
  return db.transaction(() => {
    const changes: PurgeChange[] = [];
    for (const target of targets) {
      const row = db.prepare("SELECT object_type, revision, deleted FROM objects WHERE user_id = ? AND object_id = ?").get(userId, target.objectId) as { object_type: string; revision: number; deleted: number } | undefined;
      if (!row || !row.deleted || row.revision !== target.baseRevision) throw new Error("PURGE_CONFLICT");
      changes.push(removeObject(db, userId, target.objectId, row.object_type, now));
    }
    return changes;
  })();
}

export function purgeExpiredTrash(
  db: AppDatabase,
  now = new Date().toISOString(),
  onPurged?: (changes: PurgeChange[]) => void
): number {
  const expired = db.prepare(`
    SELECT o.user_id, o.object_id, o.object_type
    FROM objects o
    JOIN users u ON u.id = o.user_id
    WHERE o.deleted = 1
      AND u.trash_retention_days IS NOT NULL
      AND julianday(o.updated_at) <= julianday(?) - u.trash_retention_days
  `).all(now) as Array<{ user_id: string; object_id: string; object_type: string }>;
  const changes = db.transaction(() => {
    const committed: PurgeChange[] = [];
    for (const row of expired) committed.push(removeObject(db, row.user_id, row.object_id, row.object_type, now));
    return committed;
  })();
  if (changes.length) onPurged?.(changes);
  return expired.length;
}
