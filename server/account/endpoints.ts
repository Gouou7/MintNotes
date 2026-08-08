import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDatabase } from "../database.js";
import { SyncEventHub } from "../syncEvents.js";
import type { AuthGuard, SessionContext, SessionUser } from "../types.js";

const SESSION_REVOCATION_AGE_MS = 24 * 60 * 60 * 1000;
export const INACTIVE_ENDPOINT_RETENTION_DAYS = 30;
const INACTIVE_ENDPOINT_RETENTION_MS = INACTIVE_ENDPOINT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function cleanupInactiveEndpoints(db: AppDatabase, now = new Date()): number {
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - INACTIVE_ENDPOINT_RETENTION_MS).toISOString();
  return db.prepare(`
    DELETE FROM trusted_endpoints
    WHERE endpoint_id IN (
      SELECT endpoint.endpoint_id
      FROM trusted_endpoints endpoint
      WHERE (
        endpoint.revoked_at IS NOT NULL AND endpoint.revoked_at <= ?
      ) OR (
        endpoint.revoked_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM sessions active_session
          WHERE active_session.endpoint_id = endpoint.endpoint_id
            AND active_session.user_id = endpoint.user_id
            AND active_session.revoked_at IS NULL
            AND active_session.expires_at > ?
        )
        AND COALESCE((
          SELECT MAX(expired_session.expires_at) FROM sessions expired_session
          WHERE expired_session.endpoint_id = endpoint.endpoint_id
            AND expired_session.user_id = endpoint.user_id
        ), endpoint.last_seen_at) <= ?
      )
    )
  `).run(cutoff, nowIso, cutoff).changes;
}

export function registerEndpointRoutes(
  app: FastifyInstance,
  dependencies: { db: AppDatabase; syncEvents: SyncEventHub; authenticate: AuthGuard }
) {
  const { db, syncEvents, authenticate } = dependencies;

  app.get("/api/account/endpoints", { preHandler: authenticate }, async (request) => {
    const user = request.sessionUser as SessionUser;
    const current = request.sessionContext as SessionContext;
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
      inactiveRetentionDays: INACTIVE_ENDPOINT_RETENTION_DAYS,
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
    const current = request.sessionContext as SessionContext;
    if (endpointId.data === current.endpointId) {
      return reply.code(400).send({ error: "Use logout to end the current endpoint" });
    }

    const now = new Date();
    const target = db.prepare(`
      SELECT endpoint.revoked_at,
        EXISTS (
          SELECT 1 FROM sessions s
          WHERE s.endpoint_id = endpoint.endpoint_id AND s.user_id = endpoint.user_id
            AND s.revoked_at IS NULL AND s.expires_at > ?
        ) AS active
      FROM trusted_endpoints endpoint
      WHERE endpoint.endpoint_id = ? AND endpoint.user_id = ?
    `).get(now.toISOString(), endpointId.data, user.id) as { revoked_at: string | null; active: number } | undefined;
    if (!target) return reply.code(404).send({ error: "Endpoint not found" });

    if (!target.active || target.revoked_at !== null) {
      db.prepare("DELETE FROM trusted_endpoints WHERE endpoint_id = ? AND user_id = ?")
        .run(endpointId.data, user.id);
      return { ok: true, action: "removed" };
    }

    const eligibleAt = new Date(new Date(current.endpointFirstSeenAt).getTime() + SESSION_REVOCATION_AGE_MS);
    if (now.getTime() < eligibleAt.getTime()) {
      return reply.code(403).send({ error: "Current endpoint must be at least 24 hours old", eligibleAt: eligibleAt.toISOString() });
    }
    const revokedAt = now.toISOString();
    db.transaction(() => {
      db.prepare("UPDATE trusted_endpoints SET remembered = 0, revoked_at = ? WHERE endpoint_id = ? AND user_id = ?")
        .run(revokedAt, endpointId.data, user.id);
      db.prepare("UPDATE sessions SET revoked_at = ? WHERE endpoint_id = ? AND user_id = ? AND revoked_at IS NULL")
        .run(revokedAt, endpointId.data, user.id);
    })();
    syncEvents.closeEndpoint(user.id, endpointId.data);
    return { ok: true, action: "signed-out" };
  });
}
