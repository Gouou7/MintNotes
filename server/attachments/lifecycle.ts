import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDatabase } from "../database.js";
import { authenticatedScope, type ScopeResolver, type AuthGuard } from "../types.js";
import { syncState, SYNC_LIFETIME_MS } from "../sync/lifecycle.js";
import { purgeUnusedAttachment } from "../trash.js";

export function registerAttachmentLifecycle(app: FastifyInstance, options: { db: AppDatabase; authenticate: AuthGuard; apiPrefix?: string; scope?: ScopeResolver }) {
  const { db, authenticate } = options;
  const prefix = options.apiPrefix ?? "/api";
  const scope = options.scope ?? authenticatedScope;
  app.post(`${prefix}/attachments/ownership`, { preHandler: authenticate }, async (request, reply) => {
    const parsed = z.object({ epoch: z.string(), head: z.number().int().nonnegative(), complete: z.boolean().default(false),
      mappings: z.array(z.object({ attachmentId: z.string().uuid(), ownerNoteId: z.string().uuid(), revision: z.number().int().positive() })).max(500)
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid attachment ownership" });
    const { userId } = scope(request);
    const state = syncState(db, userId);
    if (state.epoch !== parsed.data.epoch) return reply.code(409).send({ error: "Synchronization epoch changed" });
    try {
      return db.transaction(() => {
        for (const mapping of parsed.data.mappings) {
          const row = db.prepare("SELECT revision, owner_note_id FROM objects WHERE user_id = ? AND object_id = ? AND object_type = 'attachment'").get(userId, mapping.attachmentId) as { revision: number; owner_note_id: string | null } | undefined;
          if (!row || row.revision !== mapping.revision || (row.owner_note_id && row.owner_note_id !== mapping.ownerNoteId)) throw new Error("OWNERSHIP_CONFLICT");
          if (db.prepare("SELECT 1 FROM objects WHERE user_id = ? AND object_id = ? AND object_type != 'note'").get(userId, mapping.ownerNoteId)) throw new Error("OWNERSHIP_CONFLICT");
          const prior = db.prepare("SELECT note_id FROM attachment_owners WHERE user_id = ? AND attachment_id = ?").get(userId, mapping.attachmentId) as { note_id: string } | undefined;
          if (prior && prior.note_id !== mapping.ownerNoteId) throw new Error("OWNERSHIP_CONFLICT");
          if (!row.owner_note_id) db.prepare(`INSERT INTO ownership_versions VALUES (?, ?, 1)
            ON CONFLICT(user_id, note_id) DO UPDATE SET version = version + 1`).run(userId, mapping.ownerNoteId);
          db.prepare("UPDATE objects SET owner_note_id = ? WHERE user_id = ? AND object_id = ?").run(mapping.ownerNoteId, userId, mapping.attachmentId);
          db.prepare("INSERT OR IGNORE INTO attachment_owners VALUES (?, ?, ?)").run(userId, mapping.attachmentId, mapping.ownerNoteId);
        }
        if (parsed.data.complete && (state.head !== parsed.data.head || db.prepare("SELECT 1 FROM objects WHERE user_id = ? AND object_type = 'attachment' AND owner_note_id IS NULL LIMIT 1").get(userId))) throw new Error("OWNERSHIP_CONFLICT");
        db.prepare(`INSERT INTO ownership_state(user_id, complete, version) VALUES (?, ?, 1)
          ON CONFLICT(user_id) DO UPDATE SET complete = MAX(complete, excluded.complete), version = version + 1`).run(userId, Number(parsed.data.complete));
        db.prepare("DELETE FROM attachment_gc WHERE user_id = ?").run(userId);
        return db.prepare("SELECT complete, version FROM ownership_state WHERE user_id = ?").get(userId);
      })();
    } catch (error) {
      if (error instanceof Error && error.message === "OWNERSHIP_CONFLICT") return reply.code(409).send({ error: "Attachment ownership changed; reconcile again", code: "OWNERSHIP_CONFLICT" });
      throw error;
    }
  });
  app.post(`${prefix}/attachments/reclaim`, { preHandler: authenticate }, async (request, reply) => {
    const parsed = z.object({ noteId: z.string().uuid(), noteRevision: z.number().int().positive(), historyVersion: z.number().int().nonnegative(),
      ownershipVersion: z.number().int().positive(), attachmentIds: z.array(z.string().uuid()).max(500), confirm: z.boolean().default(false)
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid attachment reclamation" });
    const { userId } = scope(request);
    const input = parsed.data;
    return db.transaction(() => {
      const owner = db.prepare("SELECT complete, version FROM ownership_state WHERE user_id = ?").get(userId) as { complete: number; version: number } | undefined;
      const note = db.prepare("SELECT revision, deleted FROM objects WHERE user_id = ? AND object_id = ? AND object_type = 'note'").get(userId, input.noteId) as { revision: number; deleted: number } | undefined;
      const history = db.prepare("SELECT version FROM history_versions WHERE user_id = ? AND note_id = ?").get(userId, input.noteId) as { version: number } | undefined;
      if (!owner?.complete || (db.prepare("SELECT version FROM ownership_versions WHERE user_id = ? AND note_id = ?").get(userId, input.noteId) as { version: number } | undefined)?.version !== input.ownershipVersion || note?.deleted !== 0 || note.revision !== input.noteRevision || (history?.version ?? 0) !== input.historyVersion) return reply.code(409).send({ error: "Reclamation state changed", code: "RECLAIM_CONFLICT" });
      for (const id of input.attachmentIds) {
        if (!db.prepare("SELECT 1 FROM objects WHERE user_id = ? AND object_id = ? AND owner_note_id = ?").get(userId, id, input.noteId)
          || db.prepare("SELECT 1 FROM protected_history_attachments WHERE user_id = ? AND attachment_id = ?").get(userId, id)) return reply.code(409).send({ error: "Attachment is retained", code: "RECLAIM_CONFLICT" });
      }
      const purged: string[] = [];
      for (const id of new Set(input.attachmentIds)) {
        const prior = db.prepare("SELECT * FROM attachment_gc WHERE user_id = ? AND attachment_id = ?").get(userId, id) as { note_revision: number; history_version: number; ownership_version: number; proposed_at: string } | undefined;
        if (input.confirm && prior && prior.note_revision === input.noteRevision && prior.history_version === input.historyVersion
          && prior.ownership_version === input.ownershipVersion && Date.parse(prior.proposed_at) <= Date.now() - SYNC_LIFETIME_MS) {
          purgeUnusedAttachment(db, userId, id); purged.push(id);
        } else if (!prior || prior.note_revision !== input.noteRevision || prior.history_version !== input.historyVersion || prior.ownership_version !== input.ownershipVersion) db.prepare(`INSERT INTO attachment_gc VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, attachment_id) DO UPDATE SET note_revision=excluded.note_revision, history_version=excluded.history_version,
            ownership_version=excluded.ownership_version, proposed_at=excluded.proposed_at`).run(userId, id, input.noteId, input.noteRevision, input.historyVersion, input.ownershipVersion, new Date().toISOString());
      }
      return { purged, graceDays: 90 };
    })();
  });
  app.get(`${prefix}/attachments/ownership`, { preHandler: authenticate }, async (request) => {
    const { userId } = scope(request);
    return { ...(db.prepare("SELECT complete, version FROM ownership_state WHERE user_id = ?").get(userId) as { complete: number; version: number } | undefined ?? { complete: 1, version: 0 }),
      notes: db.prepare("SELECT note_id AS noteId, version FROM ownership_versions WHERE user_id = ?").all(userId) };
  });
}
