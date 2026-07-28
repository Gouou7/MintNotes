import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { openDatabase, runRegistrationTransaction, type AppDatabase } from "./database.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { createSessionService } from "./auth/sessionService.js";
import { registerAttachmentRoutes } from "./attachments/routes.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { cleanupUserHistory, HISTORY_CAPTURE_KINDS, historyUsage } from "./history.js";
import { startMaintenanceJobs } from "./maintenance.js";
import { SyncEventHub } from "./syncEvents.js";
import {
  hashOpaqueSecret,
  hashToken,
  verifyOpaqueSecret
} from "./security.js";
import { registerSyncRoutes } from "./sync/routes.js";
import type { SessionUser } from "./types.js";

export interface RouteApplicationOptions {
  config?: ServerConfig;
  db?: AppDatabase;
  syncEvents?: SyncEventHub;
  maintenance?: boolean;
}

export async function createRouteApplication(options: RouteApplicationOptions = {}) {
const config = options.config ?? loadServerConfig();
const app = Fastify({ logger: true, trustProxy: config.trustProxy, bodyLimit: 2 * 1024 * 1024 });
const db = options.db ?? openDatabase(config.dataDirectory);
const syncEvents = options.syncEvents ?? new SyncEventHub();
const ownsDatabase = options.db === undefined;
const {
  authenticate,
  requireAdmin,
  setSession,
  endpointSummary,
  sessionCookie
} = createSessionService(db, config, syncEvents);

await app.register(cookie);
app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
await app.register(rateLimit, { global: false });
await app.register(helmet, {
  global: true,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // hash-wasm compiles the bundled Argon2id WebAssembly module. This
      // permits WASM compilation without enabling JavaScript 'unsafe-eval'.
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  }
});

app.decorateRequest("sessionUser", null);
app.decorateRequest("sessionContext", null);

app.addHook("onRequest", async (request, reply) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
  const origin = request.headers.origin;
  if (!origin) return;
  const allowed = config.appOrigin ?? `${request.protocol}://${request.headers.host}`;
  if (origin !== allowed) {
    return reply.code(403).send({ error: "Cross-origin state change rejected" });
  }
});

const secretField = z.string().min(20).max(1024);
const envelopeField = z.string().min(16).max(2_000_000);
const usernameField = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,47}$/);

const registerSchema = z.object({
  username: usernameField,
  displayName: z.string().trim().min(1).max(80),
  authSecret: secretField,
  kdfSalt: z.string().min(16).max(200),
  kdfParams: z.object({ algorithm: z.literal("argon2id"), opsLimit: z.number().int().positive(), memLimit: z.number().int().positive(), version: z.number().int().positive() }),
  wrappedVaultKey: envelopeField,
  wrappedVaultNonce: z.string().min(16).max(200),
  recoveryAuthSecret: secretField,
  recoveryWrappedVaultKey: envelopeField,
  recoveryWrappedVaultNonce: z.string().min(16).max(200)
});

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/auth/config", async () => {
  const count = (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
  return { allowRegistration: config.allowRegistration, bootstrapAllowed: count === 0 };
});

function insertUser(body: z.infer<typeof registerSchema>, role: "admin" | "user") {
  if (db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(body.username)) {
    throw new Error("USERNAME_UNAVAILABLE");
  }
  const id = randomUUID();
  const auth = hashOpaqueSecret(body.authSecret);
  const recovery = hashOpaqueSecret(body.recoveryAuthSecret);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (
      id, username, display_name, role, auth_salt, auth_hash, kdf_salt, kdf_params,
      wrapped_vault_key, wrapped_vault_nonce, recovery_auth_salt, recovery_auth_hash,
      recovery_wrapped_vault_key, recovery_wrapped_vault_nonce, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, body.username, body.displayName, role, auth.salt, auth.hash,
    body.kdfSalt, JSON.stringify(body.kdfParams), body.wrappedVaultKey, body.wrappedVaultNonce,
    recovery.salt, recovery.hash, body.recoveryWrappedVaultKey, body.recoveryWrappedVaultNonce, now
  );
  return { id, now };
}

