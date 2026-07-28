import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppDatabase } from "../database.js";
import { createSessionToken, hashToken, verifyOpaqueSecret } from "../security.js";
import { SyncEventHub } from "../syncEvents.js";
import type { AuthGuard, SessionUser } from "../types.js";

const secretField = z.string().min(20).max(1024);
const usernameField = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,47}$/);

export function registerAdminRoutes(
  app: FastifyInstance,
  dependencies: {
    db: AppDatabase;
    syncEvents: SyncEventHub;
    requireAdmin: AuthGuard;
  }
) {
  const { db, syncEvents, requireAdmin } = dependencies;

  app.get("/api/admin/users", { preHandler: requireAdmin }, async () => {
    const users = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.disabled, u.created_at,
        COALESCE(ob.object_count, 0) AS object_count,
        COALESCE(ob.object_bytes, 0) + COALESCE(ac.attachment_bytes, 0)
          + COALESCE(nh.history_bytes, 0) + COALESCE(pa.avatar_bytes, 0) AS encrypted_bytes
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS object_count, SUM(LENGTH(ciphertext)) AS object_bytes
        FROM objects GROUP BY user_id
      ) ob ON ob.user_id = u.id
      LEFT JOIN (
        SELECT user_id, SUM(LENGTH(ciphertext)) AS attachment_bytes
        FROM attachment_chunks GROUP BY user_id
      ) ac ON ac.user_id = u.id
      LEFT JOIN (
        SELECT user_id, SUM(byte_size) AS history_bytes
        FROM note_history GROUP BY user_id
      ) nh ON nh.user_id = u.id
      LEFT JOIN (
        SELECT user_id, LENGTH(ciphertext) AS avatar_bytes FROM profile_assets
      ) pa ON pa.user_id = u.id
      ORDER BY u.created_at ASC
    `).all() as any[];
    const setups = db.prepare(
      "SELECT id, username, display_name, created_at, expires_at FROM account_setups ORDER BY created_at ASC"
    ).all() as any[];
    return {
      users: users.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        disabled: Boolean(row.disabled),
        createdAt: row.created_at,
        objectCount: row.object_count,
        encryptedBytes: row.encrypted_bytes
      })),
      setups: setups.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        createdAt: row.created_at,
        expiresAt: row.expires_at
      }))
    };
  });

  app.post("/api/admin/account-setups", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({
      username: usernameField,
      displayName: z.string().trim().min(1).max(80),
      expiresInHours: z.number().int().min(1).max(720).default(72)
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid user setup" });
    db.prepare("DELETE FROM account_setups WHERE expires_at <= ?").run(new Date().toISOString());
    if (
      db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(parsed.data.username)
      || db.prepare("SELECT 1 FROM account_setups WHERE username = ? COLLATE NOCASE").get(parsed.data.username)
    ) {
      return reply.code(409).send({ error: "Username is unavailable" });
    }
    const id = randomUUID();
    const code = createSessionToken();
    const now = new Date();
    const expires = new Date(now.getTime() + parsed.data.expiresInHours * 60 * 60 * 1000);
    db.prepare(`
      INSERT INTO account_setups (
        id, username, display_name, code_hash, created_by, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      parsed.data.username,
      parsed.data.displayName,
      hashToken(code),
      request.sessionUser?.id,
      now.toISOString(),
      expires.toISOString()
    );
    return reply.code(201).send({
      id,
      username: parsed.data.username,
      displayName: parsed.data.displayName,
      activationCode: code,
      expiresAt: expires.toISOString()
    });
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
    if (targetId.data === request.sessionUser?.id && body.data.disabled) {
      return reply.code(400).send({ error: "You cannot disable your own account" });
    }
    const result = db.prepare("UPDATE users SET disabled = ? WHERE id = ?")
      .run(body.data.disabled ? 1 : 0, targetId.data);
    if (!result.changes) return reply.code(404).send({ error: "User not found" });
    if (body.data.disabled) {
      const revokedAt = new Date().toISOString();
      db.transaction(() => {
        db.prepare(
          "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL"
        ).run(revokedAt, targetId.data);
        db.prepare(
          "UPDATE trusted_endpoints SET remembered = 0, revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL"
        ).run(revokedAt, targetId.data);
      })();
      syncEvents.closeUser(targetId.data);
    }
    return { ok: true };
  });

  app.delete("/api/admin/users/:userId", { preHandler: requireAdmin }, async (request, reply) => {
    const targetId = z.string().uuid().safeParse((request.params as { userId: string }).userId);
    const body = z.object({
      currentAuthSecret: secretField,
      confirmationUsername: usernameField
    }).safeParse(request.body);
    if (!targetId.success || !body.success) return reply.code(400).send({ error: "Invalid user deletion" });
    const administrator = request.sessionUser as SessionUser;
    if (targetId.data === administrator.id) {
      return reply.code(400).send({ error: "You cannot delete your own account" });
    }
    const adminAuth = db.prepare(
      "SELECT auth_salt, auth_hash FROM users WHERE id = ?"
    ).get(administrator.id) as { auth_salt: string; auth_hash: string } | undefined;
    if (
      !adminAuth
      || !verifyOpaqueSecret(body.data.currentAuthSecret, adminAuth.auth_salt, adminAuth.auth_hash)
    ) {
      return reply.code(401).send({ error: "Current password is incorrect" });
    }
    const target = db.prepare(
      "SELECT username, role FROM users WHERE id = ?"
    ).get(targetId.data) as { username: string; role: string } | undefined;
    if (!target) return reply.code(404).send({ error: "User not found" });
    if (target.username !== body.data.confirmationUsername) {
      return reply.code(400).send({ error: "Username confirmation does not match" });
    }
    if (target.role === "admin") {
      const administrators = db.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE role = 'admin'"
      ).get() as { count: number };
      if (administrators.count <= 1) {
        return reply.code(400).send({ error: "The last administrator cannot be deleted" });
      }
    }
    db.transaction(() => {
      db.prepare("DELETE FROM users WHERE id = ?").run(targetId.data);
    })();
    syncEvents.closeUser(targetId.data);
    return { ok: true };
  });
}
