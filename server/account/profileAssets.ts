import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDatabase } from "../database.js";
import type { ServerConfig } from "../config.js";
import type { AuthGuard, SessionUser } from "../types.js";
import { assertStorageGrowth, StorageQuotaError } from "../storageQuota.js";
export function registerProfileAssetRoutes(app: FastifyInstance, { db, config, authenticate }: { db: AppDatabase; config: ServerConfig; authenticate: AuthGuard }) {
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
    try {
      db.transaction(() => {
          const oldBytes = (db.prepare("SELECT LENGTH(CAST(ciphertext AS BLOB)) + LENGTH(CAST(nonce AS BLOB)) AS bytes FROM profile_assets WHERE user_id = ?").get(user.id) as { bytes: number } | undefined)?.bytes ?? 0;
          assertStorageGrowth(db, user.id, Buffer.byteLength(parsed.data.ciphertext) + Buffer.byteLength(parsed.data.nonce) - oldBytes, config.userStorageQuotaBytes);
        db.prepare(`
          INSERT INTO profile_assets (user_id, ciphertext, nonce, encryption_version, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext,
            nonce = excluded.nonce, encryption_version = excluded.encryption_version,
            updated_at = excluded.updated_at
        `).run(user.id, parsed.data.ciphertext, parsed.data.nonce, parsed.data.encryptionVersion, updatedAt);
      }).immediate();
    } catch (error) {
      if (error instanceof StorageQuotaError) return reply.code(413).send({ error: error.message, code: error.code });
      throw error;
    }
    return { avatar: { ...parsed.data, updatedAt } };
  });

  app.delete("/api/account/avatar", { preHandler: authenticate }, async (request) => {
    const user = request.sessionUser as SessionUser;
    db.prepare("DELETE FROM profile_assets WHERE user_id = ?").run(user.id);
    return { ok: true };
  });

}
