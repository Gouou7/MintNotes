import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDatabase } from "../database.js";
import type { ServerConfig } from "../config.js";
import { hashToken } from "../security.js";
import { authenticatedScope, applicationObjectScope, type AuthGuard } from "../types.js";
import { LogReferenceFactory, logEvent } from "../logging.js";
import { registerSyncRoutes } from "../sync/routes.js";
import { registerAttachmentRoutes } from "../attachments/routes.js";
import { registerHistoryRoutes } from "../history/routes.js";
import type { SyncEventHub } from "../syncEvents.js";
import { applicationBootstrap, applicationSummary, revokeApplicationConnections, verifyApplicationSecret, type ApplicationRow } from "./service.js";

const policySchema = z.object({
  name: z.string().trim().min(1).max(80),
  idleTimeoutDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.null()]),
  expiresAt: z.string().datetime({ offset: true }).nullable()
}).strict();
const createSchema = policySchema.extend({
  connectionId: z.string().uuid().transform((value) => value.toLowerCase()),
  access: z.enum(["read", "read-write"]),
  authSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  vaultEnvelope: z.object({ version: z.literal(1), ciphertext: z.string().regex(/^[A-Za-z0-9_-]{64}$/), nonce: z.string().regex(/^[A-Za-z0-9_-]{16}$/) }).strict()
}).strict();

