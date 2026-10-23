import Fastify from "fastify";
import { registerAttachmentLifecycle } from "./attachments/lifecycle";
import { historyChanged } from "./sync/lifecycle";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { operationId } from "@mint-notes/application-client";
import { openDatabase, type AppDatabase } from "./database";
import { writeObject, StorageQuotaError, type ObjectWrite } from "./sync/objectStore";
import { cleanupSyncMetadata, syncState } from "./sync/lifecycle";
import { storageUsage } from "./storageUsage";
import { purgeExpiredTrash, purgeTargets } from "./trash";
import { cleanupUserHistory, reclaimHistorySpace } from "./history";
import { migrationBackup, fileDigest } from "./backupStorage";
import { markBackup, backupRetention } from "./backupRetention";
import { issueSyncLease, validSyncLease } from "./sync/protocol";
import { createApp } from "./app";
import { loadServerConfig } from "./config";

const resources: Array<{ directory: string; db: AppDatabase }> = [];
afterEach(() => { for (const r of resources.splice(0)) { if (r.db.open) r.db.close(); rmSync(r.directory, { recursive: true, force: true }); } });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "mint-lifecycle-"));
  const db = openDatabase(directory); resources.push({ directory, db });
  db.prepare(`INSERT INTO users (id, username, display_name, role, auth_salt, auth_hash, kdf_salt, kdf_params,
    wrapped_vault_key, wrapped_vault_nonce, recovery_auth_salt, recovery_auth_hash, recovery_wrapped_vault_key, recovery_wrapped_vault_nonce, created_at)
    VALUES ('user', 'alpha', 'Alpha', 'admin', 'a', 'b', 'c', '{}', 'd', 'e', 'f', 'g', 'h', 'i', ?)`).run(new Date().toISOString());
  return { db, directory };
}
const scope = { userId: "user" };
function body(baseRevision = 0, extra: Partial<ObjectWrite> = {}): ObjectWrite {
  return { objectType: "note", ciphertext: "x".repeat(32), nonce: "n".repeat(24), encryptionVersion: 1, baseRevision, deleted: false, idempotencyKey: operationId(), ...extra };
}
function snapshot(db: AppDatabase, note: string, id: string, kind = "interval", protectedVersion = false, captured = "2026-01-01T00:00:00.000Z") {
  db.prepare(`INSERT INTO note_history(user_id,note_id,history_id,captured_at,capture_kind,ciphertext,nonce,encryption_version,is_protected,byte_size,idempotency_key,created_at,retention_at)
    VALUES ('user',?,?,?,?, 'encrypted', 'nonce',1,?,100,?,?,?)`).run(note, id, captured, kind, Number(protectedVersion), operationId(), captured, captured);
}

