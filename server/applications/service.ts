import { timingSafeEqual } from "node:crypto";
import { effectiveApplicationExpiry, type ApplicationConnection, type ApplicationConnectionBootstrap } from "@mint-notes/application-client";
import type { AppDatabase } from "../database.js";
import { hashToken } from "../security.js";

export function initializeApplicationConnections(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS application_connections (
      connection_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      access TEXT NOT NULL CHECK (access IN ('read', 'read-write')),
      auth_hash TEXT NOT NULL,
      envelope_ciphertext TEXT NOT NULL,
      envelope_nonce TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      idle_timeout_days INTEGER CHECK (idle_timeout_days IS NULL OR idle_timeout_days IN (7, 30, 90)),
      expires_at TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS application_connections_user ON application_connections(user_id, created_at);
  `);
}

export interface ApplicationRow {
  connection_id: string;
  user_id: string;
  name: string;
  access: "read" | "read-write";
  auth_hash: string;
  envelope_ciphertext: string;
  envelope_nonce: string;
  created_at: string;
  last_used_at: string | null;
  idle_timeout_days: 7 | 30 | 90 | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export function applicationSummary(row: ApplicationRow, now = Date.now()): ApplicationConnection {
  const value = {
    connectionId: row.connection_id,
    name: row.name,
    access: row.access,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    idleTimeoutDays: row.idle_timeout_days,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  };
  const validUntil = effectiveApplicationExpiry(value);
  return { ...value, validUntil, status: row.revoked_at ? "revoked"
    : validUntil && Date.parse(validUntil) <= now ? "expired" : "active" };
}

export function verifyApplicationSecret(secret: string, hash: string): boolean {
  const actual = Buffer.from(hashToken(secret), "hex");
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function revokeApplicationConnections(db: AppDatabase, userId: string, now = new Date().toISOString()): void {
  db.prepare("UPDATE application_connections SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, userId);
}

export function applicationBootstrap(db: AppDatabase, row: ApplicationRow): ApplicationConnectionBootstrap {
  const user = db.prepare("SELECT history_enabled FROM users WHERE id = ?").get(row.user_id) as { history_enabled: number };
  return {
    protocolVersion: 1, objectSchemaVersion: 2, encryptionVersion: 1,
    userId: row.user_id,
    connection: applicationSummary(row),
    vaultEnvelope: { version: 1, ciphertext: row.envelope_ciphertext, nonce: row.envelope_nonce },
    historyEnabled: Boolean(user.history_enabled),
    serverTime: new Date().toISOString()
  };
}
