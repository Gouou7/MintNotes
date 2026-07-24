import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { openDatabase, runRegistrationTransaction } from "./database.js";
import { cleanupAllHistory, cleanupUserHistory, HISTORY_CAPTURE_KINDS, historyUsage } from "./history.js";
import { SyncEventHub } from "./syncEvents.js";
import { purgeExpiredTrash, purgeTargets } from "./trash.js";
import {
  createSessionToken,
  hashOpaqueSecret,
  hashToken,
  verifyOpaqueSecret
} from "./security.js";
import type { AuthGuard, SessionUser } from "./types.js";

const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8787),
  dataDirectory: resolve(process.env.NODE_ENV === "production" ? "/data" : process.env.MINT_NOTES_SMOKE_STORAGE_PATH ?? "./data"),
  allowRegistration: process.env.ALLOW_REGISTRATION === "true",
  maxAttachmentBytes: Math.max(1, Number(process.env.MAX_ATTACHMENT_SIZE_MB ?? 25)) * 1024 * 1024,
  userStorageQuotaBytes: Math.max(1, Number(process.env.USER_STORAGE_QUOTA_MB ?? 2048)) * 1024 * 1024,
  userHistoryQuotaBytes: Math.max(1, Number(process.env.USER_HISTORY_QUOTA_MB ?? 256)) * 1024 * 1024,
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 168),
  appOrigin: process.env.APP_ORIGIN || undefined,
  production: process.env.NODE_ENV === "production",
  trustProxy: process.env.TRUST_PROXY === "true"
};

const app = Fastify({ logger: true, trustProxy: config.trustProxy, bodyLimit: 2 * 1024 * 1024 });
const db = openDatabase(config.dataDirectory);
const syncEvents = new SyncEventHub();
const sessionCookie = config.production ? "__Host-webmd_session" : "webmd_session";
const endpointCookie = config.production ? "__Host-webmd_endpoint" : "webmd_endpoint";
const REMEMBERED_COOKIE_DAYS = 400;
const REMEMBERED_COOKIE_MS = REMEMBERED_COOKIE_DAYS * 24 * 60 * 60 * 1000;

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