describe("storage lifecycle v3", () => {
  it("keeps one current ciphertext, coalesces notifications, and receipts contain no body", () => {
    const { db } = fixture();
    for (let n = 0; n < 400; n++) expect(writeObject(db, scope, "note", body(n), 56).status).toBe("accepted");
    expect(storageUsage(db, "user").contentBytes).toBe(56);
    expect(db.prepare("SELECT COUNT(*) AS count FROM object_revisions").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM changes").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM sync_receipts").get()).toEqual({ count: 400 });
    expect((db.prepare("PRAGMA table_info(sync_receipts)").all() as Array<{ name: string }>).map(r => r.name)).not.toContain("ciphertext");
    expect(syncState(db, "user").head).toBe(400);
  });
  it("allows non-growing edits and tombstones at quota, then purges protected history and owned chunks atomically", () => {
    const { db } = fixture();
    writeObject(db, scope, "note", body(), 56);
    writeObject(db, scope, "attachment", body(0, { objectType: "attachment", ownerNoteId: "note" }), 112);
    snapshot(db, "note", "protected", "manual", true);
    db.prepare("INSERT INTO attachment_chunks VALUES ('user','attachment',0,1,X'010203','nonce',1,?,'2026-01-01')").run(operationId());
    expect(() => writeObject(db, scope, "note", body(1, { ciphertext: "x".repeat(80) }), 112)).toThrow(StorageQuotaError);
    expect(writeObject(db, scope, "note", body(1), 1).status).toBe("accepted");
    expect(writeObject(db, scope, "note", body(2, { deleted: true }), 1).status).toBe("accepted");
    expect(purgeTargets(db, "user", [{ objectId: "note", baseRevision: 3 }])).toHaveLength(2);
    expect(storageUsage(db, "user").encryptedBytes).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM attachment_chunks").get()).toEqual({ count: 0 });
  });
  it("retains exact idempotency after response loss, and rejects payload mismatch", () => {
    const { db } = fixture(); const request = body();
    expect(writeObject(db, scope, "note", request, 1000).status).toBe("accepted");
    expect(writeObject(db, scope, "note", request, 1000)).toMatchObject({ status: "idempotent", revision: 1 });
    expect(writeObject(db, scope, "note", { ...request, ciphertext: "other" }, 1000)).toMatchObject({ status: "conflict", reason: "idempotency" });
  });
  it("expires purge markers/receipts but preserves a monotonic head and rejects old creates", () => {
    const { db } = fixture(); const old = body();
    writeObject(db, scope, "note", old, 1000);
    writeObject(db, scope, "note", body(1, { deleted: true }), 1000);
    purgeTargets(db, "user", [{ objectId: "note", baseRevision: 2 }]);
    const head = syncState(db, "user").head;
    cleanupSyncMetadata(db, Date.now() + 91 * 86_400_000);
    expect(syncState(db, "user")).toMatchObject({ head, floor: head });
    expect(db.prepare("SELECT COUNT(*) AS count FROM changes").get()).toEqual({ count: 0 });
    expect(() => writeObject(db, scope, "note", body(0, { idempotencyKey: operationId(Date.now() - 91 * 86_400_000) }), 1000)).toThrow("Operation expired");
    expect(db.prepare("SELECT COUNT(*) AS count FROM objects").get()).toEqual({ count: 0 });
  });
  it("holds all cascades until legacy ownership is verified", () => {
    const { db } = fixture(); writeObject(db, scope, "note", body(0, { deleted: true }), 1000);
    db.prepare("INSERT INTO ownership_state VALUES ('user',0,0)").run();
    snapshot(db, "note", "protected", "manual", true);
    expect(() => purgeTargets(db, "user", [{ objectId: "note", baseRevision: 1 }])).toThrow("OWNERSHIP_INCOMPLETE");
    expect(purgeExpiredTrash(db, "2030-01-01T00:00:00.000Z")).toBe(0);
    expect(storageUsage(db, "user").historyBytes).toBe(100);
  });
  it("never extends server trash time on repeated writes; restores all historical versions", () => {
    const { db } = fixture(); writeObject(db, scope, "note", body(0, { deleted: true }), 1000);
    db.prepare("UPDATE objects SET trashed_at = '2026-01-01T00:00:00.000Z' WHERE object_id = 'note'").run();
    snapshot(db, "note", "auto", "interval", false, "2025-12-31T00:00:00.000Z");
    snapshot(db, "note", "manual", "manual", true);
    writeObject(db, scope, "note", body(1, { deleted: true }), 1000);
    expect((db.prepare("SELECT trashed_at FROM objects").get() as any).trashed_at).toBe("2026-01-01T00:00:00.000Z");
    expect(cleanupUserHistory(db, "user", "2026-10-01T00:00:00.000Z")).toBe(0);
    writeObject(db, scope, "note", body(2), 1000);
    expect((db.prepare("SELECT COUNT(*) AS count FROM note_history").get() as any).count).toBe(2);
    expect((db.prepare("SELECT retention_at FROM note_history WHERE history_id = 'auto'").get() as any).retention_at > "2026-10-01").toBe(true);
  });
  it("quota reclamation preserves manual, protected and trashed histories, including failed admission", () => {
    const { db } = fixture(); writeObject(db, scope, "live", body(), 1000); writeObject(db, scope, "trash", body(0, { deleted: true }), 1000);
    snapshot(db, "live", "auto"); snapshot(db, "live", "manual", "manual"); snapshot(db, "live", "protected", "interval", true); snapshot(db, "trash", "trash");
    expect(reclaimHistorySpace(db, "user", 1000, 400)).toBe(false);
    expect(storageUsage(db, "user").historyBytes).toBe(400);
    expect(reclaimHistorySpace(db, "user", 100, 400)).toBe(true);
    expect((db.prepare("SELECT history_id FROM note_history ORDER BY history_id").all() as any[]).map(r => r.history_id)).toEqual(["manual", "protected", "trash"]);
  });
  it("requires the grace period and a second matching ownership/history/revision check before attachment reclamation", async () => {
    const { db } = fixture();
    const noteId = crypto.randomUUID(), attachmentId = crypto.randomUUID();
    writeObject(db, scope, noteId, body(), 1000);
    writeObject(db, scope, attachmentId, body(0, { objectType: "attachment", ownerNoteId: noteId }), 1000);
    const app = Fastify(); registerAttachmentLifecycle(app, { db, authenticate: async () => {}, scope: () => scope });
    const input = { noteId, noteRevision: 1, historyVersion: 0, ownershipVersion: 1, attachmentIds: [attachmentId], confirm: true };
    try {
      expect((await app.inject({ method: "POST", url: "/api/attachments/reclaim", payload: input })).json().purged).toEqual([]);
      expect(db.prepare("SELECT 1 FROM objects WHERE object_id = ?").get(attachmentId)).toBeDefined();
      db.prepare("UPDATE attachment_gc SET proposed_at = ?").run(new Date(Date.now() - 91 * 86_400_000).toISOString());
      historyChanged(db, "user", noteId);
      expect((await app.inject({ method: "POST", url: "/api/attachments/reclaim", payload: input })).statusCode).toBe(409);
      input.historyVersion = 1;
      expect((await app.inject({ method: "POST", url: "/api/attachments/reclaim", payload: input })).json().purged).toEqual([]);
      db.prepare("UPDATE attachment_gc SET proposed_at = ?").run(new Date(Date.now() - 91 * 86_400_000).toISOString());
      expect((await app.inject({ method: "POST", url: "/api/attachments/reclaim", payload: input })).json().purged).toEqual([attachmentId]);
      expect(db.prepare("SELECT 1 FROM objects WHERE object_id = ?").get(attachmentId)).toBeUndefined();
    } finally { await app.close(); }
  });
  it("migrates matching v2 objects without changing ciphertext, history protection or keys", () => {
    const { db, directory } = fixture(); writeObject(db, scope, "note", body(), 1000); snapshot(db, "note", "protected", "manual", true);
    db.prepare(`INSERT INTO object_revisions(user_id,object_id,object_type,ciphertext,nonce,encryption_version,revision,deleted,idempotency_key,created_at)
      SELECT user_id,object_id,object_type,ciphertext,nonce,encryption_version,revision,deleted,?,updated_at FROM objects`).run(crypto.randomUUID());
    const before = db.prepare("SELECT * FROM objects").all();
    db.exec("PRAGMA user_version = 2"); db.close();
    const migrated = openDatabase(directory); resources.find((r) => r.directory === directory)!.db = migrated;
    expect(migrated.pragma("user_version", { simple: true })).toBe(3);
    expect(migrated.prepare("SELECT * FROM objects").all()).toEqual(before);
    expect(migrated.prepare("SELECT COUNT(*) AS count FROM object_revisions").get()).toEqual({ count: 0 });
    expect(migrated.prepare("SELECT is_protected FROM note_history").get()).toEqual({ is_protected: 1 });
    expect(readdirSync(join(directory, "backups"))).toContain("pre-schema3.sqlite");
    migrated.close();
  });
  it("leases expire and are bound to user and restored epoch", () => {
    const { db } = fixture(); const lease = issueSyncLease(db, "user");
    expect(validSyncLease(db, "user", lease)).toBe(true);
    expect(validSyncLease(db, "other-user", lease)).toBe(false);
    db.prepare("UPDATE sync_state SET epoch = 'restored'").run();
    expect(validSyncLease(db, "user", lease)).toBe(false);
  });
  it("backs up before v2 migration and rolls back a mismatched current revision", () => {
    const { db, directory } = fixture(); writeObject(db, scope, "note", body(), 1000);
    db.exec("PRAGMA user_version = 2"); db.close();
    expect(() => openDatabase(directory)).toThrow("MIGRATION_CURRENT_REVISION_MISMATCH");
    const backup = readdirSync(join(directory, "backups")).find(r => r.endsWith(".sqlite"))!;
    expect(readFileSync(join(directory, "backups", backup + ".sha256"), "utf8").trim()).toBe(fileDigest(join(directory, "backups", backup)));
  });
  it("rotates only recognized validated backups; legacy files require explicit adoption", () => {
    const { db, directory } = fixture();
    for (let i = 0; i < 30; i++) {
      const time = new Date(Date.UTC(2024, i, 1)).toISOString();
      const path = join(directory, `mint-notes-${time.replace(/[:.]/g, "-")}.sqlite`);
      migrationBackup(db, path); markBackup(path, time, fileDigest(path));
    }
    const legacy = join(directory, "mint-notes-2020-01-01T00-00-00-000Z.sqlite"); migrationBackup(db, legacy);
    const preview = backupRetention(directory);
    expect(preview.remove.length).toBeGreaterThan(0); expect(preview.unmanaged).toContain(legacy);
    backupRetention(directory, { apply: true });
    expect(readdirSync(directory)).toContain(legacy.split(/[\\/]/).at(-1));
    expect(backupRetention(directory).remove).toEqual([]);
  });
  it("returns upgrade-required, rather than 401, for an old sync client", async () => {
    const { db, directory } = fixture();
    const app = await createApp({ db, config: { ...loadServerConfig({ NODE_ENV: "development", LOG_LEVEL: "silent" }), dataDirectory: directory }, maintenance: false });
    try {
      expect((await app.inject({ method: "GET", url: "/api/sync" })).statusCode).toBe(426);
      expect((await app.inject({ method: "GET", url: "/api/apps/v1/connection" })).json()).toMatchObject({ code: "PROTOCOL_UPGRADE_REQUIRED" });
    } finally { await app.close(); }
  });
});
