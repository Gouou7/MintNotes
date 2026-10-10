import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerConfig } from "../config.js";
import type { AppDatabase } from "../database.js";
import { SyncEventHub } from "../syncEvents.js";
import { purgeTargets } from "../trash.js";
import { authenticatedScope, type ScopeResolver, type AuthGuard, type SessionUser } from "../types.js";
import { objectBatchSchema, objectSchema, StorageQuotaError, writeObject } from "./objectStore.js";
import { LogReferenceFactory, logEvent } from "../logging.js";

export function registerSyncRoutes(
  app: FastifyInstance,
  dependencies: {
    db: AppDatabase;
    syncEvents: SyncEventHub;
    authenticate: AuthGuard;
    apiPrefix?: string;
    scope?: ScopeResolver;
    applicationOnly?: boolean;
    config: ServerConfig;
    logRefs: LogReferenceFactory;
  }
) {
  const { db, syncEvents, authenticate, config, logRefs } = dependencies;
  const apiPrefix = dependencies.apiPrefix ?? "/api";
  const getScope = dependencies.scope ?? authenticatedScope;
  const applicationOnly = dependencies.applicationOnly ?? false;
  const syncClientHeader = z.string().uuid().optional();

  if (!applicationOnly) app.get(`${apiPrefix}/sync/events`, { preHandler: authenticate, compress: false }, async (request, reply) => {
    const parsed = z.object({
      since: z.coerce.number().int().nonnegative().default(0),
      clientId: z.string().uuid()
    }).safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid synchronization event request" });
    }
    const user = request.sessionUser as SessionUser;
    const session = request.sessionContext!;
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-cache, no-store",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Request-ID": request.id
    });
    reply.raw.write("retry: 5000\n\n");
    const unsubscribe = syncEvents.subscribe({
      userId: user.id,
      sessionId: session.id,
      endpointId: session.endpointId,
      clientId: parsed.data.clientId,
      response: reply.raw
    });
    const latest = Number((db.prepare(
      "SELECT COALESCE(MAX(sequence), 0) AS cursor FROM changes WHERE user_id = ?"
    ).get(user.id) as { cursor: number }).cursor);
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

  app.get(`${apiPrefix}/sync`, { preHandler: authenticate }, async (request) => {
    const scope = getScope(request);
    const query = request.query as { since?: string; limit?: string; compact?: string };
    const since = Math.max(0, Number(query.since ?? 0));
    const limit = Math.min(500, Math.max(1, Number(query.limit ?? 200)));
    const latestCursor = Number((db.prepare(
      "SELECT COALESCE(MAX(sequence), 0) AS cursor FROM changes WHERE user_id = ?"
    ).get(scope.userId) as { cursor: number }).cursor);
    if (since > latestCursor) {
      return { changes: [], cursor: 0, hasMore: true, reset: true };
    }
    const rows = db.prepare(`
      SELECT c.sequence, c.object_id, c.change_type, c.created_at AS change_created_at,
        r.object_type, r.ciphertext, r.nonce, r.encryption_version, r.revision, r.deleted
      FROM changes c
      LEFT JOIN object_revisions r
        ON r.user_id = c.user_id AND r.object_id = c.object_id AND r.revision = c.revision
      WHERE c.user_id = ? AND c.sequence > ?
      ORDER BY c.sequence ASC
      LIMIT ?
    `).all(scope.userId, since, limit) as any[];
    const responseRows = query.compact === "1"
      ? [...new Map(rows.map((row) => [row.object_id, row])).values()]
        .sort((left, right) => left.sequence - right.sequence)
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

  app.get(`${apiPrefix}/objects/:objectId`, { preHandler: authenticate }, async (request, reply) => {
    const id = z.string().uuid().safeParse((request.params as { objectId: string }).objectId);
    if (!id.success) return reply.code(400).send({ error: "Invalid object ID" });
    const row = db.prepare(`SELECT object_id, object_type, ciphertext, nonce, encryption_version, revision, deleted
      FROM objects WHERE user_id = ? AND object_id = ?`).get(getScope(request).userId, id.data) as {
        object_id: string; object_type: string; ciphertext: string; nonce: string; encryption_version: number; revision: number; deleted: number;
      } | undefined;
    if (!row) return reply.code(404).send({ error: "Object not found" });
    return { objectId: row.object_id, objectType: row.object_type, ciphertext: row.ciphertext, nonce: row.nonce,
      encryptionVersion: row.encryption_version, revision: row.revision, deleted: Boolean(row.deleted) };
  });

  app.put(`${apiPrefix}/objects/:objectId`, { preHandler: authenticate }, async (request, reply) => {
    const scope = getScope(request);
    const objectId = z.string().uuid().safeParse(
      (request.params as { objectId: string }).objectId
    );
    const parsed = objectSchema.safeParse(request.body);
    if (!objectId.success || !parsed.success) {
      return reply.code(400).send({ error: "Invalid encrypted object" });
    }
    let result;
    try {
      result = writeObject(db, scope, objectId.data, parsed.data, config.userStorageQuotaBytes);
    } catch (error) {
      if (error instanceof StorageQuotaError) {
        logEvent(request.log, "warn", "storage.quota_rejected", {
          actorRef: logRefs.create("user", scope.userId),
          resource: "objects"
        });
        return reply.code(413).send({ error: error.message });
      }
      throw error;
    }
    if (result.status === "conflict") {
      logEvent(request.log, "warn", "sync.object_conflict", {
        actorRef: logRefs.create("user", scope.userId),
        objectRef: logRefs.create("object", objectId.data),
        reason: result.reason
      });
      return reply.code(409).send({
        error: result.reason === "objectType" ? "Object type cannot change"
          : result.reason === "idempotency" ? "Idempotency key payload mismatch"
          : "Revision conflict",
        currentRevision: result.currentRevision
      });
    }
    const sourceClientId = syncClientHeader.safeParse(request.headers["x-webmd-sync-client"]);
    if (result.status === "accepted") {
      syncEvents.publish(
        scope.userId,
        result.sequence,
        sourceClientId.success ? sourceClientId.data : undefined
      );
    }
    return {
      objectId: result.objectId,
      revision: result.revision,
      ...(result.status === "idempotent" ? { idempotent: true } : { sequence: result.sequence })
    };
  });

  app.post(`${apiPrefix}/objects/batch`, { preHandler: authenticate }, async (request, reply) => {
    const parsed = objectBatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid encrypted object batch" });
    }
    const scope = getScope(request);
    let results;
    try {
      results = parsed.data.objects.map(({ objectId, ...body }) => (
        writeObject(db, scope, objectId, body, config.userStorageQuotaBytes)
      ));
    } catch (error) {
      if (error instanceof StorageQuotaError) {
        logEvent(request.log, "warn", "storage.quota_rejected", {
          actorRef: logRefs.create("user", scope.userId),
          resource: "objects"
        });
        return reply.code(413).send({ error: error.message });
      }
      throw error;
    }
    const cursor = results.reduce(
      (latest, result) => result.status === "accepted"
        ? Math.max(latest, result.sequence)
        : latest,
      0
    );
    const sourceClientId = syncClientHeader.safeParse(request.headers["x-webmd-sync-client"]);
    if (cursor) {
      syncEvents.publish(
        scope.userId,
        cursor,
        sourceClientId.success ? sourceClientId.data : undefined
      );
    }
    const accepted = results.filter((result) => result.status === "accepted").length;
    const idempotent = results.filter((result) => result.status === "idempotent").length;
    const conflicts = results.filter((result) => result.status === "conflict").length;
    logEvent(request.log, conflicts ? "warn" : "debug", "sync.batch_completed", {
      actorRef: logRefs.create("user", scope.userId),
      count: results.length,
      accepted,
      idempotent,
      conflicts
    });
    return { results };
  });

  if (!applicationOnly) app.post(
    `${apiPrefix}/objects/purge`,
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } }
    },
    async (request, reply) => {
      const parsed = z.object({
        objects: z.array(z.object({
          objectId: z.string().uuid(),
          baseRevision: z.number().int().positive()
        })).min(1).max(20_000)
      }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid purge request" });
      const scope = getScope(request);
      try {
        const changes = purgeTargets(db, scope.userId, parsed.data.objects);
        const cursor = changes.reduce(
          (latest, change) => Math.max(latest, change.cursor),
          0
        );
        const sourceClientId = syncClientHeader.safeParse(
          request.headers["x-webmd-sync-client"]
        );
        if (cursor) {
          syncEvents.publish(
            scope.userId,
            cursor,
            sourceClientId.success ? sourceClientId.data : undefined
          );
        }
        logEvent(request.log, "info", "sync.purge_completed", {
          actorRef: logRefs.create("user", scope.userId),
          count: changes.length
        });
      } catch (error) {
        if (error instanceof Error && error.message === "PURGE_CONFLICT") {
          logEvent(request.log, "warn", "sync.purge_blocked", {
            actorRef: logRefs.create("user", scope.userId),
            count: parsed.data.objects.length,
            reason: "conflict"
          });
          return reply.code(409).send({ error: "Purge conflict" });
        }
        if (error instanceof Error && error.message === "PROTECTED_HISTORY") {
          logEvent(request.log, "warn", "sync.purge_blocked", {
            actorRef: logRefs.create("user", scope.userId),
            count: parsed.data.objects.length,
            reason: "protected_history"
          });
          return reply.code(409).send({ error: "Protected history blocks purge", code: "PROTECTED_HISTORY" });
        }
        throw error;
      }
      return { ok: true };
    }
  );
}