app.post(
  "/api/auth/register",
  { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
  async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid registration data" });
    const body = parsed.data;
    let registration: { id: string; role: "admin" | "user" };
    try {
      const result = runRegistrationTransaction(db, config.allowRegistration, (role) => {
        db.prepare("DELETE FROM account_setups WHERE expires_at <= ?").run(new Date().toISOString());
        if (db.prepare("SELECT 1 FROM account_setups WHERE username = ? COLLATE NOCASE").get(body.username)) {
          throw new Error("USERNAME_RESERVED");
        }
        return insertUser(body, role).id;
      });
      registration = { id: result.value, role: result.role };
    } catch (error) {
      if (error instanceof Error && error.message === "REGISTRATION_CLOSED") return reply.code(403).send({ error: "Registration is closed" });
      if (error instanceof Error && error.message === "USERNAME_RESERVED") return reply.code(409).send({ error: "Username is reserved for account activation" });
      if (error instanceof Error && error.message === "USERNAME_UNAVAILABLE") return reply.code(409).send({ error: "Username is unavailable" });
      throw error;
    }
    const endpoint = setSession(request, reply, registration.id, false);
    return reply.code(201).send({ user: { id: registration.id, username: body.username, displayName: body.displayName, role: registration.role }, endpoint });
  }
);