const authenticate: AuthGuard = async (request, reply) => {
  const rawToken = request.cookies[sessionCookie];
  if (!rawToken) {
    await reply.code(401).send({ error: "Authentication required" });
    return;
  }
  const row = db
    .prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.disabled,
        s.session_id, s.endpoint_id, s.remembered, s.created_at AS session_created_at,
        s.last_seen_at, s.expires_at, e.first_seen_at AS endpoint_first_seen_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN trusted_endpoints e ON e.endpoint_id = s.endpoint_id AND e.user_id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL
        AND e.revoked_at IS NULL
    `)
      .get(hashToken(rawToken), new Date().toISOString()) as
    | { id: string; username: string; display_name: string; role: "admin" | "user"; disabled: number; session_id: string; endpoint_id: string; remembered: number; session_created_at: string; last_seen_at: string; expires_at: string; endpoint_first_seen_at: string }
    | undefined;
  if (!row || row.disabled) {
    reply.clearCookie(sessionCookie, { path: "/" });
    await reply.code(401).send({ error: "Session is no longer valid" });
    return;
  }
  request.sessionUser = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role
  };
  const now = new Date();
  const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
  if (row.last_seen_at < minuteAgo) {
    db.transaction(() => {
      db.prepare("UPDATE sessions SET last_seen_at = ? WHERE session_id = ? AND last_seen_at < ?").run(now.toISOString(), row.session_id, minuteAgo);
      db.prepare("UPDATE trusted_endpoints SET last_seen_at = ?, ip_address = ? WHERE endpoint_id = ? AND user_id = ?").run(
        now.toISOString(), request.ip.slice(0, 100), row.endpoint_id, row.id
      );
    })();
  }
  if (row.remembered && new Date(row.expires_at).getTime() - now.getTime() < 30 * 24 * 60 * 60 * 1000) {
    const expires = new Date(now.getTime() + REMEMBERED_COOKIE_MS);
    db.prepare("UPDATE sessions SET expires_at = ? WHERE session_id = ?").run(expires.toISOString(), row.session_id);
    reply.setCookie(sessionCookie, rawToken, sessionCookieOptions(expires));
  }
  request.sessionContext = {
    id: row.session_id,
    endpointId: row.endpoint_id,
    endpointFirstSeenAt: row.endpoint_first_seen_at,
    remembered: Boolean(row.remembered),
    createdAt: row.session_created_at,
    lastSeenAt: row.last_seen_at < minuteAgo ? now.toISOString() : row.last_seen_at
  };
};

const requireAdmin: AuthGuard = async (request, reply) => {
  await authenticate(request, reply);
  if (reply.sent) return;
  if (request.sessionUser?.role !== "admin") {
    await reply.code(403).send({ error: "Administrator access required" });
  }
};

function deviceName(userAgent: string): string {
  const browser = userAgent.includes("Edg/") ? "Edge"
    : userAgent.includes("OPR/") ? "Opera"
      : userAgent.includes("Chrome/") || userAgent.includes("CriOS/") ? "Chrome"
        : userAgent.includes("Firefox/") || userAgent.includes("FxiOS/") ? "Firefox"
          : userAgent.includes("Safari/") ? "Safari"
            : "Browser";
  const platform = userAgent.includes("iPad") ? "iPad"
    : userAgent.includes("iPhone") ? "iPhone"
      : userAgent.includes("Android") ? "Android"
        : userAgent.includes("Windows") ? "Windows"
          : userAgent.includes("Macintosh") ? "macOS"
            : userAgent.includes("Linux") ? "Linux"
              : "Unknown device";
  return `${browser} · ${platform}`;
}

function sessionCookieOptions(expires?: Date) {
  return {
    path: "/",
    httpOnly: true,
    secure: config.production,
    sameSite: "strict" as const,
    ...(expires ? { expires } : {})
  };
}

function endpointSummary(endpointId: string, remembered: boolean) {
  return { id: endpointId, remembered };
}

function setSession(request: FastifyRequest, reply: FastifyReply, userId: string, remembered = false) {
  const rawToken = createSessionToken();
  const now = new Date();
  const expires = new Date(now.getTime() + (remembered ? REMEMBERED_COOKIE_MS : config.sessionTtlHours * 60 * 60 * 1000));
  const userAgent = String(request.headers["user-agent"] ?? "").slice(0, 500);
  let rawEndpoint = request.cookies[endpointCookie];
  if (!rawEndpoint || rawEndpoint.length < 32) rawEndpoint = createSessionToken();
  const endpointHash = hashToken(rawEndpoint);
  const ipAddress = request.ip.slice(0, 100);
  const currentEndpoint = db.prepare("SELECT endpoint_id FROM trusted_endpoints WHERE user_id = ? AND endpoint_hash = ?").get(
    userId, endpointHash
  ) as { endpoint_id: string } | undefined;
  const endpointId = currentEndpoint?.endpoint_id ?? randomUUID();
  db.transaction(() => {
    if (currentEndpoint) {
      db.prepare(`
        UPDATE trusted_endpoints SET device_name = ?, user_agent = ?, ip_address = ?,
          last_login_at = ?, last_seen_at = ?, login_count = login_count + 1,
          remembered = ?, revoked_at = NULL
        WHERE endpoint_id = ? AND user_id = ?
      `).run(deviceName(userAgent), userAgent, ipAddress, now.toISOString(), now.toISOString(), remembered ? 1 : 0, endpointId, userId);
    } else {
      db.prepare(`
        INSERT INTO trusted_endpoints (
          endpoint_id, user_id, endpoint_hash, device_name, user_agent, ip_address,
          first_seen_at, last_login_at, last_seen_at, remembered
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(endpointId, userId, endpointHash, deviceName(userAgent), userAgent, ipAddress, now.toISOString(), now.toISOString(), now.toISOString(), remembered ? 1 : 0);
    }
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND endpoint_id = ? AND revoked_at IS NULL").run(now.toISOString(), userId, endpointId);
    db.prepare(`
      INSERT INTO sessions (
        token_hash, session_id, user_id, endpoint_id, remembered, device_name, user_agent,
        ip_address, created_at, last_seen_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(hashToken(rawToken), randomUUID(), userId, endpointId, remembered ? 1 : 0, deviceName(userAgent), userAgent, ipAddress, now.toISOString(), now.toISOString(), expires.toISOString());
  })();
  syncEvents.closeEndpoint(userId, endpointId);
  reply.setCookie(endpointCookie, rawEndpoint, {
    path: "/",
    httpOnly: true,
    secure: config.production,
    sameSite: "strict",
    expires: new Date(now.getTime() + REMEMBERED_COOKIE_MS)
  });
  reply.setCookie(sessionCookie, rawToken, sessionCookieOptions(remembered ? expires : undefined));
  return endpointSummary(endpointId, remembered);
}

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

const syncClientHeader = z.string().uuid().optional();

app.get("/api/sync/events", { preHandler: authenticate }, async (request, reply) => {
  const parsed = z.object({
    since: z.coerce.number().int().nonnegative().default(0),
    clientId: z.string().uuid()
  }).safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid synchronization event request" });
  const user = request.sessionUser as SessionUser;
  const session = request.sessionContext!;

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "private, no-cache, no-store",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  reply.raw.write("retry: 5000\n\n");
  const unsubscribe = syncEvents.subscribe({
    userId: user.id,
    sessionId: session.id,
    endpointId: session.endpointId,
    clientId: parsed.data.clientId,
    response: reply.raw
  });
  const latest = Number((db.prepare("SELECT COALESCE(MAX(sequence), 0) AS cursor FROM changes WHERE user_id = ?").get(user.id) as { cursor: number }).cursor);
  if (latest > parsed.data.since) {
    reply.raw.write(`event: changed\ndata: ${JSON.stringify({ cursor: latest })}\n\n`);
  }
  const heartbeat = setInterval(() => {
    const active = db.prepare(`
      SELECT 1
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.session_id = ? AND s.user_id = ? AND s.revoked_at IS NULL
        AND s.expires_at > ? AND u.disabled = 0
    `).get(session.id, user.id, new Date().toISOString());
    if (!active || reply.raw.destroyed || reply.raw.writableEnded) {
      clearInterval(heartbeat);
      unsubscribe();
      if (!reply.raw.writableEnded) reply.raw.end();
      return;
    }
    reply.raw.write(": keep-alive\n\n");
  }, 25_000);
  heartbeat.unref();
  request.raw.once("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  return reply;
});

app.get("/api/sync", { preHandler: authenticate }, async (request) => {
  const user = request.sessionUser as SessionUser;
  const query = request.query as { since?: string; limit?: string; compact?: string };
  const since = Math.max(0, Number(query.since ?? 0));
  const limit = Math.min(500, Math.max(1, Number(query.limit ?? 200)));
  const rows = db.prepare(`
    SELECT c.sequence, c.object_id, c.change_type, c.created_at AS change_created_at,
      r.object_type, r.ciphertext, r.nonce, r.encryption_version, r.revision, r.deleted
    FROM changes c
    LEFT JOIN object_revisions r
      ON r.user_id = c.user_id AND r.object_id = c.object_id AND r.revision = c.revision
    WHERE c.user_id = ? AND c.sequence > ?
    ORDER BY c.sequence ASC
    LIMIT ?
  `).all(user.id, since, limit) as any[];
  const responseRows = query.compact === "1"
    ? [...new Map(rows.map((row) => [row.object_id, row])).values()].sort((left, right) => left.sequence - right.sequence)
    : rows;
  return {
    changes: responseRows.map((row) => ({
      sequence: row.sequence,
      objectId: row.object_id,
      objectType: row.object_type ?? "note",
      ciphertext: row.ciphertext ?? "",
      nonce: row.nonce ?? "",
      encryptionVersion: row.encryption_version ?? 1,
      revision: row.revision ?? 0,
      deleted: Boolean(row.deleted),
      purged: row.change_type === "purge",
      serverUpdatedAt: row.change_created_at
    })),
    cursor: rows.length ? rows[rows.length - 1].sequence : since,
    hasMore: rows.length === limit
  };
});

const objectSchema = z.object({
  objectType: z.enum(["note", "folder", "attachment"]),
  ciphertext: envelopeField,
  nonce: z.string().min(16).max(200),
  encryptionVersion: z.number().int().positive(),
  baseRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().uuid(),
  deleted: z.boolean().default(false)
});

type ObjectWrite = z.infer<typeof objectSchema>;
type ObjectWriteResult =
  | { objectId: string; status: "accepted"; revision: number; sequence: number }
  | { objectId: string; status: "idempotent"; revision: number }
  | { objectId: string; status: "conflict"; currentRevision: number; reason: "revision" | "objectType" };

function writeObject(userId: string, objectId: string, body: ObjectWrite): ObjectWriteResult {
  const priorIdempotent = db.prepare("SELECT object_id, revision FROM object_revisions WHERE user_id = ? AND idempotency_key = ?")
    .get(userId, body.idempotencyKey) as { object_id: string; revision: number } | undefined;
  if (priorIdempotent) {
    return { objectId: priorIdempotent.object_id, status: "idempotent", revision: priorIdempotent.revision };
  }
  const current = db.prepare("SELECT revision, object_type FROM objects WHERE user_id = ? AND object_id = ?")
    .get(userId, objectId) as { revision: number; object_type: string } | undefined;
  if (current && current.object_type !== body.objectType) {
    return { objectId, status: "conflict", currentRevision: current.revision, reason: "objectType" };
  }
  const currentRevision = current?.revision ?? 0;
  if (currentRevision !== body.baseRevision) {
    return { objectId, status: "conflict", currentRevision, reason: "revision" };
  }
  const revision = currentRevision + 1;
  const now = new Date().toISOString();
  const sequence = db.transaction(() => {
    db.prepare(`
      INSERT INTO object_revisions (
        user_id, object_id, object_type, ciphertext, nonce, encryption_version,
        revision, deleted, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, objectId, body.objectType, body.ciphertext, body.nonce, body.encryptionVersion, revision, body.deleted ? 1 : 0, body.idempotencyKey, now);
    db.prepare(`
      INSERT INTO objects (user_id, object_id, object_type, ciphertext, nonce, encryption_version, revision, deleted, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, object_id) DO UPDATE SET
        object_type = excluded.object_type,
        ciphertext = excluded.ciphertext,
        nonce = excluded.nonce,
        encryption_version = excluded.encryption_version,
        revision = excluded.revision,
        deleted = excluded.deleted,
        updated_at = excluded.updated_at
    `).run(userId, objectId, body.objectType, body.ciphertext, body.nonce, body.encryptionVersion, revision, body.deleted ? 1 : 0, now);
    return Number(db.prepare("INSERT INTO changes (user_id, object_id, revision, change_type, created_at) VALUES (?, ?, ?, 'upsert', ?)")
      .run(userId, objectId, revision, now).lastInsertRowid);
  })();
  return { objectId, status: "accepted", revision, sequence };
}

