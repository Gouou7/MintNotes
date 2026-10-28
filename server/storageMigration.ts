import type { AppDatabase } from "./database.js";

export function migrateStorage(db: AppDatabase, previousVersion: number, _directory: string) {
  db.transaction(() => {
    if (previousVersion === 2) {
      const mismatch = db.prepare(`SELECT 1 FROM objects o LEFT JOIN object_revisions r
        ON r.user_id = o.user_id AND r.object_id = o.object_id AND r.revision = o.revision
        WHERE r.object_id IS NULL OR o.revision != (SELECT MAX(latest.revision) FROM object_revisions latest WHERE latest.user_id = o.user_id AND latest.object_id = o.object_id) OR r.ciphertext != o.ciphertext OR r.nonce != o.nonce
          OR r.object_type != o.object_type OR r.encryption_version != o.encryption_version OR r.deleted != o.deleted LIMIT 1`).get();
      if (mismatch) throw new Error("MIGRATION_CURRENT_REVISION_MISMATCH");
    }
    const columns = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name));
    if (!columns("objects").has("trashed_at")) {
      db.exec(`ALTER TABLE objects ADD COLUMN trashed_at TEXT;
        ALTER TABLE objects ADD COLUMN trash_grace_until TEXT;
        ALTER TABLE objects ADD COLUMN owner_note_id TEXT;`);
      if (previousVersion === 2) db.prepare(`UPDATE objects SET trashed_at = updated_at, trash_grace_until = ? WHERE deleted = 1`)
        .run(new Date(Date.now() + 30 * 86_400_000).toISOString());
    }
    if (!columns("changes").has("category")) db.exec("ALTER TABLE changes ADD COLUMN category TEXT NOT NULL DEFAULT 'object'");
    if (!columns("note_history").has("retention_at")) {
      db.exec("ALTER TABLE note_history ADD COLUMN retention_at TEXT");
      db.exec("UPDATE note_history SET retention_at = captured_at");
    }
    db.exec(`CREATE TABLE IF NOT EXISTS sync_state (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        epoch TEXT NOT NULL, lease_secret TEXT NOT NULL DEFAULT '', head INTEGER NOT NULL DEFAULT 0, floor INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sync_receipts (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL, object_id TEXT NOT NULL, digest TEXT NOT NULL, revision INTEGER NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY(user_id, operation_id));
      CREATE INDEX IF NOT EXISTS sync_receipts_age ON sync_receipts(created_at);
      CREATE INDEX IF NOT EXISTS objects_owner ON objects(user_id, owner_note_id);
      CREATE TABLE IF NOT EXISTS history_versions (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, note_id));
      CREATE TABLE IF NOT EXISTS ownership_state (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        complete INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS note_trash_periods (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note_id TEXT NOT NULL, entered_at TEXT NOT NULL, restored_at TEXT);
      CREATE INDEX IF NOT EXISTS note_trash_periods_note ON note_trash_periods(user_id, note_id);
      CREATE TABLE IF NOT EXISTS ownership_versions (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, note_id));
      CREATE TABLE IF NOT EXISTS attachment_owners (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        attachment_id TEXT NOT NULL, note_id TEXT NOT NULL, PRIMARY KEY(user_id, attachment_id));
      CREATE TABLE IF NOT EXISTS attachment_gc (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        attachment_id TEXT NOT NULL, note_id TEXT NOT NULL, note_revision INTEGER NOT NULL,
        history_version INTEGER NOT NULL, ownership_version INTEGER NOT NULL, proposed_at TEXT NOT NULL,
        PRIMARY KEY(user_id, attachment_id));`);
    db.exec("UPDATE sync_state SET lease_secret = lower(hex(randomblob(32))) WHERE lease_secret = ''");
    if (previousVersion === 0 || previousVersion === 2) {
      db.exec(`INSERT OR IGNORE INTO sync_state (user_id, epoch, head)
        SELECT u.id, lower(hex(randomblob(16))), COALESCE(MAX(c.sequence), 0) FROM users u LEFT JOIN changes c ON c.user_id = u.id GROUP BY u.id;
        INSERT OR IGNORE INTO ownership_state (user_id, complete) SELECT id, ${previousVersion === 2 ? 0 : 1} FROM users;
        DELETE FROM changes WHERE sequence NOT IN (SELECT MAX(sequence) FROM changes GROUP BY user_id, object_id, category);
        INSERT INTO note_trash_periods(user_id, note_id, entered_at) SELECT user_id, object_id, COALESCE(trashed_at, updated_at)
          FROM objects WHERE deleted = 1 AND object_type = 'note';`);
    }
    db.exec("UPDATE sync_state SET lease_secret = lower(hex(randomblob(32))) WHERE lease_secret = ''");
    // Keep encrypted capture_kind/AAD values intact; extend only the accepted vocabulary.
    const definition = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'note_history'").get() as { sql: string }).sql;
    if (!definition.includes("application-edit")) {
      const refs = db.prepare("SELECT * FROM protected_history_attachments").all() as Array<{ user_id: string; note_id: string; history_id: string; attachment_id: string }>;
      db.exec("DROP TABLE protected_history_attachments");
      db.exec(definition.replace("CREATE TABLE note_history", "CREATE TABLE note_history_next").replace("CREATE TABLE IF NOT EXISTS note_history", "CREATE TABLE note_history_next").replace("'restore-safety'", "'restore-safety', 'application-edit'"));
      db.exec("INSERT INTO note_history_next SELECT * FROM note_history; DROP TABLE note_history; ALTER TABLE note_history_next RENAME TO note_history");
      db.exec(`CREATE TABLE protected_history_attachments (user_id TEXT NOT NULL, note_id TEXT NOT NULL, history_id TEXT NOT NULL, attachment_id TEXT NOT NULL,
        PRIMARY KEY(user_id, note_id, history_id, attachment_id), FOREIGN KEY(user_id, note_id, history_id) REFERENCES note_history(user_id, note_id, history_id) ON DELETE CASCADE);
        CREATE INDEX protected_history_attachment_lookup ON protected_history_attachments(user_id, attachment_id);
        CREATE INDEX note_history_user_note_time ON note_history(user_id, note_id, captured_at DESC, history_id DESC);
        CREATE INDEX note_history_user_time ON note_history(user_id, captured_at DESC);`);
      for (const r of refs) db.prepare("INSERT INTO protected_history_attachments VALUES (?, ?, ?, ?)").run(r.user_id, r.note_id, r.history_id, r.attachment_id);
    }
    for (const table of ["users", "account_setups"]) {
      if (!columns(table).has("storage_quota_mode")) db.exec(`ALTER TABLE ${table} ADD COLUMN storage_quota_mode TEXT NOT NULL DEFAULT 'inherit' CHECK(storage_quota_mode IN ('inherit','limited','unlimited'));
        ALTER TABLE ${table} ADD COLUMN storage_quota_bytes INTEGER CHECK(storage_quota_bytes IS NULL OR storage_quota_bytes > 0);`);
    }
    if (!columns("users").has("history_quota_mode")) db.exec(`ALTER TABLE users ADD COLUMN history_quota_mode TEXT NOT NULL DEFAULT 'inherit' CHECK(history_quota_mode IN ('inherit','limited','unlimited'));
      ALTER TABLE users ADD COLUMN history_quota_bytes INTEGER CHECK(history_quota_bytes IS NULL OR history_quota_bytes > 0);`);
    if (previousVersion > 0 && previousVersion < 4) db.exec(`UPDATE note_history SET byte_size = LENGTH(CAST(ciphertext AS BLOB)) + LENGTH(CAST(nonce AS BLOB))
      + COALESCE(LENGTH(CAST(metadata_ciphertext AS BLOB)), 0) + COALESCE(LENGTH(CAST(metadata_nonce AS BLOB)), 0)`);
    if (!columns("objects").has("body_block_ids")) db.exec("ALTER TABLE objects ADD COLUMN body_block_ids TEXT NOT NULL DEFAULT '[]'");
    db.exec(`CREATE TABLE IF NOT EXISTS note_body_blocks (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note_id TEXT NOT NULL, block_id TEXT NOT NULL, ciphertext TEXT NOT NULL, nonce TEXT NOT NULL,
      PRIMARY KEY(user_id, note_id, block_id));
      CREATE TABLE IF NOT EXISTS note_body_refs (
      user_id TEXT NOT NULL, note_id TEXT NOT NULL, block_id TEXT NOT NULL,
      PRIMARY KEY(user_id, note_id, block_id),
      FOREIGN KEY(user_id, note_id, block_id) REFERENCES note_body_blocks(user_id, note_id, block_id) ON DELETE CASCADE);
      PRAGMA user_version = 5;`);
  })();
}