export function registerApplicationRoutes(app: FastifyInstance, dependencies: {
  db: AppDatabase; config: ServerConfig; authenticate: AuthGuard; logRefs: LogReferenceFactory; syncEvents: SyncEventHub;
}): void {
  const { db, authenticate, logRefs } = dependencies;
  const prefix = "/api/account/application-connections";
  app.get(prefix, { preHandler: authenticate }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { userId } = authenticatedScope(request);
    const rows = db.prepare("SELECT * FROM application_connections WHERE user_id = ? ORDER BY created_at DESC").all(userId) as ApplicationRow[];
    return { connections: rows.map((row) => applicationSummary(row)) };
  });
  app.post(prefix, { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid application connection", code: "APPLICATION_INVALID_POLICY" });
    const { userId } = authenticatedScope(request);
    const body = parsed.data;
    const prior = db.prepare("SELECT * FROM application_connections WHERE connection_id = ?").get(body.connectionId) as ApplicationRow | undefined;
    if (prior) {
      const matches = prior.user_id === userId && verifyApplicationSecret(body.authSecret, prior.auth_hash)
        && prior.envelope_ciphertext === body.vaultEnvelope.ciphertext && prior.envelope_nonce === body.vaultEnvelope.nonce
        && prior.name === body.name && prior.access === body.access && prior.idle_timeout_days === body.idleTimeoutDays
        && prior.expires_at === body.expiresAt && applicationSummary(prior).status === "active";
      if (!matches) return reply.code(409).send({ error: "Application connection cannot be reused", code: "APPLICATION_CREATE_CONFLICT" });
      return { connection: applicationSummary(prior), idempotent: true };
    }
    if (body.expiresAt && Date.parse(body.expiresAt) <= Date.now()) return reply.code(400).send({ error: "Application expiry must be in the future" });
    const active = (db.prepare("SELECT * FROM application_connections WHERE user_id = ? AND revoked_at IS NULL").all(userId) as ApplicationRow[])
      .filter((row) => applicationSummary(row).status === "active").length;
    if (active >= 50) return reply.code(409).send({ error: "Too many active application connections", code: "APPLICATION_LIMIT" });
    db.prepare(`INSERT INTO application_connections
      (connection_id, user_id, name, access, auth_hash, envelope_ciphertext, envelope_nonce, created_at, idle_timeout_days, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(body.connectionId, userId, body.name, body.access, hashToken(body.authSecret),
        body.vaultEnvelope.ciphertext, body.vaultEnvelope.nonce, new Date().toISOString(), body.idleTimeoutDays, body.expiresAt);
    logEvent(request.log, "info", "application.created", { actorRef: logRefs.create("user", userId) });
    const row = db.prepare("SELECT * FROM application_connections WHERE connection_id = ?").get(body.connectionId) as ApplicationRow;
    return reply.code(201).send({ connection: applicationSummary(row) });
  });
  app.patch(`${prefix}/:id`, { preHandler: authenticate }, async (request, reply) => {
    const id = z.string().uuid().safeParse((request.params as { id: string }).id);
    const parsed = policySchema.safeParse(request.body);
    if (!id.success || !parsed.success) return reply.code(400).send({ error: "Invalid application policy" });
    const { userId } = authenticatedScope(request);
    const row = db.prepare("SELECT * FROM application_connections WHERE connection_id = ? AND user_id = ?").get(id.data, userId) as ApplicationRow | undefined;
    if (!row) return reply.code(404).send({ error: "Application connection not found" });
    if (applicationSummary(row).status !== "active") return reply.code(409).send({ error: "Inactive application cannot be renewed", code: "APPLICATION_INACTIVE" });
    if (parsed.data.expiresAt && Date.parse(parsed.data.expiresAt) <= Date.now()) return reply.code(400).send({ error: "Application expiry must be in the future" });
    db.prepare("UPDATE application_connections SET name = ?, idle_timeout_days = ?, expires_at = ? WHERE connection_id = ? AND user_id = ?")
      .run(parsed.data.name, parsed.data.idleTimeoutDays, parsed.data.expiresAt, id.data, userId);
    return { connection: applicationSummary({ ...row, name: parsed.data.name, idle_timeout_days: parsed.data.idleTimeoutDays, expires_at: parsed.data.expiresAt }) };
  });
  app.delete(`${prefix}/:id`, { preHandler: authenticate }, async (request, reply) => {
    const id = z.string().uuid().safeParse((request.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: "Invalid connection ID" });
    const { userId } = authenticatedScope(request);
    const result = db.prepare("UPDATE application_connections SET revoked_at = COALESCE(revoked_at, ?) WHERE connection_id = ? AND user_id = ?")
      .run(new Date().toISOString(), id.data, userId);
    if (!result.changes) return reply.code(404).send({ error: "Application connection not found" });
    logEvent(request.log, "info", "application.revoked", { actorRef: logRefs.create("user", userId) });
    return { ok: true };
  });
  app.post(`${prefix}/revoke-all`, { preHandler: authenticate }, async (request) => {
    const { userId } = authenticatedScope(request);
    revokeApplicationConnections(db, userId);
    logEvent(request.log, "info", "application.revoked", { actorRef: logRefs.create("user", userId) });
    return { ok: true };
  });

  const authenticateApplication: AuthGuard = async (request, reply) => {
    const match = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? "");
    const row = match ? db.prepare(`SELECT a.*, u.disabled FROM application_connections a JOIN users u ON u.id = a.user_id WHERE a.connection_id = ?`)
      .get(match[1]) as (ApplicationRow & { disabled: number }) | undefined : undefined;
    if (!row || !match || !verifyApplicationSecret(match[2], row.auth_hash) || row.disabled) {
      return void reply.code(401).send({ error: "Invalid application credential", code: "APPLICATION_INVALID" });
    }
    const connection = applicationSummary(row);
    if (connection.status !== "active") return void reply.code(401).send({ error: "Application connection is inactive", code: connection.status === "revoked" ? "APPLICATION_REVOKED" : "APPLICATION_EXPIRED" });
    if (!["GET", "HEAD"].includes(request.method) && row.access !== "read-write") {
      return void reply.code(403).send({ error: "Application is read-only", code: "APPLICATION_READ_ONLY" });
    }
    request.applicationPrincipal = { userId: row.user_id, connectionId: row.connection_id, access: row.access };
  };

  void app.register(async (native) => {
    native.addHook("onRoute", (route) => { route.config = { ...route.config, applicationAuth: true }; });
    native.addHook("onRequest", authenticateApplication);
    native.addHook("onSend", async (request, reply, payload) => {
      if (reply.statusCode < 400 && request.applicationPrincipal && request.routeOptions.url !== "/api/apps/v1/connection") {
        db.prepare("UPDATE application_connections SET last_used_at = ? WHERE connection_id = ? AND revoked_at IS NULL")
          .run(new Date().toISOString(), request.applicationPrincipal.connectionId);
      }
      return payload;
    });
    native.get("/api/apps/v1/connection", { preHandler: authenticateApplication }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const row = db.prepare("SELECT * FROM application_connections WHERE connection_id = ?").get(request.applicationPrincipal!.connectionId) as ApplicationRow;
      return applicationBootstrap(db, row);
    });
    const dataDependencies = { ...dependencies, authenticate: authenticateApplication, apiPrefix: "/api/apps/v1", scope: applicationObjectScope, applicationOnly: true };
    registerSyncRoutes(native, dataDependencies);
    registerAttachmentRoutes(native, dataDependencies);
    registerHistoryRoutes(native, dataDependencies);
  });
}