app.put("/api/objects/:objectId", { preHandler: authenticate }, async (request, reply) => {
  const user = request.sessionUser as SessionUser;
  const objectId = z.string().uuid().safeParse((request.params as { objectId: string }).objectId);
  const parsed = objectSchema.safeParse(request.body);
  if (!objectId.success || !parsed.success) return reply.code(400).send({ error: "Invalid encrypted object" });
  const result = writeObject(user.id, objectId.data, parsed.data);
  if (result.status === "conflict") {
    return reply.code(409).send({
      error: result.reason === "objectType" ? "Object type cannot change" : "Revision conflict",
      currentRevision: result.currentRevision
    });
  }
  const sourceClientId = syncClientHeader.safeParse(request.headers["x-webmd-sync-client"]);
  if (result.status === "accepted") syncEvents.publish(user.id, result.sequence, sourceClientId.success ? sourceClientId.data : undefined);
  return {
    objectId: result.objectId,
    revision: result.revision,
    ...(result.status === "idempotent" ? { idempotent: true } : { sequence: result.sequence })
  };
});

const objectBatchSchema = z.object({
  objects: z.array(objectSchema.extend({ objectId: z.string().uuid() })).min(1).max(50)
}).superRefine(({ objects }, context) => {
  const seen = new Set<string>();
  objects.forEach((object, index) => {
    if (seen.has(object.objectId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate object ID", path: ["objects", index, "objectId"] });
    }
    seen.add(object.objectId);
  });
});

app.post("/api/objects/batch", { preHandler: authenticate }, async (request, reply) => {
  const parsed = objectBatchSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid encrypted object batch" });
  const user = request.sessionUser as SessionUser;
  const results = parsed.data.objects.map(({ objectId, ...body }) => writeObject(user.id, objectId, body));
  const cursor = results.reduce((latest, result) => result.status === "accepted" ? Math.max(latest, result.sequence) : latest, 0);
  const sourceClientId = syncClientHeader.safeParse(request.headers["x-webmd-sync-client"]);
  if (cursor) syncEvents.publish(user.id, cursor, sourceClientId.success ? sourceClientId.data : undefined);
  return { results };
});

app.post("/api/objects/purge", { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
  const parsed = z.object({
    objects: z.array(z.object({ objectId: z.string().uuid(), baseRevision: z.number().int().positive() })).min(1).max(1000)
  }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid purge request" });
  const user = request.sessionUser as SessionUser;
  try {
    const changes = purgeTargets(db, user.id, parsed.data.objects);
    const cursor = changes.reduce((latest, change) => Math.max(latest, change.cursor), 0);
    const sourceClientId = syncClientHeader.safeParse(request.headers["x-webmd-sync-client"]);
    if (cursor) syncEvents.publish(user.id, cursor, sourceClientId.success ? sourceClientId.data : undefined);
  } catch (error) {
    if (error instanceof Error && error.message === "PURGE_CONFLICT") return reply.code(409).send({ error: "Purge conflict" });
    throw error;
  }
  return { ok: true };
});

const chunkHeaderSchema = z.object({
  "x-webmd-nonce": z.string().min(16).max(200),
  "x-webmd-total-chunks": z.coerce.number().int().min(1).max(Math.ceil(config.maxAttachmentBytes / (1024 * 1024))),
  "x-webmd-encryption-version": z.coerce.number().int().positive(),
  "x-webmd-idempotency-key": z.string().uuid()
});

app.put("/api/attachments/:attachmentId/chunks/:index", { preHandler: authenticate }, async (request, reply) => {
  const params = z.object({ attachmentId: z.string().uuid(), index: z.coerce.number().int().min(0).max(999) }).safeParse(request.params);
  const headers = chunkHeaderSchema.safeParse(request.headers);
  const body = request.body;
  if (!params.success || !headers.success || !Buffer.isBuffer(body)) return reply.code(400).send({ error: "Invalid encrypted attachment chunk" });
  if (body.byteLength > 1024 * 1024 + 64) return reply.code(413).send({ error: "Attachment chunk is too large" });
  const user = request.sessionUser as SessionUser;
  const prior = db.prepare("SELECT attachment_id, chunk_index FROM attachment_chunks WHERE user_id = ? AND idempotency_key = ?").get(user.id, headers.data["x-webmd-idempotency-key"]);
  if (prior) return { ok: true, idempotent: true };
  const existing = db.prepare("SELECT 1 FROM attachment_chunks WHERE user_id = ? AND attachment_id = ? AND chunk_index = ?").get(user.id, params.data.attachmentId, params.data.index);
  if (existing) return reply.code(409).send({ error: "Attachment chunk already exists" });
  const used = Number((db.prepare("SELECT COALESCE(SUM(LENGTH(ciphertext)), 0) AS bytes FROM attachment_chunks WHERE user_id = ?").get(user.id) as { bytes: number }).bytes);
  if (used + body.byteLength > config.userStorageQuotaBytes) return reply.code(413).send({ error: "User storage quota exceeded" });
  db.prepare(`
    INSERT INTO attachment_chunks (user_id, attachment_id, chunk_index, total_chunks, ciphertext, nonce, encryption_version, idempotency_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id, params.data.attachmentId, params.data.index, headers.data["x-webmd-total-chunks"], body,
    headers.data["x-webmd-nonce"], headers.data["x-webmd-encryption-version"], headers.data["x-webmd-idempotency-key"], new Date().toISOString()
  );
  return { ok: true };
});

app.get("/api/attachments/:attachmentId/chunks/:index", { preHandler: authenticate }, async (request, reply) => {
  const params = z.object({ attachmentId: z.string().uuid(), index: z.coerce.number().int().min(0).max(999) }).safeParse(request.params);
  if (!params.success) return reply.code(404).send({ error: "Attachment chunk not found" });
  const user = request.sessionUser as SessionUser;
  const row = db.prepare(`
    SELECT ciphertext, nonce, total_chunks, encryption_version FROM attachment_chunks
    WHERE user_id = ? AND attachment_id = ? AND chunk_index = ?
  `).get(user.id, params.data.attachmentId, params.data.index) as { ciphertext: Buffer; nonce: string; total_chunks: number; encryption_version: number } | undefined;
  if (!row) return reply.code(404).send({ error: "Attachment chunk not found" });
  reply.header("Content-Type", "application/octet-stream");
  reply.header("Cache-Control", "private, no-store");
  reply.header("X-WebMD-Nonce", row.nonce);
  reply.header("X-WebMD-Total-Chunks", String(row.total_chunks));
  reply.header("X-WebMD-Encryption-Version", String(row.encryption_version));
  return reply.send(row.ciphertext);
});

app.get("/api/admin/users", { preHandler: requireAdmin }, async () => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.disabled, u.created_at,
      COALESCE(ob.object_count, 0) AS object_count,
      COALESCE(ob.object_bytes, 0) + COALESCE(ac.attachment_bytes, 0)
        + COALESCE(nh.history_bytes, 0) + COALESCE(pa.avatar_bytes, 0) AS encrypted_bytes
    FROM users u
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS object_count, SUM(LENGTH(ciphertext)) AS object_bytes FROM objects GROUP BY user_id
    ) ob ON ob.user_id = u.id
    LEFT JOIN (
      SELECT user_id, SUM(LENGTH(ciphertext)) AS attachment_bytes FROM attachment_chunks GROUP BY user_id
    ) ac ON ac.user_id = u.id
    LEFT JOIN (
      SELECT user_id, SUM(byte_size) AS history_bytes FROM note_history GROUP BY user_id
    ) nh ON nh.user_id = u.id
    LEFT JOIN (
      SELECT user_id, LENGTH(ciphertext) AS avatar_bytes FROM profile_assets
    ) pa ON pa.user_id = u.id
    ORDER BY u.created_at ASC
  `).all() as any[];
  const setups = db.prepare("SELECT id, username, display_name, created_at, expires_at FROM account_setups ORDER BY created_at ASC").all() as any[];
  return {
    users: users.map((row) => ({ id: row.id, username: row.username, displayName: row.display_name, role: row.role, disabled: Boolean(row.disabled), createdAt: row.created_at, objectCount: row.object_count, encryptedBytes: row.encrypted_bytes })),
    setups: setups.map((row) => ({ id: row.id, username: row.username, displayName: row.display_name, createdAt: row.created_at, expiresAt: row.expires_at }))
  };
});

app.post("/api/admin/account-setups", { preHandler: requireAdmin }, async (request, reply) => {
  const parsed = z.object({ username: usernameField, displayName: z.string().trim().min(1).max(80), expiresInHours: z.number().int().min(1).max(720).default(72) }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid user setup" });
  db.prepare("DELETE FROM account_setups WHERE expires_at <= ?").run(new Date().toISOString());
  if (db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(parsed.data.username)
    || db.prepare("SELECT 1 FROM account_setups WHERE username = ? COLLATE NOCASE").get(parsed.data.username)) {
    return reply.code(409).send({ error: "Username is unavailable" });
  }
  const id = randomUUID();
  const code = createSessionToken();
  const now = new Date();
  const expires = new Date(now.getTime() + parsed.data.expiresInHours * 60 * 60 * 1000);
  db.prepare(`
    INSERT INTO account_setups (id, username, display_name, code_hash, created_by, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, parsed.data.username, parsed.data.displayName, hashToken(code), request.sessionUser?.id, now.toISOString(), expires.toISOString());
  return reply.code(201).send({ id, username: parsed.data.username, displayName: parsed.data.displayName, activationCode: code, expiresAt: expires.toISOString() });
});

app.delete("/api/admin/account-setups/:setupId", { preHandler: requireAdmin }, async (request, reply) => {
  const setupId = z.string().uuid().safeParse((request.params as { setupId: string }).setupId);
  if (!setupId.success) return reply.code(404).send({ error: "Account setup not found" });
  const result = db.prepare("DELETE FROM account_setups WHERE id = ?").run(setupId.data);
  if (!result.changes) return reply.code(404).send({ error: "Account setup not found" });
  return { ok: true };
});

app.patch("/api/admin/users/:userId", { preHandler: requireAdmin }, async (request, reply) => {
  const targetId = z.string().uuid().safeParse((request.params as { userId: string }).userId);
  const body = z.object({ disabled: z.boolean() }).safeParse(request.body);
  if (!targetId.success || !body.success) return reply.code(400).send({ error: "Invalid user update" });
  if (targetId.data === request.sessionUser?.id && body.data.disabled) return reply.code(400).send({ error: "You cannot disable your own account" });
  const result = db.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(body.data.disabled ? 1 : 0, targetId.data);
  if (!result.changes) return reply.code(404).send({ error: "User not found" });
  if (body.data.disabled) {
    const revokedAt = new Date().toISOString();
    db.transaction(() => {
      db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(revokedAt, targetId.data);
      db.prepare("UPDATE trusted_endpoints SET remembered = 0, revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(revokedAt, targetId.data);
    })();
    syncEvents.closeUser(targetId.data);
  }
  return { ok: true };
});

app.delete("/api/admin/users/:userId", { preHandler: requireAdmin }, async (request, reply) => {
  const targetId = z.string().uuid().safeParse((request.params as { userId: string }).userId);
  const body = z.object({ currentAuthSecret: secretField, confirmationUsername: usernameField }).safeParse(request.body);
  if (!targetId.success || !body.success) return reply.code(400).send({ error: "Invalid user deletion" });
  const administrator = request.sessionUser as SessionUser;
  if (targetId.data === administrator.id) return reply.code(400).send({ error: "You cannot delete your own account" });
  const adminAuth = db.prepare("SELECT auth_salt, auth_hash FROM users WHERE id = ?").get(administrator.id) as { auth_salt: string; auth_hash: string } | undefined;
  if (!adminAuth || !verifyOpaqueSecret(body.data.currentAuthSecret, adminAuth.auth_salt, adminAuth.auth_hash)) {
    return reply.code(401).send({ error: "Current password is incorrect" });
  }
  const target = db.prepare("SELECT username, role FROM users WHERE id = ?").get(targetId.data) as { username: string; role: string } | undefined;
  if (!target) return reply.code(404).send({ error: "User not found" });
  if (target.username !== body.data.confirmationUsername) return reply.code(400).send({ error: "Username confirmation does not match" });
  if (target.role === "admin") {
    const administrators = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get() as { count: number };
    if (administrators.count <= 1) return reply.code(400).send({ error: "The last administrator cannot be deleted" });
  }
  db.transaction(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(targetId.data);
  })();
  syncEvents.closeUser(targetId.data);
  return { ok: true };
});

const webRoot = resolve("dist");
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot, wildcard: false });
  app.get("/*", async (_request, reply) => reply.sendFile("index.html"));
}

purgeExpiredTrash(db);
cleanupAllHistory(db);
const trashCleanupTimer = setInterval(() => {
  try {
    const purged = purgeExpiredTrash(db, new Date().toISOString(), (changes) => {
      const latestByUser = new Map<string, number>();
      for (const change of changes) latestByUser.set(change.userId, Math.max(latestByUser.get(change.userId) ?? 0, change.cursor));
      for (const [userId, cursor] of latestByUser) syncEvents.publish(userId, cursor);
    });
    if (purged) app.log.info({ purged }, "expired trash purged");
  } catch (error) {
    app.log.error(error, "trash retention cleanup failed");
  }
}, 60 * 60 * 1000);
trashCleanupTimer.unref();

const historyCleanupTimer = setInterval(() => {
  try {
    const deleted = cleanupAllHistory(db);
    if (deleted) app.log.info({ deleted }, "expired note history cleaned");
  } catch (error) {
    app.log.error(error, "note history cleanup failed");
  }
}, 60 * 60 * 1000);
historyCleanupTimer.unref();

app.addHook("onClose", async () => {
  clearInterval(trashCleanupTimer);
  clearInterval(historyCleanupTimer);
  syncEvents.closeAll();
  db.close();
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
