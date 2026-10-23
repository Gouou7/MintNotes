import { syncState } from "./lifecycle.js";
import { issueSyncLease, validSyncLease } from "./protocol.js";
import { storageUsage } from "../storageUsage.js";
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
    const latest = syncState(db, user.id).head;
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

  app.get(`${apiPrefix}/sync/status`, { preHandler: authenticate }, async (request) => {
    const { userId } = getScope(request);
    const state = syncState(db, userId);
    const query = request.query as { epoch?: string; since?: string };
    const since = Number(query.since ?? 0);
    return { ...state, protocolVersion: 2, serverTime: new Date().toISOString(),
      reconcile: query.epoch !== state.epoch || !validSyncLease(db, userId, request.headers["x-webmd-sync-lease"])
        || !Number.isSafeInteger(since) || since < state.floor || since > state.head,
      lease: issueSyncLease(db, userId) };
  });
  app.get(`${apiPrefix}/sync/snapshot`, { preHandler: authenticate }, async (request, reply) => {
    const query = z.object({ after: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(500).default(200), epoch: z.string() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid snapshot request" });
    const { userId } = getScope(request);
    const state = syncState(db, userId);
    if (query.data.epoch !== state.epoch) return reply.code(409).send({ error: "Synchronization epoch changed", code: "SYNC_RECONCILE_REQUIRED" });
    const rows = db.prepare(`SELECT * FROM objects WHERE user_id = ? AND object_id > ? ORDER BY object_id LIMIT ?`)
      .all(userId, query.data.after ?? "", query.data.limit) as any[];
    return { epoch: state.epoch, objects: rows.map((r) => objectResponse(r)), next: rows.length === query.data.limit ? rows.at(-1).object_id : null };
  });
  app.get(`${apiPrefix}/sync`, { preHandler: authenticate }, async (request, reply) => {
    const scope = getScope(request);
    const parsed = z.object({ since: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().min(1).max(500).default(200), epoch: z.string().optional() }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid synchronization request" });
    const { since, limit, epoch } = parsed.data;
    const state = syncState(db, scope.userId);
    if ((epoch && epoch !== state.epoch) || since < state.floor || since > state.head) return { changes: [], cursor: state.head, hasMore: false, reset: true, epoch: state.epoch };
    const rows = db.prepare(`SELECT c.sequence, c.object_id, c.revision AS change_revision, c.category, c.change_type, c.created_at AS change_created_at,
        o.object_type, o.ciphertext, o.nonce, o.encryption_version, o.revision, o.deleted, o.trashed_at
      FROM changes c LEFT JOIN objects o ON o.user_id = c.user_id AND o.object_id = c.object_id
      WHERE c.user_id = ? AND c.sequence > ? ORDER BY c.sequence LIMIT ?`).all(scope.userId, since, limit) as any[];
    return { epoch: state.epoch, floor: state.floor,
      changes: rows.map((r) => ({ ...objectResponse(r), sequence: r.sequence, serverUpdatedAt: r.change_created_at,
        ...(r.category === "history" ? { historyVersion: r.change_revision } : {}), purged: r.change_type === "purge" })),
      cursor: rows.length === limit ? rows.at(-1).sequence : state.head, hasMore: rows.length === limit };
  });
  if (!applicationOnly) app.get(`${apiPrefix}/account/storage`, { preHandler: authenticate }, async (request) => ({
    ...storageUsage(db, getScope(request).userId), quotaBytes: config.userStorageQuotaBytes, historyQuotaBytes: config.userHistoryQuotaBytes
  }));

  app.get(`${apiPrefix}/objects/:objectId`, { preHandler: authenticate }, async (request, reply) => {
    const id = z.string().uuid().safeParse((request.params as { objectId: string }).objectId);
    if (!id.success) return reply.code(400).send({ error: "Invalid object ID" });
    const row = db.prepare(`SELECT object_id, object_type, ciphertext, nonce, encryption_version, revision, deleted, trashed_at
      FROM objects WHERE user_id = ? AND object_id = ?`).get(getScope(request).userId, id.data) as {
        object_id: string; object_type: string; ciphertext: string; nonce: string; encryption_version: number; revision: number; deleted: number; trashed_at: string | null;
      } | undefined;
    if (!row) return reply.code(404).send({ error: "Object not found" });
    return { objectId: row.object_id, objectType: row.object_type, ciphertext: row.ciphertext, nonce: row.nonce,
      encryptionVersion: row.encryption_version, revision: row.revision, deleted: Boolean(row.deleted), serverTrashedAt: row.trashed_at };
  });

  app.put(`${apiPrefix}/objects/:objectId`, { preHandler: authenticate }, async (request, reply) => {
    const scope = getScope(request);
    if (!validSyncLease(db, scope.userId, request.headers["x-webmd-sync-lease"])) return reply.code(409).send({ error: "Reconcile before uploading", code: "SYNC_RECONCILE_REQUIRED" });
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
        return reply.code(413).send({ error: error.message, code: error.code });
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
    if (!validSyncLease(db, scope.userId, request.headers["x-webmd-sync-lease"])) return reply.code(409).send({ error: "Reconcile before uploading", code: "SYNC_RECONCILE_REQUIRED" });
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
        return reply.code(413).send({ error: error.message, code: error.code });
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
        if (error instanceof Error && error.message === "OWNERSHIP_INCOMPLETE") {
          logEvent(request.log, "warn", "sync.purge_blocked", {
            actorRef: logRefs.create("user", scope.userId),
            count: parsed.data.objects.length,
            reason: "protected_history"
          });
          return reply.code(409).send({ error: "Attachment ownership reconciliation required", code: "OWNERSHIP_INCOMPLETE" });
        }
        throw error;
      }
      return { ok: true };
    }
  );
}

function objectResponse(row: any) {
  return { objectId: row.object_id, objectType: row.object_type ?? "note", ciphertext: row.ciphertext ?? "", nonce: row.nonce ?? "",
    encryptionVersion: row.encryption_version ?? 1, revision: row.revision ?? 0, deleted: Boolean(row.deleted), serverTrashedAt: row.trashed_at, serverUpdatedAt: row.updated_at ?? row.change_created_at,
    ...(row.owner_note_id ? { ownerNoteId: row.owner_note_id } : {}) };
}
