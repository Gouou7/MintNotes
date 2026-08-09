import type { AppDatabase } from "../database.js";

const ORPHAN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Remove abandoned chunk uploads only after a long staging grace period. */
export function cleanupOrphanAttachmentChunks(
  db: AppDatabase,
  now = new Date().toISOString()
): number {
  const cutoff = new Date(new Date(now).getTime() - ORPHAN_RETENTION_MS).toISOString();
  return db.prepare(`
    DELETE FROM attachment_chunks
    WHERE created_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM objects
        WHERE objects.user_id = attachment_chunks.user_id
          AND objects.object_id = attachment_chunks.attachment_id
          AND objects.object_type = 'attachment'
      )
  `).run(cutoff).changes;
}
