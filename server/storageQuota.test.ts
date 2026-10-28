import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { operationId } from "@mint-notes/application-client";
import { openDatabase, type AppDatabase } from "./database";
import { createApp } from "./testSupport";
import { loadServerConfig } from "./config";
import { admitHistoryGrowth, quotaSetting, assertStorageGrowth, userQuotas } from "./storageQuota";
import { storageUsage } from "./storageUsage";
import { writeObject } from "./sync/objectStore";

const resources: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of resources.splice(0).reverse()) await cleanup(); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "mint-quota-v4-"));
  const db = openDatabase(directory);
  resources.push(() => { if (db.open) db.close(); rmSync(directory, { recursive: true, force: true }); });
  const config = { ...loadServerConfig({ LOG_LEVEL: "silent", ALLOW_REGISTRATION: "true" }), dataDirectory: directory };
  return { db, directory, config };
}
function registration(username: string) {
  return { username, displayName: username, authSecret: `${username}-client-secret-00000000001`, kdfSalt: "s".repeat(24),
    kdfParams: { algorithm: "argon2id", opsLimit: 3, memLimit: 67108864, version: 1 }, wrappedVaultKey: "v".repeat(32), wrappedVaultNonce: "n".repeat(24),
    recoveryAuthSecret: `${username}-recovery-secret-0000001`, recoveryWrappedVaultKey: "r".repeat(32), recoveryWrappedVaultNonce: "n".repeat(24) };
}
function addUser(db: AppDatabase) {
  const id = randomUUID();
  db.prepare(`INSERT INTO users(id,username,display_name,role,auth_salt,auth_hash,kdf_salt,kdf_params,wrapped_vault_key,wrapped_vault_nonce,recovery_auth_salt,recovery_auth_hash,recovery_wrapped_vault_key,recovery_wrapped_vault_nonce,created_at)
    VALUES (?,?,'User','user','a','b','c','{}','d','e','f','g','h','i',?)`).run(id, id, new Date().toISOString()); return id;
}
function put(db: AppDatabase, id: string, noteId = randomUUID(), bytes = 32, baseRevision = 0, deleted = false) {
  return writeObject(db, { userId: id }, noteId, { objectType: "note", ciphertext: "a".repeat(bytes), nonce: "n".repeat(24), encryptionVersion: 1,
    idempotencyKey: operationId(), baseRevision, deleted }, 2 ** 30);
}
function history(db: AppDatabase, user: string, note: string, size = 100) {
  const id = randomUUID();
  db.prepare(`INSERT INTO note_history(user_id,note_id,history_id,captured_at,capture_kind,ciphertext,nonce,encryption_version,is_protected,byte_size,idempotency_key,created_at,retention_at)
    VALUES (?,?,?,?,'interval','encrypted','nonce',1,0,?,?,?,?)`).run(user, note, id, new Date().toISOString(), size, operationId(), new Date().toISOString(), new Date().toISOString()); return id;
}
describe("unified user storage quota", () => {
  it("counts history, trash and avatar exactly once and preserves histories when normal writes are full", () => {
    const { db } = fixture(); const user = addUser(db), note = randomUUID(); put(db, user, note); history(db, user, note);
    db.prepare("INSERT INTO profile_assets VALUES (?, 'avatar', 'nonce', 1, ?)").run(user, new Date().toISOString());
    expect(storageUsage(db, user)).toMatchObject({ noteBytes: 56, contentBytes: 56, historyBytes: 100, profileBytes: 11, totalBytes: 167, trashBytes: 0 });
    db.prepare("UPDATE users SET storage_quota_mode = 'limited', storage_quota_bytes = 167 WHERE id = ?").run(user);
    expect(() => put(db, user)).toThrow("User storage quota exceeded");
    expect(storageUsage(db, user).historyBytes).toBe(100);
    expect(() => put(db, user, note, 32, 1)).not.toThrow();
    put(db, user, note, 32, 2, true);
    expect(storageUsage(db, user)).toMatchObject({ totalBytes: 167, trashBytes: 156 });
    expect(() => assertStorageGrowth(db, user, 1, 99999)).toThrow();
  });
  it("rolls back history rotation when the total quota still rejects admission", () => {
    const { db, config } = fixture(); const user = addUser(db), note = randomUUID(); put(db, user, note); history(db, user, note);
    db.prepare("UPDATE users SET storage_quota_mode='limited',storage_quota_bytes=100,history_quota_mode='limited',history_quota_bytes=100 WHERE id=?").run(user);
    expect(() => db.transaction(() => admitHistoryGrowth(db, user, 90, config)).immediate()).toThrow("User storage quota exceeded");
    expect(storageUsage(db, user).historyBytes).toBe(100);
    db.prepare("UPDATE users SET storage_quota_mode='unlimited',history_quota_mode='unlimited' WHERE id=?").run(user);
    expect(userQuotas(db, user, config)).toMatchObject({ quotaBytes: null, historyQuotaBytes: null });
    expect(() => db.transaction(() => admitHistoryGrowth(db, user, 10000, config)).immediate()).not.toThrow();
  });
  it("validates capacities and explicit unlimited mode", () => {
    for (const bytes of [0, -1, 1, 1.5 * 1048576, Number.MAX_SAFE_INTEGER + 1]) expect(quotaSetting.safeParse({ mode: "limited", bytes }).success).toBe(false);
    expect(quotaSetting.parse({ mode: "unlimited", bytes: null })).toMatchObject({ mode: "unlimited" });
    expect(quotaSetting.parse({ mode: "limited", bytes: 1048576 })).toMatchObject({ bytes: 1048576 });
  });
  it("serializes competing writers using the same combined limit", () => {
    const { db, directory } = fixture(); const user = addUser(db);
    db.prepare("UPDATE users SET storage_quota_mode='limited', storage_quota_bytes=56 WHERE id=?").run(user);
    const other = openDatabase(directory);
    try { put(db, user); expect(() => put(other, user)).toThrow("User storage quota exceeded"); expect(storageUsage(other, user).totalBytes).toBe(56); }
    finally { other.close(); }
  });
  it("backs up and upgrades schema v3 without altering stored payloads or repeating trash periods", () => {
    const { db, directory } = fixture(); const user = addUser(db), note = randomUUID(); put(db, user, note, 32, 0, true);
    db.pragma("user_version=3"); db.close();
    const upgraded = openDatabase(directory);
    try {
      expect(upgraded.pragma("user_version", { simple: true })).toBe(5);
      expect(existsSync(join(directory, "backups", "pre-schema5.sqlite.sha256"))).toBe(true);
      expect(storageUsage(upgraded, user).totalBytes).toBe(56);
      expect(upgraded.prepare("SELECT COUNT(*) AS count FROM note_trash_periods").get()).toEqual({ count: 1 });
      expect(userQuotas(upgraded, user, loadServerConfig({})).quotaMode).toBe("inherit");
    } finally { upgraded.close(); }
  });
  it("enforces administrator-only quota changes, user history budgets and setup inheritance", async () => {
    const { db, config } = fixture(); const app = await createApp({ db, config, maintenance: false }); resources.push(() => app.close());
    const register = async (name: string) => {
      const response = await app.inject({ method: "POST", url: "/api/auth/register", payload: registration(name) }); expect(response.statusCode).toBe(201);
      return { user: response.json().user, cookie: (response.headers["set-cookie"] as string[]).map((value) => value.split(";", 1)[0]).join("; ") };
    };
    const admin = await register("administrator"), user = await register("member");
    const patch = (cookie: string, body: unknown) => app.inject({ method: "PATCH", url: `/api/admin/users/${user.user.id}/storage-quota`, headers: { cookie }, payload: body as object });
    expect((await patch(user.cookie, { mode: "unlimited" })).statusCode).toBe(403);
    expect((await patch(admin.cookie, { mode: "limited", bytes: 0 })).statusCode).toBe(400);
    expect((await patch(admin.cookie, { mode: "limited", bytes: 1048576 })).json().quotaBytes).toBe(1048576);
    expect((await patch(admin.cookie, { mode: "unlimited", bytes: null })).json().quotaBytes).toBeNull();
    const own = await app.inject({ method: "PATCH", url: `/api/admin/users/${admin.user.id}/storage-quota`, headers: { cookie: admin.cookie }, payload: { mode: "unlimited" } }); expect(own.statusCode).toBe(200);
    const budget = await app.inject({ method: "PATCH", url: "/api/account/note-history-settings", headers: { cookie: user.cookie }, payload: { quotaBytes: null } }); expect(budget.json().quotaBytes).toBeNull();
    expect((await app.inject({ method: "GET", url: "/api/admin/storage", headers: { cookie: user.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/admin/storage", headers: { cookie: admin.cookie } })).json()).toMatchObject({ schemaVersion: 5, available: true, userCount: 2, journalMode: "wal" });
    const setup = await app.inject({ method: "POST", url: "/api/admin/account-setups", headers: { cookie: admin.cookie }, payload: { username: "invited", displayName: "Invited", storageQuota: { mode: "limited", bytes: 1048576 } } }); expect(setup.statusCode).toBe(201);
    const activation = await app.inject({ method: "POST", url: "/api/auth/activate", payload: { ...registration("invited"), activationCode: setup.json().activationCode } }); expect(activation.statusCode).toBe(201);
    expect(userQuotas(db, activation.json().user.id, config).quotaBytes).toBe(1048576);
  });
  it("applies the combined quota to avatars, history and attachment chunks while preserving existing data", async () => {
    const { db, config } = fixture(); const app = await createApp({ db, config, maintenance: false }); resources.push(() => app.close());
    const registrationResponse = await app.inject({ method: "POST", url: "/api/auth/register", payload: registration("storageuser") });
    const user = registrationResponse.json().user.id, note = randomUUID(); put(db, user, note);
    db.prepare("UPDATE users SET storage_quota_mode='limited',storage_quota_bytes=56 WHERE id=?").run(user);
    const cookie = (registrationResponse.headers["set-cookie"] as string[]).map((value) => value.split(";", 1)[0]).join("; ");
    const avatar = await app.inject({ method: "PUT", url: "/api/account/avatar", headers: { cookie }, payload: { ciphertext: "v".repeat(32), nonce: "n".repeat(24), encryptionVersion: 1 } }); expect(avatar.statusCode).toBe(413);
    const snapshot = await app.inject({ method: "POST", url: `/api/notes/${note}/history/${randomUUID()}`, headers: { cookie }, payload: { capturedAt: new Date().toISOString(), captureKind: "manual", ciphertext: "v".repeat(32), nonce: "n".repeat(24), encryptionVersion: 1, idempotencyKey: operationId() } }); expect(snapshot.statusCode).toBe(413);
    const chunk = await app.inject({ method: "PUT", url: `/api/attachments/${randomUUID()}/chunks/0`, headers: { cookie, "content-type": "application/octet-stream", "x-webmd-nonce": "n".repeat(24), "x-webmd-total-chunks": "1", "x-webmd-encryption-version": "1", "x-webmd-idempotency-key": operationId(), "x-webmd-owner-note": note }, payload: Buffer.from("bytes") }); expect(chunk.statusCode).toBe(413);
    expect(storageUsage(db, user)).toMatchObject({ totalBytes: 56, historyBytes: 0, profileBytes: 0, attachmentBytes: 0 });
  });
});
