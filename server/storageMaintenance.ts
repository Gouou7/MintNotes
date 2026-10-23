import type { AppDatabase } from "./database.js";
import { cleanupSyncMetadata } from "./sync/lifecycle.js";

export function cleanupOperationalRecords(db: AppDatabase, now = Date.now()): number {
  return db.transaction(() => {
    const cutoff = new Date(now - 90 * 86_400_000).toISOString();
    db.prepare("DELETE FROM note_trash_periods WHERE restored_at IS NOT NULL AND restored_at <= ?").run(cutoff);
    const connections = db.prepare(`DELETE FROM application_connections WHERE
      (revoked_at IS NOT NULL AND revoked_at <= ?) OR (expires_at IS NOT NULL AND expires_at <= ?) OR
      (idle_timeout_days IS NOT NULL AND julianday(COALESCE(last_used_at, created_at)) + idle_timeout_days <= julianday(?))`)
      .run(cutoff, cutoff, cutoff).changes;
    db.prepare("DELETE FROM account_setups WHERE expires_at <= ?").run(new Date(now).toISOString());
    // Owners of abandoned uploads must expire with their last unmanifested chunk.
    db.prepare(`DELETE FROM attachment_owners WHERE NOT EXISTS (SELECT 1 FROM objects o WHERE o.user_id = attachment_owners.user_id AND o.object_id = attachment_owners.attachment_id)
      AND NOT EXISTS (SELECT 1 FROM attachment_chunks c WHERE c.user_id = attachment_owners.user_id AND c.attachment_id = attachment_owners.attachment_id)`).run();
    return connections + cleanupSyncMetadata(db, now);
  })();
}
