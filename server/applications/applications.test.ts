// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { loadServerConfig } from "../config";
import { openDatabase } from "../database";
import { revokeUserCredentials } from "../auth/credentialRevocation";
import { createApplicationCredential, VaultCipher, randomBytes, encryptAttachmentBytes } from "@mint-notes/application-client/crypto";
import { ApplicationClient } from "@mint-notes/application-client/node";
import type { ApplicationConnectionBootstrap } from "@mint-notes/application-client";
import { makeDocument } from "@mint-notes/application-client/documents";

function registration(username: string) {
  return { username, displayName: username, authSecret: `${username}-derived-secret-00000000001`, kdfSalt: "s".repeat(24),
    kdfParams: { algorithm: "argon2id", opsLimit: 3, memLimit: 67_108_864, version: 1 }, wrappedVaultKey: "v".repeat(32), wrappedVaultNonce: "n".repeat(24),
    recoveryAuthSecret: `${username}-recovery-secret-00000001`, recoveryWrappedVaultKey: "w".repeat(32), recoveryWrappedVaultNonce: "q".repeat(24) };
}
const origin = "http://localhost";
let directory: string;
let db: ReturnType<typeof openDatabase>;
let app: Awaited<ReturnType<typeof createApp>>;
let cookie: string;
let userId: string;
let credential: Awaited<ReturnType<typeof createApplicationCredential>>;
let bootstrap: ApplicationConnectionBootstrap;
let cipher: VaultCipher;
let client: ApplicationClient;
let offline = false;
let beforeFetch: ((path: string, init: RequestInit) => Promise<void>) | null = null;
let bearer: string;
const browser = () => ({ origin, cookie });

async function registerGrant(access: "read" | "read-write" = "read-write") {
  const value = await createApplicationCredential(userId, randomBytes(32));
  const payload = { ...value, name: "OpenClaw", access, idleTimeoutDays: 30, expiresAt: null };
  const { applicationKey: _key, ...body } = payload;
  const response = await app.inject({ method: "POST", url: "/api/account/application-connections", headers: browser(), payload: body });
  expect(response.statusCode).toBe(201);
  return { value, body };
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "mint-app-test-"));
  db = openDatabase(directory);
  app = await createApp({ config: { ...loadServerConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", APP_ORIGIN: "http://localhost", ALLOW_REGISTRATION: "true" }), dataDirectory: directory }, db, maintenance: false });
  const response = await app.inject({ method: "POST", url: "/api/auth/register", headers: { origin }, payload: registration("alpha") });
  expect(response.statusCode).toBe(201);
  cookie = (response.headers["set-cookie"] as string[]).map((value) => value.split(";", 1)[0]).join("; ");
  userId = response.json().user.id;
  credential = (await registerGrant()).value;
  bearer = `Bearer ${credential.connectionId}.${credential.authSecret}`;
  const connection = await app.inject({ method: "GET", url: "/api/apps/v1/connection", headers: { authorization: bearer } });
  expect(connection.statusCode).toBe(200);
  bootstrap = connection.json();
  cipher = await VaultCipher.unlock(credential.applicationKey, bootstrap);
  offline = false; beforeFetch = null;
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    if (offline) throw new TypeError("offline");
    const url = new URL(String(input));
    await beforeFetch?.(url.pathname, init);
    if (init.signal?.aborted) throw new DOMException("cancelled", "AbortError");
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const response = await app.inject({ method: init.method as "GET" ?? "GET", url: url.pathname + url.search, headers,
      ...(init.body ? { payload: typeof init.body === "string" ? init.body : Buffer.from(init.body as ArrayBuffer) } : {}) });
    return new Response(response.rawPayload, { status: response.statusCode, headers: response.headers as Record<string, string> });
  });
  client = await ApplicationClient.open({ baseUrl: origin, applicationKey: credential.applicationKey, stateDir: directory });
});
afterEach(async () => {
  await client?.close(); cipher?.dispose(); await app?.close(); db?.close();
  vi.unstubAllGlobals(); rmSync(directory, { recursive: true, force: true });
});
async function putNote(title: string, markdown = "body", locked = false) {
  const note = makeDocument([], "note", title, null, markdown); note.locked = locked;
  const sealed = await cipher.encryptObject(note.objectId, "note", 1, note);
  const result = await app.inject({ method: "PUT", url: `/api/apps/v1/objects/${note.objectId}`, headers: { authorization: bearer },
    payload: { ...sealed, objectType: "note", baseRevision: 0, deleted: false, idempotencyKey: crypto.randomUUID() } });
  expect(result.statusCode).toBe(200); return note;
}