app.post(
  "/api/auth/activate",
  { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
  async (request, reply) => {
    const parsed = registerSchema.extend({ activationCode: z.string().min(20).max(300) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid account activation" });
    const body = parsed.data;
    const setup = db.prepare(`
      SELECT id, username, display_name FROM account_setups
      WHERE username = ? COLLATE NOCASE AND code_hash = ? AND expires_at > ?
    `).get(body.username, hashToken(body.activationCode), new Date().toISOString()) as { id: string; username: string; display_name: string } | undefined;
    if (!setup) return reply.code(403).send({ error: "Activation code is invalid or expired" });
    let id = "";
    try {
      db.transaction(() => {
        id = insertUser({ ...body, username: setup.username, displayName: setup.display_name }, "user").id;
        db.prepare("DELETE FROM account_setups WHERE id = ?").run(setup.id);
      })();
    } catch (error) {
      if (error instanceof Error && error.message === "USERNAME_UNAVAILABLE") return reply.code(409).send({ error: "Username is unavailable" });
      throw error;
    }
    const endpoint = setSession(request, reply, id, false);
    return reply.code(201).send({ user: { id, username: setup.username, displayName: setup.display_name, role: "user" }, endpoint });
  }
);

app.get("/api/auth/parameters/:username", async (request, reply) => {
  const parsed = usernameField.safeParse((request.params as { username: string }).username);
  if (!parsed.success) return reply.code(404).send({ error: "Account not found" });
  const row = db.prepare(`
    SELECT kdf_salt, kdf_params, recovery_wrapped_vault_key, recovery_wrapped_vault_nonce
    FROM users WHERE username = ? COLLATE NOCASE AND disabled = 0
  `).get(parsed.data) as { kdf_salt: string; kdf_params: string; recovery_wrapped_vault_key: string; recovery_wrapped_vault_nonce: string } | undefined;
  if (!row) return reply.code(404).send({ error: "Account not found" });
  return {
    kdfSalt: row.kdf_salt,
    kdfParams: JSON.parse(row.kdf_params),
    recoveryWrappedVaultKey: row.recovery_wrapped_vault_key,
    recoveryWrappedVaultNonce: row.recovery_wrapped_vault_nonce
  };
});

const loginSchema = z.object({ username: usernameField, authSecret: secretField, rememberDevice: z.boolean().default(false) });
app.post(
  "/api/auth/login",
  { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
  async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid credentials" });
    const row = db.prepare(`
      SELECT id, username, display_name, role, disabled, auth_salt, auth_hash, wrapped_vault_key, wrapped_vault_nonce
      FROM users WHERE username = ? COLLATE NOCASE
    `).get(parsed.data.username) as any;
    if (!row || row.disabled || !verifyOpaqueSecret(parsed.data.authSecret, row.auth_salt, row.auth_hash)) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    const endpoint = setSession(request, reply, row.id, parsed.data.rememberDevice);
    return {
      user: { id: row.id, username: row.username, displayName: row.display_name, role: row.role },
      wrappedVaultKey: row.wrapped_vault_key,
      wrappedVaultNonce: row.wrapped_vault_nonce,
      endpoint
    };
  }
);

app.post("/api/auth/logout", { preHandler: authenticate }, async (request, reply) => {
  const user = request.sessionUser as SessionUser;
  const endpointId = request.sessionContext!.endpointId;
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND endpoint_id = ? AND revoked_at IS NULL").run(now, user.id, endpointId);
    db.prepare("UPDATE trusted_endpoints SET remembered = 0, revoked_at = ? WHERE user_id = ? AND endpoint_id = ?").run(now, user.id, endpointId);
  })();
  syncEvents.closeEndpoint(user.id, endpointId);
  reply.clearCookie(sessionCookie, { path: "/" });
  return { ok: true };
});

app.get("/api/auth/me", { preHandler: authenticate }, async (request) => ({
  user: request.sessionUser,
  endpoint: endpointSummary(request.sessionContext!.endpointId, request.sessionContext!.remembered)
}));

app.post(
  "/api/auth/reauth",
  { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
  async (request, reply) => {
    const parsed = z.object({ authSecret: secretField }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid credentials" });
    const user = request.sessionUser as SessionUser;
    const row = db.prepare(`
      SELECT auth_salt, auth_hash, wrapped_vault_key, wrapped_vault_nonce
      FROM users WHERE id = ? AND disabled = 0
    `).get(user.id) as { auth_salt: string; auth_hash: string; wrapped_vault_key: string; wrapped_vault_nonce: string } | undefined;
    if (!row || !verifyOpaqueSecret(parsed.data.authSecret, row.auth_salt, row.auth_hash)) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    return { wrappedVaultKey: row.wrapped_vault_key, wrappedVaultNonce: row.wrapped_vault_nonce };
  }
);

const recoverySchema = z.object({
  username: usernameField,
  recoveryAuthSecret: secretField,
  newAuthSecret: secretField,
  newKdfSalt: z.string().min(16).max(200),
  newKdfParams: registerSchema.shape.kdfParams,
  newWrappedVaultKey: envelopeField,
  newWrappedVaultNonce: z.string().min(16).max(200)
});
app.post(
  "/api/auth/recover",
  { config: { rateLimit: { max: 5, timeWindow: "30 minutes" } } },
  async (request, reply) => {
    const parsed = recoverySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid recovery request" });
    const body = parsed.data;
    const row = db.prepare("SELECT id, recovery_auth_salt, recovery_auth_hash FROM users WHERE username = ? COLLATE NOCASE").get(body.username) as any;
    if (!row || !verifyOpaqueSecret(body.recoveryAuthSecret, row.recovery_auth_salt, row.recovery_auth_hash)) {
      return reply.code(401).send({ error: "Recovery failed" });
    }
    const nextAuth = hashOpaqueSecret(body.newAuthSecret);
    db.transaction(() => {
      db.prepare(`
        UPDATE users SET auth_salt = ?, auth_hash = ?, kdf_salt = ?, kdf_params = ?,
          wrapped_vault_key = ?, wrapped_vault_nonce = ? WHERE id = ?
      `).run(nextAuth.salt, nextAuth.hash, body.newKdfSalt, JSON.stringify(body.newKdfParams), body.newWrappedVaultKey, body.newWrappedVaultNonce, row.id);
      db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(new Date().toISOString(), row.id);
      db.prepare("UPDATE trusted_endpoints SET remembered = 0, revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(new Date().toISOString(), row.id);
    })();
    syncEvents.closeUser(row.id);
    return { ok: true };
  }
);

const passwordSchema = z.object({
  currentAuthSecret: secretField,
  newAuthSecret: secretField,
  newKdfSalt: z.string().min(16).max(200),
  newKdfParams: registerSchema.shape.kdfParams,
  newWrappedVaultKey: envelopeField,
  newWrappedVaultNonce: z.string().min(16).max(200)
});

app.post("/api/auth/password", { preHandler: authenticate }, async (request, reply) => {
  const parsed = passwordSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid password change" });
  const user = request.sessionUser as SessionUser;
  const row = db.prepare("SELECT auth_salt, auth_hash FROM users WHERE id = ?").get(user.id) as { auth_salt: string; auth_hash: string };
  if (!verifyOpaqueSecret(parsed.data.currentAuthSecret, row.auth_salt, row.auth_hash)) {
    return reply.code(401).send({ error: "Current password is incorrect" });
  }
  const nextAuth = hashOpaqueSecret(parsed.data.newAuthSecret);
  const rawToken = request.cookies[sessionCookie];
  const currentTokenHash = rawToken ? hashToken(rawToken) : "";
  db.transaction(() => {
    db.prepare(`
      UPDATE users SET auth_salt = ?, auth_hash = ?, kdf_salt = ?, kdf_params = ?,
        wrapped_vault_key = ?, wrapped_vault_nonce = ? WHERE id = ?
    `).run(
      nextAuth.salt, nextAuth.hash, parsed.data.newKdfSalt, JSON.stringify(parsed.data.newKdfParams),
      parsed.data.newWrappedVaultKey, parsed.data.newWrappedVaultNonce, user.id
    );
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL").run(new Date().toISOString(), user.id, currentTokenHash);
    db.prepare("UPDATE trusted_endpoints SET remembered = 0, revoked_at = ? WHERE user_id = ? AND endpoint_id <> ? AND revoked_at IS NULL").run(
      new Date().toISOString(), user.id, request.sessionContext!.endpointId
    );
  })();
  syncEvents.closeUser(user.id, request.sessionContext!.id);
  return { ok: true };
});

const recoveryKeyResetSchema = z.object({
  currentAuthSecret: secretField,
  recoveryAuthSecret: secretField,
  recoveryWrappedVaultKey: envelopeField,
  recoveryWrappedVaultNonce: z.string().min(16).max(200)
});

app.post("/api/account/recovery-key", { preHandler: authenticate }, async (request, reply) => {
  const parsed = recoveryKeyResetSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid recovery key reset" });
  const user = request.sessionUser as SessionUser;
  const row = db.prepare("SELECT auth_salt, auth_hash FROM users WHERE id = ?").get(user.id) as { auth_salt: string; auth_hash: string } | undefined;
  if (!row || !verifyOpaqueSecret(parsed.data.currentAuthSecret, row.auth_salt, row.auth_hash)) {
    return reply.code(401).send({ error: "Current password is incorrect" });
  }
  const recovery = hashOpaqueSecret(parsed.data.recoveryAuthSecret);
  db.prepare(`
    UPDATE users SET recovery_auth_salt = ?, recovery_auth_hash = ?,
      recovery_wrapped_vault_key = ?, recovery_wrapped_vault_nonce = ?
    WHERE id = ?
  `).run(
    recovery.salt,
    recovery.hash,
    parsed.data.recoveryWrappedVaultKey,
    parsed.data.recoveryWrappedVaultNonce,
    user.id
  );
  return { ok: true };
});

app.patch("/api/account/profile", { preHandler: authenticate }, async (request, reply) => {
  const parsed = z.object({ displayName: z.string().trim().min(1).max(80) }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid profile" });
  const user = request.sessionUser as SessionUser;
  db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(parsed.data.displayName, user.id);
  return { user: { ...user, displayName: parsed.data.displayName } };
});

const avatarEnvelopeSchema = z.object({
  ciphertext: z.string().min(16).max(1_000_000),
  nonce: z.string().min(16).max(200),
  encryptionVersion: z.literal(1)
});

app.get("/api/account/avatar", { preHandler: authenticate }, async (request) => {
  const user = request.sessionUser as SessionUser;
  const row = db.prepare(`
    SELECT ciphertext, nonce, encryption_version, updated_at
    FROM profile_assets WHERE user_id = ?
  `).get(user.id) as { ciphertext: string; nonce: string; encryption_version: number; updated_at: string } | undefined;
  return {
    avatar: row ? {
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      encryptionVersion: row.encryption_version,
      updatedAt: row.updated_at
    } : null
  };
});

app.put("/api/account/avatar", { preHandler: authenticate }, async (request, reply) => {
  const parsed = avatarEnvelopeSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid encrypted avatar" });
  const user = request.sessionUser as SessionUser;
  const updatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO profile_assets (user_id, ciphertext, nonce, encryption_version, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext,
      nonce = excluded.nonce, encryption_version = excluded.encryption_version,
      updated_at = excluded.updated_at
  `).run(user.id, parsed.data.ciphertext, parsed.data.nonce, parsed.data.encryptionVersion, updatedAt);
  return { avatar: { ...parsed.data, updatedAt } };
});

app.delete("/api/account/avatar", { preHandler: authenticate }, async (request) => {
  const user = request.sessionUser as SessionUser;
  db.prepare("DELETE FROM profile_assets WHERE user_id = ?").run(user.id);
  return { ok: true };
});

app.get("/api/account/trash-retention", { preHandler: authenticate }, async (request) => {
  const user = request.sessionUser as SessionUser;
  const row = db.prepare("SELECT trash_retention_days FROM users WHERE id = ?").get(user.id) as { trash_retention_days: number | null };
  return { days: row.trash_retention_days };
});

app.patch("/api/account/trash-retention", { preHandler: authenticate }, async (request, reply) => {
  const parsed = z.object({ days: z.number().int().min(1).max(3650).nullable() }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid trash retention" });
  const user = request.sessionUser as SessionUser;
  db.prepare("UPDATE users SET trash_retention_days = ? WHERE id = ?").run(parsed.data.days, user.id);
  return { days: parsed.data.days };
});

const historySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z.union([z.literal(5), z.literal(10), z.literal(30), z.literal(60)]).optional(),
  retentionDays: z.union([
    z.literal(7),
    z.literal(30),
    z.literal(90),
    z.literal(180),
    z.literal(365),
    z.null()
  ]).optional()
}).refine((value) => Object.keys(value).length > 0);

function accountHistorySettings(userId: string) {
  cleanupUserHistory(db, userId);
  const row = db.prepare(`
    SELECT history_enabled, history_interval_minutes, history_retention_days,
      history_cleared_before
    FROM users
    WHERE id = ?
  `).get(userId) as {
    history_enabled: number;
    history_interval_minutes: 5 | 10 | 30 | 60;
    history_retention_days: 7 | 30 | 90 | 180 | 365 | null;
    history_cleared_before: string | null;
  };
  const usage = historyUsage(db, userId);
  return {
    enabled: Boolean(row.history_enabled),
    intervalMinutes: row.history_interval_minutes,
    retentionDays: row.history_retention_days,
    clearedBefore: row.history_cleared_before,
    ...usage,
    quotaBytes: config.userHistoryQuotaBytes
  };
}

app.get("/api/account/note-history-settings", { preHandler: authenticate }, async (request) => {
  const user = request.sessionUser as SessionUser;
  return accountHistorySettings(user.id);
});

app.patch("/api/account/note-history-settings", { preHandler: authenticate }, async (request, reply) => {
  const parsed = historySettingsSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid note history settings" });
  const user = request.sessionUser as SessionUser;
  const current = db.prepare(`
    SELECT history_enabled, history_interval_minutes, history_retention_days
    FROM users WHERE id = ?
  `).get(user.id) as { history_enabled: number; history_interval_minutes: number; history_retention_days: number | null };
  db.prepare(`
    UPDATE users
    SET history_enabled = ?, history_interval_minutes = ?, history_retention_days = ?
    WHERE id = ?
  `).run(
    parsed.data.enabled === undefined ? current.history_enabled : parsed.data.enabled ? 1 : 0,
    parsed.data.intervalMinutes ?? current.history_interval_minutes,
    parsed.data.retentionDays === undefined ? current.history_retention_days : parsed.data.retentionDays,
    user.id
  );
  return accountHistorySettings(user.id);
});

function encodeHistoryCursor(capturedAt: string, historyId: string): string {
  return Buffer.from(JSON.stringify([capturedAt, historyId]), "utf8").toString("base64url");
}

function decodeHistoryCursor(value: string | undefined): [string, string] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") return null;
    return [parsed[0], parsed[1]];
  } catch {
    return null;
  }
}

function historyClearBoundary(userId: string, noteId: string): string | null {
  const row = db.prepare(`
    SELECT u.history_cleared_before AS account_boundary, m.cleared_before AS note_boundary
    FROM users u
    LEFT JOIN note_history_clear_markers m ON m.user_id = u.id AND m.note_id = ?
    WHERE u.id = ?
  `).get(noteId, userId) as { account_boundary: string | null; note_boundary: string | null } | undefined;
  if (!row) return null;
  return [row.account_boundary, row.note_boundary].filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

app.get("/api/notes/:noteId/history", { preHandler: authenticate }, async (request, reply) => {
  const noteId = z.string().uuid().safeParse((request.params as { noteId: string }).noteId);
  const query = z.object({
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  }).safeParse(request.query);
  if (!noteId.success || !query.success) return reply.code(400).send({ error: "Invalid note history request" });
  const cursor = decodeHistoryCursor(query.data.cursor);
  if (query.data.cursor && !cursor) return reply.code(400).send({ error: "Invalid note history request" });
  const user = request.sessionUser as SessionUser;
  cleanupUserHistory(db, user.id);
  const exists = db.prepare(`
    SELECT 1 FROM objects WHERE user_id = ? AND object_id = ? AND object_type = 'note'
  `).get(user.id, noteId.data);
  if (!exists) return reply.code(404).send({ error: "Note not found" });
  const rows = (cursor
    ? db.prepare(`
        SELECT history_id, captured_at, capture_kind, byte_size, created_at
        FROM note_history
        WHERE user_id = ? AND note_id = ?
          AND (captured_at < ? OR (captured_at = ? AND history_id < ?))
        ORDER BY captured_at DESC, history_id DESC
        LIMIT ?
      `).all(user.id, noteId.data, cursor[0], cursor[0], cursor[1], query.data.limit + 1)
    : db.prepare(`
        SELECT history_id, captured_at, capture_kind, byte_size, created_at
        FROM note_history
        WHERE user_id = ? AND note_id = ?
        ORDER BY captured_at DESC, history_id DESC
        LIMIT ?
      `).all(user.id, noteId.data, query.data.limit + 1)) as Array<{
        history_id: string;
        captured_at: string;
        capture_kind: string;
        byte_size: number;
        created_at: string;
      }>;
  const hasMore = rows.length > query.data.limit;
  const page = hasMore ? rows.slice(0, query.data.limit) : rows;
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      historyId: row.history_id,
      noteId: noteId.data,
      capturedAt: row.captured_at,
      captureKind: row.capture_kind,
      byteSize: row.byte_size,
      pending: false,
      serverCreatedAt: row.created_at
    })),
    nextCursor: hasMore && last ? encodeHistoryCursor(last.captured_at, last.history_id) : null,
    clearedBefore: historyClearBoundary(user.id, noteId.data)
  };
});

const historyEnvelopeSchema = z.object({
  capturedAt: z.string().datetime({ offset: true }),
  captureKind: z.enum(HISTORY_CAPTURE_KINDS),
  ciphertext: envelopeField,
  nonce: z.string().min(16).max(200),
  encryptionVersion: z.literal(1),
  idempotencyKey: z.string().uuid()
});

app.post("/api/notes/:noteId/history/:historyId", { preHandler: authenticate }, async (request, reply) => {
  const params = z.object({
    noteId: z.string().uuid(),
    historyId: z.string().uuid()
  }).safeParse(request.params);
  const parsed = historyEnvelopeSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: "Invalid encrypted note history" });
  const user = request.sessionUser as SessionUser;
  cleanupUserHistory(db, user.id);
  const prior = db.prepare(`
    SELECT note_id, history_id FROM note_history
    WHERE user_id = ? AND idempotency_key = ?
  `).get(user.id, parsed.data.idempotencyKey) as { note_id: string; history_id: string } | undefined;
  if (prior) return { ok: true, idempotent: true, noteId: prior.note_id, historyId: prior.history_id };
  const note = db.prepare(`
    SELECT 1 FROM objects WHERE user_id = ? AND object_id = ? AND object_type = 'note'
  `).get(user.id, params.data.noteId);
  if (!note) return reply.code(404).send({ error: "Note not found" });
  const boundary = historyClearBoundary(user.id, params.data.noteId);
  if (boundary && parsed.data.capturedAt <= boundary) {
    return reply.code(409).send({ error: "History snapshot was cleared", clearedBefore: boundary });
  }
  const byteSize = Buffer.byteLength(parsed.data.ciphertext, "utf8");
  const usage = historyUsage(db, user.id);
  if (usage.usedBytes + byteSize > config.userHistoryQuotaBytes) {
    return reply.code(413).send({ error: "Note history quota exceeded" });
  }
  try {
    db.prepare(`
      INSERT INTO note_history (
        user_id, note_id, history_id, captured_at, capture_kind, ciphertext, nonce,
        encryption_version, byte_size, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      params.data.noteId,
      params.data.historyId,
      parsed.data.capturedAt,
      parsed.data.captureKind,
      parsed.data.ciphertext,
      parsed.data.nonce,
      parsed.data.encryptionVersion,
      byteSize,
      parsed.data.idempotencyKey,
      new Date().toISOString()
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return reply.code(409).send({ error: "History snapshot already exists" });
    }
    throw error;
  }
  return reply.code(201).send({ ok: true, noteId: params.data.noteId, historyId: params.data.historyId, byteSize });
});

app.get("/api/notes/:noteId/history/:historyId", { preHandler: authenticate }, async (request, reply) => {
  const params = z.object({ noteId: z.string().uuid(), historyId: z.string().uuid() }).safeParse(request.params);
  if (!params.success) return reply.code(404).send({ error: "History snapshot not found" });
  const user = request.sessionUser as SessionUser;
  const row = db.prepare(`
    SELECT captured_at, capture_kind, ciphertext, nonce, encryption_version, byte_size, created_at
    FROM note_history
    WHERE user_id = ? AND note_id = ? AND history_id = ?
  `).get(user.id, params.data.noteId, params.data.historyId) as {
    captured_at: string;
    capture_kind: string;
    ciphertext: string;
    nonce: string;
    encryption_version: number;
    byte_size: number;
    created_at: string;
  } | undefined;
  if (!row) return reply.code(404).send({ error: "History snapshot not found" });
  reply.header("Cache-Control", "private, no-store");
  return {
    historyId: params.data.historyId,
    noteId: params.data.noteId,
    capturedAt: row.captured_at,
    captureKind: row.capture_kind,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    encryptionVersion: row.encryption_version,
    byteSize: row.byte_size,
    pending: false,
    serverCreatedAt: row.created_at
  };
});

app.delete("/api/notes/:noteId/history/:historyId", { preHandler: authenticate }, async (request, reply) => {
  const params = z.object({ noteId: z.string().uuid(), historyId: z.string().uuid() }).safeParse(request.params);
  if (!params.success) return reply.code(404).send({ error: "History snapshot not found" });
  const user = request.sessionUser as SessionUser;
  const result = db.prepare(`
    DELETE FROM note_history WHERE user_id = ? AND note_id = ? AND history_id = ?
  `).run(user.id, params.data.noteId, params.data.historyId);
  if (!result.changes) return reply.code(404).send({ error: "History snapshot not found" });
  return { ok: true };
});

app.delete("/api/notes/:noteId/history", { preHandler: authenticate }, async (request, reply) => {
  const noteId = z.string().uuid().safeParse((request.params as { noteId: string }).noteId);
  if (!noteId.success) return reply.code(404).send({ error: "Note not found" });
  const user = request.sessionUser as SessionUser;
  const note = db.prepare(`
    SELECT 1 FROM objects WHERE user_id = ? AND object_id = ? AND object_type = 'note'
  `).get(user.id, noteId.data);
  if (!note) return reply.code(404).send({ error: "Note not found" });
  const clearedBefore = new Date().toISOString();
  const deleted = db.transaction(() => {
    db.prepare(`
      INSERT INTO note_history_clear_markers (user_id, note_id, cleared_before)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, note_id) DO UPDATE SET cleared_before = excluded.cleared_before
    `).run(user.id, noteId.data, clearedBefore);
    return db.prepare("DELETE FROM note_history WHERE user_id = ? AND note_id = ?").run(user.id, noteId.data).changes;
  })();
  return { ok: true, deleted, clearedBefore };
});

app.delete("/api/account/note-history", { preHandler: authenticate }, async (request) => {
  const user = request.sessionUser as SessionUser;
  const clearedBefore = new Date().toISOString();
  const deleted = db.transaction(() => {
    db.prepare("UPDATE users SET history_cleared_before = ? WHERE id = ?").run(clearedBefore, user.id);
    db.prepare("DELETE FROM note_history_clear_markers WHERE user_id = ?").run(user.id);
    return db.prepare("DELETE FROM note_history WHERE user_id = ?").run(user.id).changes;
  })();
  return { ok: true, deleted, clearedBefore };
});

const SESSION_REVOCATION_AGE_MS = 24 * 60 * 60 * 1000;

app.get("/api/account/endpoints", { preHandler: authenticate }, async (request) => {
  const user = request.sessionUser as SessionUser;
  const current = request.sessionContext!;
  const now = new Date();
  const canRevokeOthers = now.getTime() - new Date(current.endpointFirstSeenAt).getTime() >= SESSION_REVOCATION_AGE_MS;
  const rows = db.prepare(`
    SELECT endpoint_id, device_name, ip_address, first_seen_at, last_login_at,
      last_seen_at, login_count, remembered, revoked_at,
      EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.endpoint_id = trusted_endpoints.endpoint_id AND s.user_id = trusted_endpoints.user_id
          AND s.revoked_at IS NULL AND s.expires_at > ?
      ) AS active
    FROM trusted_endpoints
    WHERE user_id = ?
    ORDER BY last_seen_at DESC
    LIMIT 50
  `).all(now.toISOString(), user.id) as Array<{
    endpoint_id: string;
    device_name: string;
    ip_address: string;
    first_seen_at: string;
    last_login_at: string;
    last_seen_at: string;
    login_count: number;
    remembered: number;
    revoked_at: string | null;
    active: number;
  }>;
  return {
    canRevokeOthers,
    revokeEligibleAt: new Date(new Date(current.endpointFirstSeenAt).getTime() + SESSION_REVOCATION_AGE_MS).toISOString(),
    endpoints: rows.map((row) => ({
      id: row.endpoint_id,
      deviceName: row.device_name,
      ipAddress: row.ip_address,
      firstSeenAt: row.first_seen_at,
      lastLoginAt: row.last_login_at,
      lastSeenAt: row.last_seen_at,
      loginCount: row.login_count,
      remembered: Boolean(row.remembered),
      revokedAt: row.revoked_at,
      current: row.endpoint_id === current.endpointId,
      active: Boolean(row.active) && row.revoked_at === null
    }))
  };
});

app.delete("/api/account/endpoints/:endpointId", { preHandler: authenticate }, async (request, reply) => {
  const endpointId = z.string().uuid().safeParse((request.params as { endpointId: string }).endpointId);
  if (!endpointId.success) return reply.code(404).send({ error: "Endpoint not found" });
  const user = request.sessionUser as SessionUser;
  const current = request.sessionContext!;
  const eligibleAt = new Date(new Date(current.endpointFirstSeenAt).getTime() + SESSION_REVOCATION_AGE_MS);
  if (Date.now() < eligibleAt.getTime()) {
    return reply.code(403).send({ error: "Current endpoint must be at least 24 hours old", eligibleAt: eligibleAt.toISOString() });
  }
  if (endpointId.data === current.endpointId) return reply.code(400).send({ error: "Use logout to end the current endpoint" });
  const target = db.prepare("SELECT revoked_at FROM trusted_endpoints WHERE endpoint_id = ? AND user_id = ?").get(endpointId.data, user.id) as { revoked_at: string | null } | undefined;
  if (!target) return reply.code(404).send({ error: "Endpoint not found" });
  if (target.revoked_at !== null) return reply.code(409).send({ error: "Endpoint is already signed out" });
  const revokedAt = new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE trusted_endpoints SET remembered = 0, revoked_at = ? WHERE endpoint_id = ? AND user_id = ?").run(revokedAt, endpointId.data, user.id);
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE endpoint_id = ? AND user_id = ? AND revoked_at IS NULL").run(revokedAt, endpointId.data, user.id);
  })();
  syncEvents.closeEndpoint(user.id, endpointId.data);
  return { ok: true };
});

registerSyncRoutes(app, { db, syncEvents, authenticate });
registerAttachmentRoutes(app, { db, config, authenticate });
registerAdminRoutes(app, { db, syncEvents, requireAdmin });

const webRoot = resolve("dist");
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot, wildcard: false });
  app.get("/*", async (_request, reply) => reply.sendFile("index.html"));
}

const maintenance = options.maintenance === false
  ? null
  : startMaintenanceJobs(db, syncEvents, app.log);

app.addHook("onClose", async () => {
  maintenance?.stop();
  syncEvents.closeAll();
  if (ownsDatabase) db.close();
});

return app;
}
