import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { ServerConfig } from "../config.js";
import type { AppDatabase } from "../database.js";
import { createSessionToken, hashToken, verifyOpaqueSecret } from "../security.js";
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
      await reply.code(401).send({ error: "Authentication required", code: "BROWSER_SESSION_INVALID" });
      return;
    }
    const expected = request.headers["x-webmd-session"];
    if (!expected) {
      await reply.code(426).send({ error: "Client upgrade required", code: "BROWSER_UPGRADE_REQUIRED" });
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
      await reply.code(401).send({ error: "Session is no longer valid", code: "BROWSER_SESSION_INVALID" });
      return;
    }
    if (expected !== row.session_id) {
      await reply.code(409).send({ error: "Browser session changed", code: "BROWSER_SESSION_CHANGED" });
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
    request.sessionContext = {
      id: row.session_id,
      endpointId: row.endpoint_id,
      endpointFirstSeenAt: row.endpoint_first_seen_at,
      remembered: Boolean(row.remembered),
      createdAt: row.session_created_at,
      expiresAt: row.expires_at,
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
      "SELECT endpoint_id, revoked_at FROM trusted_endpoints WHERE user_id = ? AND endpoint_hash = ?"
    ).get(userId, endpointHash) as { endpoint_id: string; revoked_at: string | null } | undefined;
    const endpointId = currentEndpoint?.endpoint_id ?? randomUUID();
    const sessionId = randomUUID();
    const retired = db.transaction(() => {
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
      if (!remembered || currentEndpoint?.revoked_at) db.prepare("DELETE FROM device_grants WHERE endpoint_id = ?").run(endpointId);
      const retired = db.prepare(`
        UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL AND endpoint_id IN (
          SELECT endpoint_id FROM trusted_endpoints WHERE endpoint_hash = ?
        ) RETURNING session_id
      `).all(now.toISOString(), endpointHash) as Array<{ session_id: string }>;
      db.prepare(`
        INSERT INTO sessions (
          token_hash, session_id, user_id, endpoint_id, remembered, device_name, user_agent,
          ip_address, created_at, last_seen_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        hashToken(rawToken),
        sessionId,
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
      return retired;
    }).immediate();
    for (const previous of retired) syncEvents.closeSession(previous.session_id);
    reply.setCookie(endpointCookie, rawEndpoint, {
      path: "/",
      httpOnly: true,
      secure: config.production,
      sameSite: "strict",
      expires: new Date(now.getTime() + REMEMBERED_COOKIE_MS)
    });
    reply.setCookie(sessionCookie, rawToken, sessionCookieOptions(remembered ? expires : undefined));
    return { endpoint: endpointSummary(endpointId, remembered), sessionId };
  };

  function enroll(request: FastifyRequest, grant: { id: string; secret: string; authSecret: string }) {
    const context = request.sessionContext!;
    if (!context.remembered) return false;
    const user = db.prepare("SELECT auth_salt, auth_hash FROM users WHERE id = ? AND disabled = 0")
      .get(request.sessionUser!.id) as { auth_salt: string; auth_hash: string } | undefined;
    if (!user || !verifyOpaqueSecret(grant.authSecret, user.auth_salt, user.auth_hash)) return false;
    const secretHash = hashToken(grant.secret);
    const current = db.prepare("SELECT grant_id, secret_hash FROM device_grants WHERE endpoint_id = ?")
      .get(context.endpointId) as { grant_id: string; secret_hash: string } | undefined;
    if (current?.grant_id === grant.id) return current.secret_hash === secretHash;
    if (db.prepare("SELECT 1 FROM device_grants WHERE grant_id = ?").get(grant.id)) return false;
    db.prepare(`
      INSERT INTO device_grants(endpoint_id, grant_id, secret_hash, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint_id) DO UPDATE SET grant_id = excluded.grant_id,
        secret_hash = excluded.secret_hash, expires_at = excluded.expires_at
    `).run(context.endpointId, grant.id, secretHash, new Date(Date.now() + REMEMBERED_COOKIE_MS).toISOString());
    return true;
  }

  function resume(request: FastifyRequest, reply: FastifyReply, id: string, secret: string) {
    const browser = request.cookies[endpointCookie];
    if (!browser) return;
    const now = new Date();
    const grant = db.prepare(`
      SELECT g.secret_hash, g.expires_at AS grant_expiry, e.endpoint_id, u.id, u.username,
        u.display_name AS displayName, u.role
      FROM device_grants g JOIN trusted_endpoints e USING (endpoint_id)
      JOIN users u ON u.id = e.user_id
      WHERE g.grant_id = ? AND e.endpoint_hash = ? AND e.revoked_at IS NULL
        AND e.remembered = 1 AND u.disabled = 0 AND g.expires_at > ?
    `).get(id, hashToken(browser), now.toISOString()) as {
      secret_hash: string; grant_expiry: string; endpoint_id: string;
      id: string; username: string; displayName: string; role: "admin" | "user";
    } | undefined;
    if (!grant || !timingSafeEqual(Buffer.from(grant.secret_hash), Buffer.from(hashToken(secret)))) return;

    const cookie = request.cookies[sessionCookie];
    const active = cookie ? db.prepare(`
      SELECT session_id, expires_at FROM sessions
      WHERE token_hash = ? AND endpoint_id = ? AND revoked_at IS NULL AND expires_at > ?
    `).get(hashToken(cookie), grant.endpoint_id, now.toISOString()) as { session_id: string; expires_at: string } | undefined : undefined;
    const renewalCutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const expires = new Date(now.getTime() + REMEMBERED_COOKIE_MS);
    const session = active ? { sessionId: active.session_id, endpoint: endpointSummary(grant.endpoint_id, true) }
      : setSession(request, reply, grant.id, true);
    if (active && active.expires_at < renewalCutoff) {
      db.prepare("UPDATE sessions SET expires_at = ? WHERE session_id = ?").run(expires.toISOString(), active.session_id);
      reply.setCookie(sessionCookie, cookie!, sessionCookieOptions(expires));
      reply.setCookie(endpointCookie, browser, sessionCookieOptions(expires));
    }
    if (grant.grant_expiry < renewalCutoff) {
      db.prepare("UPDATE device_grants SET expires_at = ? WHERE grant_id = ?").run(expires.toISOString(), id);
    }
    return { ...session, user: { id: grant.id, username: grant.username, displayName: grant.displayName, role: grant.role } };
  }

  function close(sessionId: string) {
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL")
      .run(new Date().toISOString(), sessionId);
    syncEvents.closeSession(sessionId);
  }

  function revokeEndpoint(userId: string, endpointId: string) {
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare("DELETE FROM device_grants WHERE endpoint_id = ? AND endpoint_id IN (SELECT endpoint_id FROM trusted_endpoints WHERE user_id = ?)").run(endpointId, userId);
      db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND endpoint_id = ? AND revoked_at IS NULL").run(now, userId, endpointId);
      db.prepare("UPDATE trusted_endpoints SET remembered = 0, revoked_at = ? WHERE user_id = ? AND endpoint_id = ?").run(now, userId, endpointId);
    })();
    syncEvents.closeEndpoint(userId, endpointId);
  }

  function revokeBrowserGrant(request: FastifyRequest, target: { endpointId: string; grantId?: string; sessionId?: string }) {
    const { endpointId, grantId, sessionId } = target;
    const browser = request.cookies[endpointCookie];
    if (!browser) return false;
    const endpoint = db.prepare(`
      SELECT e.user_id, g.grant_id FROM trusted_endpoints e
      LEFT JOIN device_grants g USING (endpoint_id)
      WHERE e.endpoint_id = ? AND e.endpoint_hash = ?
    `).get(endpointId, hashToken(browser)) as { user_id: string; grant_id: string | null } | undefined;
    if (!endpoint) return false;
    if (endpoint.grant_id) {
      if (endpoint.grant_id === grantId) revokeEndpoint(endpoint.user_id, endpointId);
      return true;
    }
    // Legacy tasks lack an authorization identity. The upgrade already retired those sessions.
    if (!sessionId || !db.prepare("SELECT 1 FROM sessions WHERE endpoint_id = ? AND session_id = ?").get(endpointId, sessionId)) {
      return true;
    }
    close(sessionId);
    const active = db.prepare("SELECT 1 FROM sessions WHERE endpoint_id = ? AND revoked_at IS NULL AND expires_at > ?")
      .get(endpointId, new Date().toISOString());
    if (!active) revokeEndpoint(endpoint.user_id, endpointId);
    return true;
  }

  return {
    enroll,
    resume,
    close,
    revokeEndpoint,
    revokeBrowserGrant,
    authenticate,
    requireAdmin,
    setSession,
    endpointSummary,
    sessionCookie
  };
}
