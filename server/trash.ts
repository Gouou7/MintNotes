import type { AppDatabase } from "./database.js";

export interface PurgeTarget {
  objectId: string;
  baseRevision: number;
}

export interface PurgeChange {
  userId: string;
  cursor: number;
}

function isProtectedPurgeTarget(db: AppDatabase, userId: string, objectId: string, objectType: string): boolean {
  if (objectType === "note") {
    return Boolean(db.prepare(`
      SELECT 1 FROM note_history
      WHERE user_id = ? AND note_id = ? AND is_protected = 1 LIMIT 1
    `).get(userId, objectId));
  }
  if (objectType === "attachment") {
    return Boolean(db.prepare(`
      SELECT 1 FROM protected_history_attachments
      WHERE user_id = ? AND attachment_id = ? LIMIT 1
    `).get(userId, objectId));
  }
  return false;
}

function removeObject(db: AppDatabase, userId: string, objectId: string, objectType: string, now: string): PurgeChange {
  if (isProtectedPurgeTarget(db, userId, objectId, objectType)) throw new Error("PROTECTED_HISTORY");
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
      if (isProtectedPurgeTarget(db, userId, target.objectId, row.object_type)) throw new Error("PROTECTED_HISTORY");
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
      AND NOT (
        o.object_type = 'note' AND EXISTS (
          SELECT 1 FROM note_history h
          WHERE h.user_id = o.user_id AND h.note_id = o.object_id AND h.is_protected = 1
        )
      )
      AND NOT (
        o.object_type = 'attachment' AND EXISTS (
          SELECT 1 FROM protected_history_attachments r
          WHERE r.user_id = o.user_id AND r.attachment_id = o.object_id
        )
      )
  `).all(now) as Array<{ user_id: string; object_id: string; object_type: string }>;
  const changes = db.transaction(() => {
    const committed: PurgeChange[] = [];
    for (const row of expired) committed.push(removeObject(db, row.user_id, row.object_id, row.object_type, now));
    return committed;
  })();
  if (changes.length) onPurged?.(changes);
  return expired.length;
}
