import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerConfig } from "../config.js";
import type { AppDatabase } from "../database.js";
import { authenticatedScope, type AuthGuard } from "../types.js";

export function registerAttachmentRoutes(
  app: FastifyInstance,
  dependencies: {
    db: AppDatabase;
    config: ServerConfig;
    authenticate: AuthGuard;
  }
) {
  const { db, config, authenticate } = dependencies;
  const chunkHeaderSchema = z.object({
    "x-webmd-nonce": z.string().min(16).max(200),
    "x-webmd-total-chunks": z.coerce.number().int().min(1)
      .max(Math.ceil(config.maxAttachmentBytes / (1024 * 1024))),
    "x-webmd-encryption-version": z.coerce.number().int().positive(),
    "x-webmd-idempotency-key": z.string().uuid()
  });

  app.put("/api/attachments/:attachmentId/chunks/:index", { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({
      attachmentId: z.string().uuid(),
      index: z.coerce.number().int().min(0).max(999)
    }).safeParse(request.params);
    const headers = chunkHeaderSchema.safeParse(request.headers);
    const body = request.body;
    if (!params.success || !headers.success || !Buffer.isBuffer(body)) {
      return reply.code(400).send({ error: "Invalid encrypted attachment chunk" });
    }
    if (body.byteLength > 1024 * 1024 + 64) {
      return reply.code(413).send({ error: "Attachment chunk is too large" });
    }
    const scope = authenticatedScope(request);
    const prior = db.prepare(
      "SELECT attachment_id, chunk_index FROM attachment_chunks WHERE user_id = ? AND idempotency_key = ?"
    ).get(scope.userId, headers.data["x-webmd-idempotency-key"]);
    if (prior) return { ok: true, idempotent: true };
    const existing = db.prepare(
      "SELECT 1 FROM attachment_chunks WHERE user_id = ? AND attachment_id = ? AND chunk_index = ?"
    ).get(scope.userId, params.data.attachmentId, params.data.index);
    if (existing) return reply.code(409).send({ error: "Attachment chunk already exists" });
    const used = Number((db.prepare(
      "SELECT COALESCE(SUM(LENGTH(ciphertext)), 0) AS bytes FROM attachment_chunks WHERE user_id = ?"
    ).get(scope.userId) as { bytes: number }).bytes);
    if (used + body.byteLength > config.userStorageQuotaBytes) {
      return reply.code(413).send({ error: "User storage quota exceeded" });
    }
    db.prepare(`
      INSERT INTO attachment_chunks (
        user_id, attachment_id, chunk_index, total_chunks, ciphertext,
        nonce, encryption_version, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      scope.userId,
      params.data.attachmentId,
      params.data.index,
      headers.data["x-webmd-total-chunks"],
      body,
      headers.data["x-webmd-nonce"],
      headers.data["x-webmd-encryption-version"],
      headers.data["x-webmd-idempotency-key"],
      new Date().toISOString()
    );
    return { ok: true };
  });

  app.get("/api/attachments/:attachmentId/chunks/:index", { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({
      attachmentId: z.string().uuid(),
      index: z.coerce.number().int().min(0).max(999)
    }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "Attachment chunk not found" });
    const scope = authenticatedScope(request);
    const row = db.prepare(`
      SELECT ciphertext, nonce, total_chunks, encryption_version
      FROM attachment_chunks
      WHERE user_id = ? AND attachment_id = ? AND chunk_index = ?
    `).get(
      scope.userId,
      params.data.attachmentId,
      params.data.index
    ) as {
      ciphertext: Buffer;
      nonce: string;
      total_chunks: number;
      encryption_version: number;
    } | undefined;
    if (!row) return reply.code(404).send({ error: "Attachment chunk not found" });
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Cache-Control", "private, no-store");
    reply.header("X-WebMD-Nonce", row.nonce);
    reply.header("X-WebMD-Total-Chunks", String(row.total_chunks));
    reply.header("X-WebMD-Encryption-Version", String(row.encryption_version));
    return reply.send(row.ciphertext);
  });
}
