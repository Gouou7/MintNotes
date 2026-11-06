import type { AppDatabase } from "../database.js";
import { revokeApplicationConnections } from "../applications/service.js";

/** Called inside the credential mutation transaction. */
export function revokeUserCredentials(db: AppDatabase, userId: string, keep?: { tokenHash: string; endpointId: string }): void {
  const now = new Date().toISOString();
  if (keep) {
    db.prepare("DELETE FROM device_grants WHERE endpoint_id IN (SELECT endpoint_id FROM trusted_endpoints WHERE user_id = ? AND endpoint_id <> ?)").run(userId, keep.endpointId);
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL").run(now, userId, keep.tokenHash);
    db.prepare("UPDATE trusted_endpoints SET remembered = 0, revoked_at = ? WHERE user_id = ? AND endpoint_id <> ? AND revoked_at IS NULL").run(now, userId, keep.endpointId);
  } else {
    db.prepare("DELETE FROM device_grants WHERE endpoint_id IN (SELECT endpoint_id FROM trusted_endpoints WHERE user_id = ?)").run(userId);
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, userId);
    db.prepare("UPDATE trusted_endpoints SET remembered = 0, revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, userId);
  }
  revokeApplicationConnections(db, userId, now);
}
