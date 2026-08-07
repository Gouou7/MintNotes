import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type AppDatabase = Database.Database;
export type RegistrationRole = "admin" | "user";

const SCHEMA_VERSION = 2;

export function runRegistrationTransaction<T>(
  db: AppDatabase,
  allowRegistration: boolean,
  createUser: (role: RegistrationRole) => T
): { role: RegistrationRole; value: T } {
  const transaction = db.transaction(() => {
    const userCount = (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
    if (userCount > 0 && !allowRegistration) throw new Error("REGISTRATION_CLOSED");
    const role: RegistrationRole = userCount === 0 ? "admin" : "user";
    return { role, value: createUser(role) };
  });

  // BEGIN IMMEDIATE serializes the empty-database check with the user insert,
  // including when multiple service processes share the same SQLite file.
  return transaction.immediate();
}

export function openDatabase(dataDirectory: string): AppDatabase {
  mkdirSync(dataDirectory, { recursive: true });
  const db = new Database(join(dataDirectory, "notes.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  const version = Number(db.pragma("user_version", { simple: true }));
  const hasLegacyTables = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get());
  if (version !== 0 && version !== SCHEMA_VERSION) {
    db.close();
    throw new Error(`Unsupported database schema ${version}; Mint Notes requires a fresh schema v${SCHEMA_VERSION} volume`);
  }
  if (version === 0 && hasLegacyTables) {
    db.close();
    throw new Error("Legacy database detected; export and back it up, then deploy Mint Notes v2 with a fresh data volume");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      disabled INTEGER NOT NULL DEFAULT 0,
      auth_salt TEXT NOT NULL,
      auth_hash TEXT NOT NULL,
      kdf_salt TEXT NOT NULL,
      kdf_params TEXT NOT NULL,
      wrapped_vault_key TEXT NOT NULL,
      wrapped_vault_nonce TEXT NOT NULL,
      recovery_auth_salt TEXT NOT NULL,
      recovery_auth_hash TEXT NOT NULL,
      recovery_wrapped_vault_key TEXT NOT NULL,
      recovery_wrapped_vault_nonce TEXT NOT NULL,
      envelope_version INTEGER NOT NULL DEFAULT 1 CHECK (envelope_version IN (1, 2)),
      envelope_context TEXT,
      trash_retention_days INTEGER DEFAULT 30 CHECK (trash_retention_days IS NULL OR trash_retention_days BETWEEN 1 AND 3650),
      history_enabled INTEGER NOT NULL DEFAULT 1 CHECK (history_enabled IN (0, 1)),
      history_interval_minutes INTEGER NOT NULL DEFAULT 10 CHECK (history_interval_minutes IN (5, 10, 30, 60)),
      history_retention_days INTEGER DEFAULT 90 CHECK (history_retention_days IS NULL OR history_retention_days IN (7, 30, 90, 180, 365)),
      history_cleared_before TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trusted_endpoints (
      endpoint_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint_hash TEXT NOT NULL,
      device_name TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      login_count INTEGER NOT NULL DEFAULT 1,
      remembered INTEGER NOT NULL DEFAULT 0,
      revoked_at TEXT,
      UNIQUE (user_id, endpoint_hash)
    );
    CREATE INDEX IF NOT EXISTS trusted_endpoints_user_seen ON trusted_endpoints(user_id, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint_id TEXT NOT NULL REFERENCES trusted_endpoints(endpoint_id) ON DELETE CASCADE,
      remembered INTEGER NOT NULL DEFAULT 0,
      device_name TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS objects (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      object_id TEXT NOT NULL,
      object_type TEXT NOT NULL CHECK (object_type IN ('note', 'folder', 'attachment')),
      ciphertext TEXT NOT NULL,
      nonce TEXT NOT NULL,
      encryption_version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, object_id)
    );

    CREATE TABLE IF NOT EXISTS object_revisions (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      object_id TEXT NOT NULL,
      object_type TEXT NOT NULL CHECK (object_type IN ('note', 'folder', 'attachment')),
      ciphertext TEXT NOT NULL,
      nonce TEXT NOT NULL,
      encryption_version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, object_id, revision),
      UNIQUE (user_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS changes (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      object_id TEXT NOT NULL,
      revision INTEGER,
      change_type TEXT NOT NULL CHECK (change_type IN ('upsert', 'purge')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS changes_user_sequence ON changes(user_id, sequence);

    CREATE TABLE IF NOT EXISTS attachment_chunks (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      attachment_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      total_chunks INTEGER NOT NULL,
      ciphertext BLOB NOT NULL,
      nonce TEXT NOT NULL,
      encryption_version INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, attachment_id, chunk_index),
      UNIQUE (user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS attachment_chunks_user_attachment ON attachment_chunks(user_id, attachment_id);

    CREATE TABLE IF NOT EXISTS note_history (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note_id TEXT NOT NULL,
      history_id TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      capture_kind TEXT NOT NULL CHECK (capture_kind IN ('baseline', 'interval', 'idle', 'manual', 'restore-safety')),
      ciphertext TEXT NOT NULL,
      nonce TEXT NOT NULL,
      encryption_version INTEGER NOT NULL,
      metadata_ciphertext TEXT,
      metadata_nonce TEXT,
      metadata_encryption_version INTEGER,
      is_protected INTEGER NOT NULL DEFAULT 0 CHECK (is_protected IN (0, 1)),
      byte_size INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, note_id, history_id),
      UNIQUE (user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS note_history_user_note_time ON note_history(user_id, note_id, captured_at DESC, history_id DESC);
    CREATE INDEX IF NOT EXISTS note_history_user_time ON note_history(user_id, captured_at DESC);

    CREATE TABLE IF NOT EXISTS protected_history_attachments (
      user_id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      history_id TEXT NOT NULL,
      attachment_id TEXT NOT NULL,
      PRIMARY KEY (user_id, note_id, history_id, attachment_id),
      FOREIGN KEY (user_id, note_id, history_id)
        REFERENCES note_history(user_id, note_id, history_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS protected_history_attachment_lookup
      ON protected_history_attachments(user_id, attachment_id);

    CREATE TABLE IF NOT EXISTS note_history_clear_markers (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note_id TEXT NOT NULL,
      cleared_before TEXT NOT NULL,
      PRIMARY KEY (user_id, note_id)
    );

    CREATE TABLE IF NOT EXISTS account_setups (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile_assets (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ciphertext TEXT NOT NULL,
      nonce TEXT NOT NULL,
      encryption_version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    PRAGMA user_version = ${SCHEMA_VERSION};
  `);

  // Supported schema-v2 deployments receive new metadata-only tables
  // additively. Profile asset bytes remain opaque ciphertext.
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_assets (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ciphertext TEXT NOT NULL,
      nonce TEXT NOT NULL,
      encryption_version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Schema v2 deployments created before device-session management have a
  // smaller sessions table. These additions are metadata-only and preserve
  // every existing session without touching encrypted user objects.
  const sessionColumns = new Set(
    (db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!sessionColumns.has("session_id")) db.exec("ALTER TABLE sessions ADD COLUMN session_id TEXT");
  if (!sessionColumns.has("device_name")) db.exec("ALTER TABLE sessions ADD COLUMN device_name TEXT NOT NULL DEFAULT 'Unknown device'");
  if (!sessionColumns.has("user_agent")) db.exec("ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT ''");
  if (!sessionColumns.has("ip_address")) db.exec("ALTER TABLE sessions ADD COLUMN ip_address TEXT NOT NULL DEFAULT ''");
  if (!sessionColumns.has("last_seen_at")) db.exec("ALTER TABLE sessions ADD COLUMN last_seen_at TEXT");
  if (!sessionColumns.has("revoked_at")) db.exec("ALTER TABLE sessions ADD COLUMN revoked_at TEXT");
  const requiresEndpointMigration = !sessionColumns.has("endpoint_id");
  if (requiresEndpointMigration) db.exec("ALTER TABLE sessions ADD COLUMN endpoint_id TEXT");
  if (!sessionColumns.has("remembered")) db.exec("ALTER TABLE sessions ADD COLUMN remembered INTEGER NOT NULL DEFAULT 0");
  const legacySessions = db.prepare("SELECT token_hash, created_at FROM sessions WHERE session_id IS NULL OR session_id = ''").all() as Array<{ token_hash: string; created_at: string }>;
  const migrateSession = db.prepare("UPDATE sessions SET session_id = ?, last_seen_at = COALESCE(last_seen_at, created_at) WHERE token_hash = ?");
  db.transaction(() => {
    for (const session of legacySessions) migrateSession.run(randomUUID(), session.token_hash);
    db.prepare("UPDATE sessions SET last_seen_at = created_at WHERE last_seen_at IS NULL").run();
    // A legacy session cannot be assigned to a browser endpoint without
    // guessing from its User-Agent. Revoke it once and require a clean login.
    if (requiresEndpointMigration) {
      db.prepare("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?)").run(new Date().toISOString());
    }
  })();
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS sessions_session_id ON sessions(session_id);
    CREATE INDEX IF NOT EXISTS sessions_user_last_seen ON sessions(user_id, last_seen_at DESC);
  `);
  const userColumns = new Set(
    (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!userColumns.has("trash_retention_days")) db.exec("ALTER TABLE users ADD COLUMN trash_retention_days INTEGER DEFAULT 30");
  if (!userColumns.has("history_enabled")) db.exec("ALTER TABLE users ADD COLUMN history_enabled INTEGER NOT NULL DEFAULT 1");
  if (!userColumns.has("history_interval_minutes")) db.exec("ALTER TABLE users ADD COLUMN history_interval_minutes INTEGER NOT NULL DEFAULT 10");
  if (!userColumns.has("history_retention_days")) db.exec("ALTER TABLE users ADD COLUMN history_retention_days INTEGER DEFAULT 90");
  if (!userColumns.has("history_cleared_before")) db.exec("ALTER TABLE users ADD COLUMN history_cleared_before TEXT");
  if (!userColumns.has("envelope_version")) db.exec("ALTER TABLE users ADD COLUMN envelope_version INTEGER NOT NULL DEFAULT 1");
  if (!userColumns.has("envelope_context")) db.exec("ALTER TABLE users ADD COLUMN envelope_context TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_history (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note_id TEXT NOT NULL,
      history_id TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      capture_kind TEXT NOT NULL CHECK (capture_kind IN ('baseline', 'interval', 'idle', 'manual', 'restore-safety')),
      ciphertext TEXT NOT NULL,
      nonce TEXT NOT NULL,
      encryption_version INTEGER NOT NULL,
      metadata_ciphertext TEXT,
      metadata_nonce TEXT,
      metadata_encryption_version INTEGER,
      is_protected INTEGER NOT NULL DEFAULT 0 CHECK (is_protected IN (0, 1)),
      byte_size INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, note_id, history_id),
      UNIQUE (user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS note_history_user_note_time ON note_history(user_id, note_id, captured_at DESC, history_id DESC);
    CREATE INDEX IF NOT EXISTS note_history_user_time ON note_history(user_id, captured_at DESC);
    CREATE TABLE IF NOT EXISTS note_history_clear_markers (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note_id TEXT NOT NULL,
      cleared_before TEXT NOT NULL,
      PRIMARY KEY (user_id, note_id)
    );
  `);
  const historyColumns = new Set(
    (db.prepare("PRAGMA table_info(note_history)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!historyColumns.has("metadata_ciphertext")) db.exec("ALTER TABLE note_history ADD COLUMN metadata_ciphertext TEXT");
  if (!historyColumns.has("metadata_nonce")) db.exec("ALTER TABLE note_history ADD COLUMN metadata_nonce TEXT");
  if (!historyColumns.has("metadata_encryption_version")) db.exec("ALTER TABLE note_history ADD COLUMN metadata_encryption_version INTEGER");
  if (!historyColumns.has("is_protected")) db.exec("ALTER TABLE note_history ADD COLUMN is_protected INTEGER NOT NULL DEFAULT 0 CHECK (is_protected IN (0, 1))");
  db.exec(`
    CREATE TABLE IF NOT EXISTS protected_history_attachments (
      user_id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      history_id TEXT NOT NULL,
      attachment_id TEXT NOT NULL,
      PRIMARY KEY (user_id, note_id, history_id, attachment_id),
      FOREIGN KEY (user_id, note_id, history_id)
        REFERENCES note_history(user_id, note_id, history_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS protected_history_attachment_lookup
      ON protected_history_attachments(user_id, attachment_id);
  `);
  return db;
}
