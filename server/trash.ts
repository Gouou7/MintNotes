import type { AppDatabase } from "./database.js";
import { recordChange } from "./sync/lifecycle.js";

export interface PurgeTarget { objectId: string; baseRevision: number; }
export interface PurgeChange { userId: string; cursor: number; }

function requireOwnership(db: AppDatabase, userId: string) {
  const state = db.prepare("SELECT complete FROM ownership_state WHERE user_id = ?").get(userId) as { complete: number } | undefined;
  if (state?.complete === 0 || db.prepare("SELECT 1 FROM objects WHERE user_id = ? AND object_type = 'attachment' AND owner_note_id IS NULL LIMIT 1").get(userId)) throw new Error("OWNERSHIP_INCOMPLETE");
}
function removeObject(db: AppDatabase, userId: string, objectId: string, objectType: string, now: string, changes: PurgeChange[]) {
  if (objectType === "note") {
    const attachments = db.prepare("SELECT object_id FROM objects WHERE user_id = ? AND owner_note_id = ?").all(userId, objectId) as Array<{ object_id: string }>;
    for (const attachment of attachments) removeObject(db, userId, attachment.object_id, "attachment", now, changes);
    const pendingOwners = db.prepare("SELECT attachment_id FROM attachment_owners WHERE user_id = ? AND note_id = ?").all(userId, objectId) as Array<{ attachment_id: string }>;
    for (const owner of pendingOwners) {
      db.prepare("DELETE FROM attachment_chunks WHERE user_id = ? AND attachment_id = ?").run(userId, owner.attachment_id);
    }
    db.prepare("DELETE FROM attachment_owners WHERE user_id = ? AND note_id = ?").run(userId, objectId);
    db.prepare("DELETE FROM note_history WHERE user_id = ? AND note_id = ?").run(userId, objectId);
    db.prepare("DELETE FROM note_history_clear_markers WHERE user_id = ? AND note_id = ?").run(userId, objectId);
    db.prepare("DELETE FROM note_trash_periods WHERE user_id = ? AND note_id = ?").run(userId, objectId);
    db.prepare("DELETE FROM history_versions WHERE user_id = ? AND note_id = ?").run(userId, objectId);
    db.prepare("DELETE FROM ownership_versions WHERE user_id = ? AND note_id = ?").run(userId, objectId);
    db.prepare("DELETE FROM attachment_gc WHERE user_id = ? AND note_id = ?").run(userId, objectId);
  }
  if (objectType === "attachment") {
    db.prepare("DELETE FROM attachment_chunks WHERE user_id = ? AND attachment_id = ?").run(userId, objectId);
    db.prepare("DELETE FROM attachment_owners WHERE user_id = ? AND attachment_id = ?").run(userId, objectId);
    db.prepare("DELETE FROM attachment_gc WHERE user_id = ? AND attachment_id = ?").run(userId, objectId);
  }
  db.prepare("DELETE FROM changes WHERE user_id = ? AND object_id = ?").run(userId, objectId);
  db.prepare("DELETE FROM objects WHERE user_id = ? AND object_id = ?").run(userId, objectId);
  changes.push({ userId, cursor: recordChange(db, userId, objectId, null, "purge", now) });
}
export function purgeTargets(db: AppDatabase, userId: string, targets: PurgeTarget[], now = new Date().toISOString()): PurgeChange[] {
  return db.transaction(() => {
    const rows = targets.map((target) => {
      const row = db.prepare("SELECT object_type, revision, deleted FROM objects WHERE user_id = ? AND object_id = ?").get(userId, target.objectId) as { object_type: string; revision: number; deleted: number } | undefined;
      if (!row && db.prepare("SELECT 1 FROM changes WHERE user_id = ? AND object_id = ? AND change_type = 'purge'").get(userId, target.objectId)) return null;
      if (!row || !row.deleted || row.revision !== target.baseRevision) throw new Error("PURGE_CONFLICT");
      return { ...row, objectId: target.objectId };
    }).filter((row): row is NonNullable<typeof row> => row !== null);
    if (rows.length) requireOwnership(db, userId);
    const selected = new Set(targets.map((r) => r.objectId));
    for (const row of rows) if (row.object_type === "attachment") {
      const owner = db.prepare("SELECT owner_note_id FROM objects WHERE user_id = ? AND object_id = ?").get(userId, row.objectId) as { owner_note_id: string | null };
      if (owner.owner_note_id && !selected.has(owner.owner_note_id) && db.prepare("SELECT 1 FROM objects WHERE user_id = ? AND object_id = ?").get(userId, owner.owner_note_id)) throw new Error("PURGE_CONFLICT");
    }
    const changes: PurgeChange[] = [];
    for (const row of rows.sort((a, b) => Number(b.object_type === "note") - Number(a.object_type === "note"))) {
      if (db.prepare("SELECT 1 FROM objects WHERE user_id = ? AND object_id = ?").get(userId, row.objectId)) removeObject(db, userId, row.objectId, row.object_type, now, changes);
    }
    return changes;
  })();
}
export function purgeUnusedAttachment(db: AppDatabase, userId: string, attachmentId: string): PurgeChange[] {
  const changes: PurgeChange[] = [];
  removeObject(db, userId, attachmentId, "attachment", new Date().toISOString(), changes);
  return changes;
}
export function purgeExpiredTrash(db: AppDatabase, now = new Date().toISOString(), onPurged?: (changes: PurgeChange[]) => void): number {
  const expired = db.prepare(`SELECT o.user_id, o.object_id, o.object_type, o.revision FROM objects o JOIN users u ON u.id = o.user_id
    WHERE o.deleted = 1 AND u.trash_retention_days IS NOT NULL
      AND julianday(COALESCE(o.trashed_at, o.updated_at)) <= julianday(?) - u.trash_retention_days
      AND (o.trash_grace_until IS NULL OR o.trash_grace_until <= ?)
      AND (o.object_type != 'attachment' OR NOT EXISTS (SELECT 1 FROM objects n WHERE n.user_id = o.user_id AND n.object_id = o.owner_note_id))
    ORDER BY CASE o.object_type WHEN 'note' THEN 0 ELSE 1 END`).all(now, now) as Array<{ user_id: string; object_id: string; object_type: string; revision: number }>;
  const changes: PurgeChange[] = [];
  for (const row of expired) {
    if (!db.prepare("SELECT 1 FROM objects WHERE user_id = ? AND object_id = ?").get(row.user_id, row.object_id)) continue;
    try { changes.push(...purgeTargets(db, row.user_id, [{ objectId: row.object_id, baseRevision: row.revision }], now)); }
    catch (error) { if (!(error instanceof Error) || error.message !== "OWNERSHIP_INCOMPLETE") throw error; }
  }
  if (changes.length) onPurged?.(changes);
  return changes.length;
}
