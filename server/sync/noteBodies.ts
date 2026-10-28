import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDatabase } from "../database.js";
import type { ServerConfig } from "../config.js";
import type { AuthGuard, ScopeResolver } from "../types.js";
import { assertStorageGrowth } from "../storageQuota.js";
import { metadataUsage } from "../storageUsage.js";
import { validSyncLease } from "./protocol.js";

const blockSchema = z.object({ blockId: z.string().uuid(), ciphertext: z.string().regex(/^[A-Za-z0-9_-]+$/).min(23).max(87_404), nonce: z.string().regex(/^[A-Za-z0-9_-]{16}$/) }).strict();
export function registerNoteBodyRoutes(app: FastifyInstance, db: AppDatabase, config: ServerConfig,
  prefix: string, authenticate: AuthGuard, scope: ScopeResolver) {
  app.post(`${prefix}/notes/:noteId/body-blocks/batch`, { preHandler: authenticate, bodyLimit: 1_572_864 }, async (request, reply) => {
    const note = z.string().uuid().safeParse((request.params as { noteId: string }).noteId);
    const body = z.object({ blocks: z.array(blockSchema).min(1).max(16) }).strict().safeParse(request.body);
    const { userId } = scope(request);
    if (!note.success || !body.success || new Set(body.data.blocks.map((block) => block.blockId)).size !== body.data.blocks.length) return reply.code(400).send({ error: "Invalid note body blocks" });
    if (!validSyncLease(db, userId, request.headers["x-webmd-sync-lease"])) return reply.code(409).send({ code: "SYNC_RECONCILE_REQUIRED", error: "Reconcile before uploading" });
    return db.transaction(() => {
      if (db.prepare("SELECT 1 FROM changes WHERE user_id = ? AND object_id = ? AND change_type = 'purge'").get(userId, note.data)) return reply.code(409).send({ error: "Note identity was purged" });
      const owner = db.prepare("SELECT object_type FROM objects WHERE user_id = ? AND object_id = ?").get(userId, note.data) as { object_type: string } | undefined;
      if (owner && owner.object_type !== "note") return reply.code(409).send({ error: "Invalid note ownership" });
      // Validate the entire batch before admitting any new block.
      let growth = 0;
      const fresh = [];
      for (const block of body.data.blocks) {
        const old = db.prepare("SELECT ciphertext, nonce FROM note_body_blocks WHERE user_id = ? AND note_id = ? AND block_id = ?")
          .get(userId, note.data, block.blockId) as { ciphertext: string; nonce: string } | undefined;
        if (old && (old.ciphertext !== block.ciphertext || old.nonce !== block.nonce)) return reply.code(409).send({ error: "Immutable note body block mismatch" });
        if (!old) { growth += Buffer.byteLength(block.ciphertext) + Buffer.byteLength(block.nonce); fresh.push(block); }
      }
      assertStorageGrowth(db, userId, growth, config.userStorageQuotaBytes);
      const metadata = metadataUsage(db, userId);
      if (metadata.metadataUsedSlots + fresh.length * 2 + (owner ? 0 : 4) > metadata.metadataLimit)
        return reply.code(413).send({ code: "METADATA_QUOTA_EXCEEDED", error: "Synchronization metadata quota exceeded" });
      const insert = db.prepare("INSERT INTO note_body_blocks VALUES (?, ?, ?, ?, ?)");
      for (const block of fresh) insert.run(userId, note.data, block.blockId, block.ciphertext, block.nonce);
      return { accepted: body.data.blocks.map((block) => block.blockId) };
    }).immediate();
  });
  app.post(`${prefix}/notes/:noteId/body-blocks/read`, { preHandler: authenticate, bodyLimit: 1_572_864 }, async (request, reply) => {
    const note = z.string().uuid().safeParse((request.params as { noteId: string }).noteId);
    const body = z.object({ blockIds: z.array(z.string().uuid()).min(1).max(16) }).strict().safeParse(request.body);
    if (!note.success || !body.success) return reply.code(400).send({ error: "Invalid note body block request" });
    const { userId } = scope(request);
    const blocks = body.data.blockIds.map((id) => db.prepare("SELECT block_id AS blockId, ciphertext, nonce FROM note_body_blocks WHERE user_id = ? AND note_id = ? AND block_id = ?").get(userId, note.data, id));
    if (blocks.some((block) => !block)) return reply.code(404).send({ error: "Note body block not found", code: "BODY_BLOCK_MISSING" });
    return { blocks };
  });
}
