import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openDatabase, runRegistrationTransaction, type RegistrationRole } from "./database";
import { cleanupUserHistory } from "./history";
import { purgeExpiredTrash } from "./trash";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function insertUser(db: ReturnType<typeof openDatabase>, id: string, username: string, role: RegistrationRole = "user") {
  db.prepare(`
    INSERT INTO users (
      id, username, display_name, role, auth_salt, auth_hash, kdf_salt, kdf_params,
      wrapped_vault_key, wrapped_vault_nonce, recovery_auth_salt, recovery_auth_hash,
      recovery_wrapped_vault_key, recovery_wrapped_vault_nonce, created_at
    ) VALUES (?, ?, ?, ?, 'a', 'b', 'c', '{}', 'd', 'e', 'f', 'g', 'h', 'i', ?)
  `).run(id, username, username, role, new Date().toISOString());
}

describe("database isolation", () => {
  it("assigns the bootstrap administrator role exactly once", () => {
    const directory = mkdtempSync(join(tmpdir(), "webmd-bootstrap-role-test-"));
    temporaryDirectories.push(directory);
    const db = openDatabase(directory);
    const register = (id: string, username: string, allowRegistration: boolean) => runRegistrationTransaction(
      db,
      allowRegistration,
      (role) => insertUser(db, id, username, role)
    );

    expect(register("user-a", "alpha", true).role).toBe("admin");
    expect(register("user-b", "bravo", true).role).toBe("user");
    expect(() => register("user-c", "charlie", false)).toThrow("REGISTRATION_CLOSED");
    expect(db.prepare("SELECT username, role FROM users ORDER BY username").all()).toEqual([
      { username: "alpha", role: "admin" },
      { username: "bravo", role: "user" }
    ]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT envelope_version, envelope_context FROM users WHERE id = ?").get("user-a")).toEqual({
      envelope_version: 1,
      envelope_context: null
    });
    db.close();
  });

  it("defaults trash retention to 30 days and preserves accounts configured for permanent retention", () => {
    const directory = mkdtempSync(join(tmpdir(), "webmd-trash-retention-test-"));
    temporaryDirectories.push(directory);
    const db = openDatabase(directory);
    insertUser(db, "user-a", "alpha");
    insertUser(db, "user-b", "bravo");
    db.prepare("UPDATE users SET trash_retention_days = NULL WHERE id = ?").run("user-b");
    const old = "2026-01-01T00:00:00.000Z";
    const insert = db.prepare(`
      INSERT INTO objects (user_id, object_id, object_type, ciphertext, nonce, encryption_version, revision, deleted, updated_at)
      VALUES (?, ?, 'note', 'ciphertext', 'nonce', 1, 1, 1, ?)
    `);
    insert.run("user-a", "expired", old);
    insert.run("user-b", "permanent", old);

    expect(purgeExpiredTrash(db, "2026-02-01T00:00:00.000Z")).toBe(1);
    expect(db.prepare("SELECT object_id FROM objects ORDER BY object_id").all()).toEqual([{ object_id: "permanent" }]);
    const defaults = db.prepare("SELECT trash_retention_days FROM users WHERE id = ?").get("user-a") as { trash_retention_days: number };
    expect(defaults.trash_retention_days).toBe(30);
    db.close();
  });

  it("defaults note history settings and thins only automatic snapshots", () => {
    const directory = mkdtempSync(join(tmpdir(), "webmd-note-history-test-"));
    temporaryDirectories.push(directory);
    const db = openDatabase(directory);
    insertUser(db, "user-a", "alpha");
    const defaults = db.prepare(`
      SELECT history_enabled, history_interval_minutes, history_retention_days
      FROM users WHERE id = ?
    `).get("user-a");
    expect(defaults).toEqual({ history_enabled: 1, history_interval_minutes: 10, history_retention_days: 90 });
    const insert = db.prepare(`
      INSERT INTO note_history (
        user_id, note_id, history_id, captured_at, capture_kind, ciphertext, nonce,
        encryption_version, byte_size, idempotency_key, created_at
      ) VALUES ('user-a', 'note-a', ?, ?, ?, 'ciphertext', 'nonce', 1, 10, ?, ?)
    `);
    const add = (id: string, capturedAt: string, kind: string) => insert.run(id, capturedAt, kind, `idem-${id}`, capturedAt);
    add("recent-a", "2026-07-24T01:10:00.000Z", "interval");
    add("recent-b", "2026-07-24T01:20:00.000Z", "idle");
    add("hour-old", "2026-07-22T10:10:00.000Z", "interval");
    add("hour-new", "2026-07-22T10:50:00.000Z", "idle");
    add("day-old", "2026-07-10T08:00:00.000Z", "interval");
    add("day-new", "2026-07-10T20:00:00.000Z", "idle");
    add("manual-a", "2026-07-10T09:00:00.000Z", "manual");
    add("manual-b", "2026-07-10T10:00:00.000Z", "restore-safety");
    add("expired", "2026-03-01T00:00:00.000Z", "manual");

    expect(cleanupUserHistory(db, "user-a", "2026-07-24T12:00:00.000Z")).toBe(3);
    expect((db.prepare("SELECT history_id FROM note_history ORDER BY history_id").all() as Array<{ history_id: string }>).map((row) => row.history_id)).toEqual([
      "day-new",
      "hour-new",
      "manual-a",
      "manual-b",
      "recent-a",
      "recent-b"
    ]);
    db.close();
  });

  it("adds trusted-endpoint metadata and revokes ambiguous legacy sessions", () => {
    const directory = mkdtempSync(join(tmpdir(), "webmd-session-migration-test-"));
    temporaryDirectories.push(directory);
    const initial = openDatabase(directory);
    insertUser(initial, "user-a", "alpha");
    initial.exec(`
      DROP TABLE sessions;
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
    initial.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
      "legacy-token-hash", "user-a", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"
    );
    initial.prepare(`
      INSERT INTO objects (user_id, object_id, object_type, ciphertext, nonce, encryption_version, revision, deleted, updated_at)
      VALUES ('user-a', 'preserved-note', 'note', 'opaque-before-upgrade', 'nonce', 1, 7, 0, '2026-01-02T00:00:00.000Z')
    `).run();
    initial.close();

    const upgraded = openDatabase(directory);
    const row = upgraded.prepare(`
      SELECT session_id, device_name, last_seen_at, revoked_at FROM sessions WHERE token_hash = ?
    `).get("legacy-token-hash") as { session_id: string; device_name: string; last_seen_at: string; revoked_at: string | null };
    expect(row.session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.device_name).toBe("Unknown device");
    expect(row.last_seen_at).toBe("2026-01-01T00:00:00.000Z");
    expect(row.revoked_at).not.toBeNull();
    const endpointColumn = upgraded.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    expect(endpointColumn.some((column) => column.name === "endpoint_id")).toBe(true);
    expect(upgraded.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'trusted_endpoints'").get()).toBeTruthy();
    expect(upgraded.prepare("SELECT ciphertext, revision FROM objects WHERE user_id = ? AND object_id = ?").get("user-a", "preserved-note")).toEqual({
      ciphertext: "opaque-before-upgrade",
      revision: 7
    });
    upgraded.close();
  });

  it("scopes identical IDs to separate users and includes attachment chunks in online backups", async () => {
    const directory = mkdtempSync(join(tmpdir(), "webmd-db-test-"));
    temporaryDirectories.push(directory);
    const db = openDatabase(directory);
    insertUser(db, "user-a", "alpha");
    insertUser(db, "user-b", "bravo");
    const insert = db.prepare(`
      INSERT INTO objects (user_id, object_id, object_type, ciphertext, nonce, encryption_version, revision, deleted, updated_at)
      VALUES (?, 'same-object-id', 'note', ?, 'nonce', 1, 1, 0, ?)
    `);
    insert.run("user-a", "cipher-a", new Date().toISOString());
    insert.run("user-b", "cipher-b", new Date().toISOString());

    const rows = db.prepare("SELECT user_id, ciphertext FROM objects WHERE object_id = ? ORDER BY user_id").all("same-object-id") as Array<{ user_id: string; ciphertext: string }>;
    expect(rows).toEqual([
      { user_id: "user-a", ciphertext: "cipher-a" },
      { user_id: "user-b", ciphertext: "cipher-b" }
    ]);
    const insertChunk = db.prepare(`
      INSERT INTO attachment_chunks (user_id, attachment_id, chunk_index, total_chunks, ciphertext, nonce, encryption_version, idempotency_key, created_at)
      VALUES (?, 'same-attachment-id', 0, 1, ?, 'nonce', 1, ?, ?)
    `);
    insertChunk.run("user-a", Buffer.from("chunk-a"), "idem-a", new Date().toISOString());
    insertChunk.run("user-b", Buffer.from("chunk-b"), "idem-b", new Date().toISOString());
    const chunks = db.prepare("SELECT user_id, CAST(ciphertext AS TEXT) AS ciphertext FROM attachment_chunks WHERE attachment_id = ? ORDER BY user_id").all("same-attachment-id");
    expect(chunks).toEqual([
      { user_id: "user-a", ciphertext: "chunk-a" },
      { user_id: "user-b", ciphertext: "chunk-b" }
    ]);
    const backupPath = join(directory, "verified-backup.sqlite");
    await db.backup(backupPath);
    const backup = new Database(backupPath, { readonly: true });
    const backedUpChunk = backup.prepare("SELECT CAST(ciphertext AS TEXT) AS ciphertext FROM attachment_chunks WHERE user_id = ? AND attachment_id = ?").get("user-a", "same-attachment-id") as { ciphertext: string };
    expect(backedUpChunk.ciphertext).toBe("chunk-a");
    backup.close();
    db.close();
  });

  it("cascades profile assets and encrypted content only for the deleted user", () => {
    const directory = mkdtempSync(join(tmpdir(), "webmd-user-delete-test-"));
    temporaryDirectories.push(directory);
    const db = openDatabase(directory);
    insertUser(db, "user-a", "alpha");
    insertUser(db, "user-b", "bravo");
    const now = new Date().toISOString();
    for (const userId of ["user-a", "user-b"]) {
      db.prepare("INSERT INTO profile_assets (user_id, ciphertext, nonce, encryption_version, updated_at) VALUES (?, ?, 'nonce', 1, ?)").run(userId, `avatar-${userId}`, now);
      db.prepare("INSERT INTO objects (user_id, object_id, object_type, ciphertext, nonce, encryption_version, revision, deleted, updated_at) VALUES (?, 'shared-id', 'note', ?, 'nonce', 1, 1, 0, ?)").run(userId, `note-${userId}`, now);
    }
    db.prepare("DELETE FROM users WHERE id = ?").run("user-a");
    expect(db.prepare("SELECT user_id, ciphertext FROM profile_assets").all()).toEqual([{ user_id: "user-b", ciphertext: "avatar-user-b" }]);
    expect(db.prepare("SELECT user_id, ciphertext FROM objects").all()).toEqual([{ user_id: "user-b", ciphertext: "note-user-b" }]);
    db.close();
  });
});