describe("application grants and encrypted adapters", () => {
  it("separates credentials, Origin protection, read-only permission and account ownership", async () => {
    const note = await putNote("secret title");
    const listed = await app.inject({ method: "GET", url: "/api/account/application-connections", headers: browser() });
    expect(JSON.stringify(listed.json())).not.toContain(credential.authSecret);
    expect(JSON.stringify(listed.json())).not.toContain("vaultEnvelope");
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: bearer } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/apps/v1/connection", headers: { cookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/apps/v1/connection", headers: { authorization: bearer, origin: "https://evil.test" } })).statusCode).toBe(403);
    const read = await registerGrant("read");
    expect((await app.inject({ method: "PUT", url: `/api/apps/v1/objects/${note.objectId}`, headers: { authorization: `Bearer ${read.value.connectionId}.${read.value.authSecret}` }, payload: {} })).statusCode).toBe(403);
    const other = await app.inject({ method: "POST", url: "/api/auth/register", headers: { origin }, payload: registration("beta") });
    const otherCookie = (other.headers["set-cookie"] as string[]).map((value) => value.split(";", 1)[0]).join("; ");
    expect((await app.inject({ method: "DELETE", url: `/api/account/application-connections/${credential.connectionId}`, headers: { origin, cookie: otherCookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/objects/${note.objectId}`, headers: { origin, cookie: otherCookie } })).statusCode).toBe(404);
    const otherGrant = await createApplicationCredential(other.json().user.id, randomBytes(32));
    expect((await app.inject({ method: "POST", url: "/api/account/application-connections", headers: { origin, cookie: otherCookie }, payload: {
      connectionId: otherGrant.connectionId, authSecret: otherGrant.authSecret, vaultEnvelope: otherGrant.vaultEnvelope,
      name: "other", access: "read", idleTimeoutDays: 30, expiresAt: null
    } })).statusCode).toBe(201);
    const otherBearer = `Bearer ${otherGrant.connectionId}.${otherGrant.authSecret}`;
    expect((await app.inject({ method: "GET", url: `/api/apps/v1/objects/${note.objectId}`, headers: { authorization: otherBearer } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/apps/v1/sync", headers: { authorization: otherBearer } })).json().changes).toEqual([]);
    expect((await app.inject({ method: "PATCH", url: `/api/admin/users/${other.json().user.id}`, headers: browser(), payload: { disabled: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: `/api/admin/users/${other.json().user.id}`, headers: browser(), payload: { disabled: false } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/apps/v1/connection", headers: { authorization: otherBearer } })).json().code).toBe("APPLICATION_REVOKED");
    const row = db.prepare("SELECT * FROM application_connections WHERE connection_id = ?").get(credential.connectionId) as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain(credential.applicationKey);
    expect(row.auth_hash).not.toBe(credential.authSecret);
  });

  it("makes registration idempotent and status checks unable to prolong idle expiry", async () => {
    const grant = await registerGrant();
    const retry = await app.inject({ method: "POST", url: "/api/account/application-connections", headers: browser(), payload: grant.body });
    expect(retry.json().idempotent).toBe(true);
    expect((await app.inject({ method: "POST", url: "/api/account/application-connections", headers: browser(), payload: { ...grant.body, name: "changed" } })).statusCode).toBe(409);
    expect(db.prepare("SELECT last_used_at FROM application_connections WHERE connection_id = ?").get(credential.connectionId)).toEqual({ last_used_at: null });
    await client.execute("mint_notes_status");
    expect(db.prepare("SELECT last_used_at FROM application_connections WHERE connection_id = ?").get(credential.connectionId)).toEqual({ last_used_at: null });
    db.prepare("UPDATE application_connections SET created_at = ? WHERE connection_id = ?").run("2000-01-01T00:00:00.000Z", credential.connectionId);
    expect((await app.inject({ method: "GET", url: "/api/apps/v1/connection", headers: { authorization: bearer } })).json().code).toBe("APPLICATION_EXPIRED");
    expect((await app.inject({ method: "PATCH", url: `/api/account/application-connections/${credential.connectionId}`, headers: browser(), payload: { name: "new", idleTimeoutDays: null, expiresAt: null } })).statusCode).toBe(409);
  });

  it("reads verified ciphertext offline, forbids offline writes and fails closed after revocation", async () => {
    const note = await putNote("my secret", "private Markdown");
    expect(await client.execute("mint_notes_search", { query: "Markdown" })).toMatchObject({ offline: false, total: 1 });
    offline = true;
    expect(await client.execute("mint_notes_get", { noteId: note.objectId })).toMatchObject({ offline: true, markdown: "private Markdown" });
    await expect(client.execute("mint_notes_create", { title: "offline" })).rejects.toMatchObject({ code: "OFFLINE_WRITE_DISABLED" });
    offline = false;
    await app.inject({ method: "DELETE", url: `/api/account/application-connections/${credential.connectionId}`, headers: browser() });
    await expect(client.execute("mint_notes_get", { noteId: note.objectId })).rejects.toMatchObject({ code: "APPLICATION_REVOKED" });
    offline = true;
    await expect(client.execute("mint_notes_get", { noteId: note.objectId })).rejects.toMatchObject({ code: "APPLICATION_REVOKED" });
  });

  it("blocks every mutation of locked notes and preserves attachments in edits", async () => {
    const note = await putNote("locked", "body", true);
    expect(await client.execute("mint_notes_get", { noteId: note.objectId })).toMatchObject({ canRead: true, canWrite: false });
    for (const tool of ["update", "append", "trash"]) {
      await expect(client.execute(`mint_notes_${tool}`, { noteId: note.objectId, expectedRevision: 1, ...(tool === "trash" ? {} : { markdown: "changed" }) })).rejects.toMatchObject({ code: "NOTE_LOCKED" });
    }
    const unlocked = await putNote("unlocked");
    await expect(client.execute("mint_notes_update", { noteId: unlocked.objectId, expectedRevision: 1, markdown: `![x](webmd-attachment:${crypto.randomUUID()})` })).rejects.toMatchObject({ code: "ATTACHMENT_REFERENCE_CHANGE" });
  });

  it("persists an interrupted append, retries once after restart, and keeps SQLite free of plaintext", async () => {
    const note = await putNote("note", "original");
    const operationId = crypto.randomUUID();
    const args = { noteId: note.objectId, expectedRevision: 1, markdown: "CONFIDENTIAL_APPEND_9472", operationId };
    beforeFetch = async (path, init) => { if (path === `/api/apps/v1/objects/${note.objectId}` && init.method === "PUT") throw new TypeError("lost network"); };
    expect(await client.execute("mint_notes_append", args)).toMatchObject({ status: "pending", operationId });
    await client.close();
    const files = (await import("node:fs")).readdirSync(join(directory, "mint-notes"));
    for (const file of files) expect(readFileSync(join(directory, "mint-notes", file)).includes(Buffer.from(args.markdown))).toBe(false);
    beforeFetch = null;
    client = await ApplicationClient.open({ baseUrl: origin, applicationKey: credential.applicationKey, stateDir: directory });
    expect(await client.execute("mint_notes_append", args)).toMatchObject({ status: "committed", revision: 2 });
    expect(await client.execute("mint_notes_append", args)).toMatchObject({ status: "committed", revision: 2 });
    expect(await client.execute("mint_notes_get", { noteId: note.objectId })).toMatchObject({ markdown: "original" + args.markdown, revision: 2 });
    await expect(client.execute("mint_notes_append", { ...args, markdown: "different" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("preserves the server version and creates one durable conflict copy", async () => {
    const note = await putNote("racing", "original");
    let raced = false;
    beforeFetch = async (path, init) => {
      if (!raced && path === `/api/apps/v1/objects/${note.objectId}` && init.method === "PUT") {
        raced = true;
        const sealed = await cipher.encryptObject(note.objectId, "note", 2, { ...note, markdown: "server winner" });
        expect((await app.inject({ method: "PUT", url: path, headers: { authorization: bearer }, payload: { ...sealed, objectType: "note", baseRevision: 1, deleted: false, idempotencyKey: crypto.randomUUID() } })).statusCode).toBe(200);
      }
    };
    const args = { noteId: note.objectId, expectedRevision: 1, markdown: "plugin proposal", operationId: crypto.randomUUID() };
    const result = await client.execute("mint_notes_update", args) as { conflictNoteId: string };
    expect(result).toMatchObject({ status: "conflict" });
    expect(await client.execute("mint_notes_get", { noteId: note.objectId })).toMatchObject({ markdown: "server winner", revision: 2 });
    expect(await client.execute("mint_notes_get", { noteId: result.conflictNoteId })).toMatchObject({ markdown: "plugin proposal", revision: 1 });
    expect(await client.execute("mint_notes_update", args)).toEqual(result);
    expect(await client.execute("mint_notes_list")).toMatchObject({ total: 2 });
  });

  it("clones conflict attachment identities and bytes before publishing the copied note", async () => {
    const note = makeDocument([], "note", "with image", null, "");
    const attachmentId = crypto.randomUUID();
    const image = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]).buffer;
    const attachment = await encryptAttachmentBytes({ userId, attachmentId, ownerNoteId: note.objectId, originalName: "secret.png", mime: "image/png", data: image, chunkSize: 1024 * 1024 });
    for (const chunk of attachment.chunks) {
      expect((await app.inject({ method: "PUT", url: `/api/apps/v1/attachments/${attachmentId}/chunks/${chunk.chunkIndex}`,
        headers: { authorization: bearer, "content-type": "application/octet-stream", "x-webmd-nonce": chunk.nonce,
          "x-webmd-total-chunks": String(chunk.totalChunks), "x-webmd-encryption-version": "1", "x-webmd-idempotency-key": crypto.randomUUID() },
        payload: Buffer.from(chunk.ciphertext) })).statusCode).toBe(200);
    }
    const sealedAttachment = await cipher.encryptObject(attachmentId, "attachment", 1, attachment.metadata);
    expect((await app.inject({ method: "PUT", url: `/api/apps/v1/objects/${attachmentId}`, headers: { authorization: bearer }, payload: { ...sealedAttachment, objectType: "attachment", baseRevision: 0, deleted: false, idempotencyKey: crypto.randomUUID() } })).statusCode).toBe(200);
    note.markdown = `![image](WEBMD-ATTACHMENT:${attachmentId.toUpperCase()})`; note.attachmentIds = [attachmentId];
    const sealed = await cipher.encryptObject(note.objectId, "note", 1, note);
    await app.inject({ method: "PUT", url: `/api/apps/v1/objects/${note.objectId}`, headers: { authorization: bearer }, payload: { ...sealed, objectType: "note", baseRevision: 0, deleted: false, idempotencyKey: crypto.randomUUID() } });
    let raced = false;
    beforeFetch = async (path, init) => {
      if (!raced && path === `/api/apps/v1/objects/${note.objectId}` && init.method === "PUT") {
        raced = true;
        const server = await cipher.encryptObject(note.objectId, "note", 2, { ...note, markdown: note.markdown + "server" });
        await app.inject({ method: "PUT", url: path, headers: { authorization: bearer }, payload: { ...server, objectType: "note", baseRevision: 1, deleted: false, idempotencyKey: crypto.randomUUID() } });
      }
    };
    const result = await client.execute("mint_notes_append", { noteId: note.objectId, expectedRevision: 1, markdown: "proposed", operationId: crypto.randomUUID() }) as { status: string; conflictNoteId: string };
    expect(result.status).toBe("conflict");
    const copy = await client.execute("mint_notes_get", { noteId: result.conflictNoteId }) as { attachmentIds: string[]; markdown: string };
    expect(copy.attachmentIds).toHaveLength(1); expect(copy.attachmentIds[0]).not.toBe(attachmentId);
    expect(copy.markdown).toContain(copy.attachmentIds[0]); expect(copy.markdown).not.toContain(attachmentId);
    const copied = await client.execute("mint_notes_read_attachment", { noteId: result.conflictNoteId, attachmentId: copy.attachmentIds[0] }) as { data: ArrayBuffer };
    expect(new Uint8Array(copied.data)).toEqual(new Uint8Array(image));
    const source = await client.execute("mint_notes_read_attachment", { noteId: note.objectId, attachmentId }) as { data: ArrayBuffer };
    expect(new Uint8Array(source.data)).toEqual(new Uint8Array(image));
    offline = true;
    expect(await client.execute("mint_notes_read_attachment", { noteId: result.conflictNoteId, attachmentId: copy.attachmentIds[0] })).toMatchObject({ offline: true });
  });

  it("retains a cancelled encrypted write and blocks offline fallback on rejection during commit", async () => {
    const note = await putNote("cancelled");
    const controller = new AbortController();
    beforeFetch = async (path, init) => { if (path.endsWith(note.objectId) && init.method === "PUT") controller.abort(); };
    expect(await client.execute("mint_notes_append", { noteId: note.objectId, expectedRevision: 1, markdown: "retained", operationId: crypto.randomUUID() }, controller.signal)).toMatchObject({ status: "pending", errorCode: "CANCELLED" });
    beforeFetch = null;
    expect(await client.execute("mint_notes_get", { noteId: note.objectId })).toMatchObject({ markdown: "bodyretained", revision: 2 });
    beforeFetch = async (path, init) => { if (path.endsWith(note.objectId) && init.method === "PUT") db.prepare("UPDATE application_connections SET revoked_at = ? WHERE connection_id = ?").run(new Date().toISOString(), credential.connectionId); };
    await expect(client.execute("mint_notes_append", { noteId: note.objectId, expectedRevision: 2, markdown: "blocked" })).rejects.toMatchObject({ code: "APPLICATION_REVOKED" });
    offline = true;
    await expect(client.execute("mint_notes_get", { noteId: note.objectId })).rejects.toMatchObject({ code: "APPLICATION_REVOKED" });
  });

  it.each(["purged", "history-cleared"])("retries a pending edit after its original is %s", async (action) => {
    const note = await putNote("pending original");
    const args = { noteId: note.objectId, expectedRevision: 1, markdown: "retained proposal", operationId: crypto.randomUUID() };
    beforeFetch = async (path, init) => { if (path.endsWith(note.objectId) && init.method === "PUT") throw new TypeError("offline"); };
    expect(await client.execute("mint_notes_append", args)).toMatchObject({ status: "pending" });
    beforeFetch = null;
    if (action === "purged") {
      const deleted = await cipher.encryptObject(note.objectId, "note", 2, { ...note, deleted: true });
      expect((await app.inject({ method: "PUT", url: `/api/objects/${note.objectId}`, headers: browser(), payload: { ...deleted, objectType: "note", baseRevision: 1, deleted: true, idempotencyKey: crypto.randomUUID() } })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: "/api/objects/purge", headers: browser(), payload: { objects: [{ objectId: note.objectId, baseRevision: 2 }] } })).statusCode).toBe(200);
    } else {
      expect((await app.inject({ method: "DELETE", url: `/api/notes/${note.objectId}/history`, headers: browser() })).statusCode).toBe(200);
    }
    const result = await client.execute("mint_notes_append", args) as { status: string; conflictNoteId?: string };
    expect(result.status).toBe(action === "purged" ? "conflict" : "committed");
    expect(await client.execute("mint_notes_get", { noteId: result.conflictNoteId ?? note.objectId })).toMatchObject({ markdown: "bodyretained proposal" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM note_history WHERE note_id = ?").get(note.objectId)).toEqual({ count: 0 });
  });

  it.each(["password", "recover"])("revokes applications through the actual %s endpoint", async (action) => {
    const account = registration("alpha");
    const payload = { newAuthSecret: "next-derived-auth-secret-000001", newKdfSalt: "x".repeat(24), newKdfParams: account.kdfParams,
      newWrappedVaultKey: "z".repeat(32), newWrappedVaultNonce: "y".repeat(24),
      ...(action === "password" ? { currentAuthSecret: account.authSecret } : { username: account.username, recoveryAuthSecret: account.recoveryAuthSecret }) };
    expect((await app.inject({ method: "POST", url: `/api/auth/${action}`, headers: browser(), payload })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/apps/v1/connection", headers: { authorization: bearer } })).json().code).toBe("APPLICATION_REVOKED");
  });

  it("keeps application authorization independent of recovery-key rotation and browser logout", async () => {
    const account = registration("alpha");
    expect((await app.inject({ method: "POST", url: "/api/account/recovery-key", headers: browser(), payload: {
      currentAuthSecret: account.authSecret, recoveryAuthSecret: "rotated-recovery-secret-000001", recoveryWrappedVaultKey: "z".repeat(32), recoveryWrappedVaultNonce: "y".repeat(24)
    } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/auth/logout", headers: browser() })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/apps/v1/connection", headers: { authorization: bearer } })).statusCode).toBe(200);
  });

  it("revokes application grants together with account credential invalidation", async () => {
    db.transaction(() => revokeUserCredentials(db, userId))();
    expect((await app.inject({ method: "GET", url: "/api/apps/v1/connection", headers: { authorization: bearer } })).json().code).toBe("APPLICATION_REVOKED");
  });
});
