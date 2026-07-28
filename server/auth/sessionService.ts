import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { ServerConfig } from "../config.js";
import type { AppDatabase } from "../database.js";
import { createSessionToken, hashToken } from "../security.js";
import { SyncEventHub } from "../syncEvents.js";
import type { AuthGuard } from "../types.js";

const REMEMBERED_COOKIE_DAYS = 400;
const REMEMBERED_COOKIE_MS = REMEMBERED_COOKIE_DAYS * 24 * 60 * 60 * 1000;

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

export function createSessionService(
  db: AppDatabase,
  config: ServerConfig,
  syncEvents: SyncEventHub
) {
  const sessionCookie = config.production ? "__Host-webmd_session" : "webmd_session";
  const endpointCookie = config.production ? "__Host-webmd_endpoint" : "webmd_endpoint";

  const sessionCookieOptions = (expires?: Date) => ({
    path: "/",
    httpOnly: true,
    secure: config.production,
    sameSite: "strict" as const,
    ...(expires ? { expires } : {})
  });

  const endpointSummary = (endpointId: string, remembered: boolean) => ({
    id: endpointId,
    remembered
  });

  const authenticate: AuthGuard = async (request, reply) => {
    const rawToken = request.cookies[sessionCookie];
    if (!rawToken) {
      await reply.code(401).send({ error: "Authentication required" });
      return;
    }
    const row = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.disabled,
        s.session_id, s.endpoint_id, s.remembered, s.created_at AS session_created_at,
        s.last_seen_at, s.expires_at, e.first_seen_at AS endpoint_first_seen_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN trusted_endpoints e ON e.endpoint_id = s.endpoint_id AND e.user_id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL
        AND e.revoked_at IS NULL
    `).get(hashToken(rawToken), new Date().toISOString()) as
      | {
          id: string;
          username: string;
          display_name: string;
          role: "admin" | "user";
          disabled: number;
          session_id: string;
          endpoint_id: string;
          remembered: number;
          session_created_at: string;
          last_seen_at: string;
          expires_at: string;
          endpoint_first_seen_at: string;
        }
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
        db.prepare(
          "UPDATE sessions SET last_seen_at = ? WHERE session_id = ? AND last_seen_at < ?"
        ).run(now.toISOString(), row.session_id, minuteAgo);
        db.prepare(
          "UPDATE trusted_endpoints SET last_seen_at = ?, ip_address = ? WHERE endpoint_id = ? AND user_id = ?"
        ).run(now.toISOString(), request.ip.slice(0, 100), row.endpoint_id, row.id);
      })();
    }
    if (row.remembered && new Date(row.expires_at).getTime() - now.getTime() < 30 * 24 * 60 * 60 * 1000) {
      const expires = new Date(now.getTime() + REMEMBERED_COOKIE_MS);
      db.prepare("UPDATE sessions SET expires_at = ? WHERE session_id = ?")
        .run(expires.toISOString(), row.session_id);
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

  const setSession = (
    request: FastifyRequest,
    reply: FastifyReply,
    userId: string,
    remembered = false
  ) => {
    const rawToken = createSessionToken();
    const now = new Date();
    const expires = new Date(
      now.getTime() + (remembered ? REMEMBERED_COOKIE_MS : config.sessionTtlHours * 60 * 60 * 1000)
    );
    const userAgent = String(request.headers["user-agent"] ?? "").slice(0, 500);
    let rawEndpoint = request.cookies[endpointCookie];
    if (!rawEndpoint || rawEndpoint.length < 32) rawEndpoint = createSessionToken();
    const endpointHash = hashToken(rawEndpoint);
    const ipAddress = request.ip.slice(0, 100);
    const currentEndpoint = db.prepare(
      "SELECT endpoint_id FROM trusted_endpoints WHERE user_id = ? AND endpoint_hash = ?"
    ).get(userId, endpointHash) as { endpoint_id: string } | undefined;
    const endpointId = currentEndpoint?.endpoint_id ?? randomUUID();
    db.transaction(() => {
      if (currentEndpoint) {
        db.prepare(`
          UPDATE trusted_endpoints SET device_name = ?, user_agent = ?, ip_address = ?,
            last_login_at = ?, last_seen_at = ?, login_count = login_count + 1,
            remembered = ?, revoked_at = NULL
          WHERE endpoint_id = ? AND user_id = ?
        `).run(
          deviceName(userAgent),
          userAgent,
          ipAddress,
          now.toISOString(),
          now.toISOString(),
          remembered ? 1 : 0,
          endpointId,
          userId
        );
      } else {
        db.prepare(`
          INSERT INTO trusted_endpoints (
            endpoint_id, user_id, endpoint_hash, device_name, user_agent, ip_address,
            first_seen_at, last_login_at, last_seen_at, remembered
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          endpointId,
          userId,
          endpointHash,
          deviceName(userAgent),
          userAgent,
          ipAddress,
          now.toISOString(),
          now.toISOString(),
          now.toISOString(),
          remembered ? 1 : 0
        );
      }
      db.prepare(
        "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND endpoint_id = ? AND revoked_at IS NULL"
      ).run(now.toISOString(), userId, endpointId);
      db.prepare(`
        INSERT INTO sessions (
          token_hash, session_id, user_id, endpoint_id, remembered, device_name, user_agent,
          ip_address, created_at, last_seen_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        hashToken(rawToken),
        randomUUID(),
        userId,
        endpointId,
        remembered ? 1 : 0,
        deviceName(userAgent),
        userAgent,
        ipAddress,
        now.toISOString(),
        now.toISOString(),
        expires.toISOString()
      );
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
  };

  return {
    authenticate,
    requireAdmin,
    setSession,
    endpointSummary,
    sessionCookie
  };
}
