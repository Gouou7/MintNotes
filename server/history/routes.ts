import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerConfig } from "../config.js";
import type { AppDatabase } from "../database.js";
import { cleanupUserHistory, HISTORY_CAPTURE_KINDS, historyUsage } from "../history.js";
import { authenticatedScope, type AuthGuard } from "../types.js";

const envelopeField = z.string().min(16).max(2_000_000);
const historyMetadataFields = {
  metadataCiphertext: envelopeField.optional(),
  metadataNonce: z.string().min(16).max(200).optional(),
  metadataEncryptionVersion: z.literal(1).optional()
};

const hasCompleteMetadata = (value: {
  metadataCiphertext?: string;
  metadataNonce?: string;
  metadataEncryptionVersion?: number;
}) => {
  const present = [value.metadataCiphertext, value.metadataNonce, value.metadataEncryptionVersion]
    .filter((entry) => entry !== undefined).length;
  return present === 0 || present === 3;
};

function encodeHistoryCursor(capturedAt: string, historyId: string): string {
  return Buffer.from(JSON.stringify([capturedAt, historyId]), "utf8").toString("base64url");
}

function decodeHistoryCursor(value: string | undefined): [string, string] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") return null;
    return [parsed[0], parsed[1]];
  } catch {
    return null;
  }
}

interface HistoryRow {
  captured_at: string;
  capture_kind: string;
  ciphertext: string;
  nonce: string;
  encryption_version: number;
  metadata_ciphertext: string | null;
  metadata_nonce: string | null;
  metadata_encryption_version: number | null;
  is_protected: number;
  byte_size: number;
  created_at: string;
}

function responseMetadata(row: HistoryRow) {
  return row.metadata_ciphertext && row.metadata_nonce && row.metadata_encryption_version === 1
    ? {
        metadataCiphertext: row.metadata_ciphertext,
        metadataNonce: row.metadata_nonce,
        metadataEncryptionVersion: 1 as const
      }
    : {};
}

export function registerHistoryRoutes(
  app: FastifyInstance,
  dependencies: { db: AppDatabase; config: ServerConfig; authenticate: AuthGuard }
) {
  const { db, config, authenticate } = dependencies;

  const historySettingsSchema = z.object({
    enabled: z.boolean().optional(),
    intervalMinutes: z.union([z.literal(5), z.literal(10), z.literal(30), z.literal(60)]).optional(),
    retentionDays: z.union([
      z.literal(7), z.literal(30), z.literal(90), z.literal(180), z.literal(365), z.null()
    ]).optional()
  }).refine((value) => Object.keys(value).length > 0);

  const accountHistorySettings = (userId: string) => {
    cleanupUserHistory(db, userId);
    const row = db.prepare(`
      SELECT history_enabled, history_interval_minutes, history_retention_days,
        history_cleared_before
      FROM users WHERE id = ?
    `).get(userId) as {
      history_enabled: number;
      history_interval_minutes: 5 | 10 | 30 | 60;
      history_retention_days: 7 | 30 | 90 | 180 | 365 | null;
      history_cleared_before: string | null;
    };
    return {
      enabled: Boolean(row.history_enabled),
      intervalMinutes: row.history_interval_minutes,
      retentionDays: row.history_retention_days,
      clearedBefore: row.history_cleared_before,
      ...historyUsage(db, userId),
      quotaBytes: config.userHistoryQuotaBytes
    };
  };

  const historyClearBoundary = (userId: string, noteId: string): string | null => {
    const row = db.prepare(`
      SELECT u.history_cleared_before AS account_boundary, m.cleared_before AS note_boundary
      FROM users u
      LEFT JOIN note_history_clear_markers m ON m.user_id = u.id AND m.note_id = ?
      WHERE u.id = ?
    `).get(noteId, userId) as { account_boundary: string | null; note_boundary: string | null } | undefined;
    if (!row) return null;
    return [row.account_boundary, row.note_boundary]
      .filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  };

  app.get("/api/account/note-history-settings", { preHandler: authenticate }, async (request) => (
    accountHistorySettings(authenticatedScope(request).userId)
  ));

  app.patch("/api/account/note-history-settings", { preHandler: authenticate }, async (request, reply) => {
    const parsed = historySettingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid note history settings" });
    const { userId } = authenticatedScope(request);
    const current = db.prepare(`
      SELECT history_enabled, history_interval_minutes, history_retention_days
      FROM users WHERE id = ?
    `).get(userId) as { history_enabled: number; history_interval_minutes: number; history_retention_days: number | null };
    db.prepare(`
      UPDATE users SET history_enabled = ?, history_interval_minutes = ?, history_retention_days = ?
      WHERE id = ?
    `).run(
      parsed.data.enabled === undefined ? current.history_enabled : parsed.data.enabled ? 1 : 0,
      parsed.data.intervalMinutes ?? current.history_interval_minutes,
      parsed.data.retentionDays === undefined ? current.history_retention_days : parsed.data.retentionDays,
      userId
    );
    return accountHistorySettings(userId);
  });

  app.get("/api/notes/:noteId/history", { preHandler: authenticate }, async (request, reply) => {
    const noteId = z.string().uuid().safeParse((request.params as { noteId: string }).noteId);
    const query = z.object({
      cursor: z.string().max(500).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50)
    }).safeParse(request.query);
    if (!noteId.success || !query.success) return reply.code(400).send({ error: "Invalid note history request" });
    const cursor = decodeHistoryCursor(query.data.cursor);
    if (query.data.cursor && !cursor) return reply.code(400).send({ error: "Invalid note history request" });
    const { userId } = authenticatedScope(request);
    cleanupUserHistory(db, userId);
    const exists = db.prepare(`
      SELECT 1 FROM objects WHERE user_id = ? AND object_id = ? AND object_type = 'note'
    `).get(userId, noteId.data);
    if (!exists) return reply.code(404).send({ error: "Note not found" });
    const select = `
      SELECT history_id, captured_at, capture_kind, metadata_ciphertext, metadata_nonce,
        metadata_encryption_version, is_protected, byte_size, created_at
      FROM note_history
      WHERE user_id = ? AND note_id = ?`;
    const rows = (cursor
      ? db.prepare(`${select}
          AND (captured_at < ? OR (captured_at = ? AND history_id < ?))
          ORDER BY captured_at DESC, history_id DESC LIMIT ?
        `).all(userId, noteId.data, cursor[0], cursor[0], cursor[1], query.data.limit + 1)
      : db.prepare(`${select}
          ORDER BY captured_at DESC, history_id DESC LIMIT ?
        `).all(userId, noteId.data, query.data.limit + 1)) as Array<HistoryRow & { history_id: string }>;
    const hasMore = rows.length > query.data.limit;
    const page = hasMore ? rows.slice(0, query.data.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        historyId: row.history_id,
        noteId: noteId.data,
        capturedAt: row.captured_at,
        captureKind: row.capture_kind,
        protected: Boolean(row.is_protected),
        ...responseMetadata(row),
        byteSize: row.byte_size,
        pending: false,
        serverCreatedAt: row.created_at
      })),
      nextCursor: hasMore && last ? encodeHistoryCursor(last.captured_at, last.history_id) : null,
      clearedBefore: historyClearBoundary(userId, noteId.data)
    };
  });

  const historyEnvelopeSchema = z.object({
    capturedAt: z.string().datetime({ offset: true }),
    captureKind: z.enum(HISTORY_CAPTURE_KINDS),
    ciphertext: envelopeField,
    nonce: z.string().min(16).max(200),
    encryptionVersion: z.literal(1),
    ...historyMetadataFields,
    protected: z.boolean().default(false),
    attachmentIds: z.array(z.string().uuid()).default([]),
    idempotencyKey: z.string().uuid()
  }).refine(hasCompleteMetadata);

  app.post("/api/notes/:noteId/history/:historyId", { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({ noteId: z.string().uuid(), historyId: z.string().uuid() }).safeParse(request.params);
    const parsed = historyEnvelopeSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: "Invalid encrypted note history" });
    const { userId } = authenticatedScope(request);
    cleanupUserHistory(db, userId);
    const prior = db.prepare(`
      SELECT note_id, history_id, is_protected FROM note_history
      WHERE user_id = ? AND idempotency_key = ?
    `).get(userId, parsed.data.idempotencyKey) as { note_id: string; history_id: string; is_protected: number } | undefined;
    if (prior) return {
      ok: true,
      idempotent: true,
      noteId: prior.note_id,
      historyId: prior.history_id,
      protected: Boolean(prior.is_protected)
    };
    const note = db.prepare(`
      SELECT 1 FROM objects WHERE user_id = ? AND object_id = ? AND object_type = 'note'
    `).get(userId, params.data.noteId);
    if (!note) return reply.code(404).send({ error: "Note not found" });
    const boundary = historyClearBoundary(userId, params.data.noteId);
    if (!parsed.data.protected && boundary && parsed.data.capturedAt <= boundary) {
      return reply.code(409).send({ error: "History snapshot was cleared", code: "HISTORY_CLEARED", clearedBefore: boundary });
    }
    const byteSize = Buffer.byteLength(parsed.data.ciphertext, "utf8")
      + Buffer.byteLength(parsed.data.metadataCiphertext ?? "", "utf8");
    const usage = historyUsage(db, userId);
    if (usage.usedBytes + byteSize > config.userHistoryQuotaBytes) {
      return reply.code(413).send({ error: "Note history quota exceeded" });
    }
    try {
      db.transaction(() => {
        db.prepare(`
          INSERT INTO note_history (
            user_id, note_id, history_id, captured_at, capture_kind, ciphertext, nonce,
            encryption_version, metadata_ciphertext, metadata_nonce, metadata_encryption_version,
            is_protected, byte_size, idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId, params.data.noteId, params.data.historyId, parsed.data.capturedAt,
          parsed.data.captureKind, parsed.data.ciphertext, parsed.data.nonce,
          parsed.data.encryptionVersion, parsed.data.metadataCiphertext ?? null,
          parsed.data.metadataNonce ?? null, parsed.data.metadataEncryptionVersion ?? null,
          parsed.data.protected ? 1 : 0, byteSize, parsed.data.idempotencyKey, new Date().toISOString()
        );
        if (parsed.data.protected) {
          const insertRef = db.prepare(`
            INSERT OR IGNORE INTO protected_history_attachments
              (user_id, note_id, history_id, attachment_id) VALUES (?, ?, ?, ?)
          `);
          for (const attachmentId of new Set(parsed.data.attachmentIds)) {
            insertRef.run(userId, params.data.noteId, params.data.historyId, attachmentId);
          }
        }
      })();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        return reply.code(409).send({ error: "History snapshot already exists" });
      }
      throw error;
    }
    return reply.code(201).send({
      ok: true,
      noteId: params.data.noteId,
      historyId: params.data.historyId,
      protected: parsed.data.protected,
      byteSize
    });
  });

  const historyMutationSchema = z.object({
    ...historyMetadataFields,
    protected: z.boolean().optional(),
    attachmentIds: z.array(z.string().uuid()).optional()
  }).refine(hasCompleteMetadata).refine((value) => (
    value.metadataCiphertext !== undefined || value.protected !== undefined
  )).refine((value) => value.protected !== true || value.attachmentIds !== undefined);

  app.patch("/api/notes/:noteId/history/:historyId", { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({ noteId: z.string().uuid(), historyId: z.string().uuid() }).safeParse(request.params);
    const parsed = historyMutationSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: "Invalid note history update" });
    const { userId } = authenticatedScope(request);
    const row = db.prepare(`
      SELECT captured_at, capture_kind, ciphertext, nonce, encryption_version,
        metadata_ciphertext, metadata_nonce, metadata_encryption_version,
        is_protected, byte_size, created_at
      FROM note_history WHERE user_id = ? AND note_id = ? AND history_id = ?
    `).get(userId, params.data.noteId, params.data.historyId) as HistoryRow | undefined;
    if (!row) return reply.code(404).send({ error: "History snapshot not found" });
    const metadataCiphertext = parsed.data.metadataCiphertext ?? row.metadata_ciphertext;
    const metadataNonce = parsed.data.metadataNonce ?? row.metadata_nonce;
    const metadataVersion = parsed.data.metadataEncryptionVersion ?? row.metadata_encryption_version;
    const nextProtected = parsed.data.protected === undefined ? Boolean(row.is_protected) : parsed.data.protected;
    const byteSize = Buffer.byteLength(row.ciphertext, "utf8") + Buffer.byteLength(metadataCiphertext ?? "", "utf8");
    const growth = Math.max(0, byteSize - row.byte_size);
    if (historyUsage(db, userId).usedBytes + growth > config.userHistoryQuotaBytes) {
      return reply.code(413).send({ error: "Note history quota exceeded" });
    }
    db.transaction(() => {
      db.prepare(`
        UPDATE note_history SET metadata_ciphertext = ?, metadata_nonce = ?,
          metadata_encryption_version = ?, is_protected = ?, byte_size = ?
        WHERE user_id = ? AND note_id = ? AND history_id = ?
      `).run(
        metadataCiphertext, metadataNonce, metadataVersion, nextProtected ? 1 : 0, byteSize,
        userId, params.data.noteId, params.data.historyId
      );
      if (parsed.data.protected !== undefined) {
        db.prepare(`
          DELETE FROM protected_history_attachments
          WHERE user_id = ? AND note_id = ? AND history_id = ?
        `).run(userId, params.data.noteId, params.data.historyId);
        if (parsed.data.protected) {
          const insertRef = db.prepare(`
            INSERT OR IGNORE INTO protected_history_attachments
              (user_id, note_id, history_id, attachment_id) VALUES (?, ?, ?, ?)
          `);
          for (const attachmentId of new Set(parsed.data.attachmentIds ?? [])) {
            insertRef.run(userId, params.data.noteId, params.data.historyId, attachmentId);
          }
        }
      }
    })();
    return { ok: true, protected: nextProtected, byteSize };
  });

  app.get("/api/notes/:noteId/history/:historyId", { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({ noteId: z.string().uuid(), historyId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "History snapshot not found" });
    const { userId } = authenticatedScope(request);
    const row = db.prepare(`
      SELECT captured_at, capture_kind, ciphertext, nonce, encryption_version,
        metadata_ciphertext, metadata_nonce, metadata_encryption_version,
        is_protected, byte_size, created_at
      FROM note_history WHERE user_id = ? AND note_id = ? AND history_id = ?
    `).get(userId, params.data.noteId, params.data.historyId) as HistoryRow | undefined;
    if (!row) return reply.code(404).send({ error: "History snapshot not found" });
    reply.header("Cache-Control", "private, no-store");
    return {
      historyId: params.data.historyId,
      noteId: params.data.noteId,
      capturedAt: row.captured_at,
      captureKind: row.capture_kind,
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      encryptionVersion: row.encryption_version,
      protected: Boolean(row.is_protected),
      ...responseMetadata(row),
      byteSize: row.byte_size,
      pending: false,
      serverCreatedAt: row.created_at
    };
  });

  app.delete("/api/notes/:noteId/history/:historyId", { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({ noteId: z.string().uuid(), historyId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "History snapshot not found" });
    const { userId } = authenticatedScope(request);
    const row = db.prepare(`
      SELECT is_protected FROM note_history WHERE user_id = ? AND note_id = ? AND history_id = ?
    `).get(userId, params.data.noteId, params.data.historyId) as { is_protected: number } | undefined;
    if (!row) return reply.code(404).send({ error: "History snapshot not found" });
    if (row.is_protected) {
      return reply.code(409).send({ error: "Protected history cannot be deleted", code: "PROTECTED_HISTORY" });
    }
    db.prepare("DELETE FROM note_history WHERE user_id = ? AND note_id = ? AND history_id = ?")
      .run(userId, params.data.noteId, params.data.historyId);
    return { ok: true };
  });

  app.delete("/api/notes/:noteId/history", { preHandler: authenticate }, async (request, reply) => {
    const noteId = z.string().uuid().safeParse((request.params as { noteId: string }).noteId);
    if (!noteId.success) return reply.code(404).send({ error: "Note not found" });
    const { userId } = authenticatedScope(request);
    const note = db.prepare(`
      SELECT 1 FROM objects WHERE user_id = ? AND object_id = ? AND object_type = 'note'
    `).get(userId, noteId.data);
    if (!note) return reply.code(404).send({ error: "Note not found" });
    const clearedBefore = new Date().toISOString();
    const result = db.transaction(() => {
      db.prepare(`
        INSERT INTO note_history_clear_markers (user_id, note_id, cleared_before)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, note_id) DO UPDATE SET cleared_before = excluded.cleared_before
      `).run(userId, noteId.data, clearedBefore);
      const deleted = db.prepare(`
        DELETE FROM note_history WHERE user_id = ? AND note_id = ? AND is_protected = 0
      `).run(userId, noteId.data).changes;
      const preserved = Number((db.prepare(`
        SELECT COUNT(*) AS count FROM note_history WHERE user_id = ? AND note_id = ? AND is_protected = 1
      `).get(userId, noteId.data) as { count: number }).count);
      return { deleted, preserved };
    })();
    return { ok: true, ...result, clearedBefore };
  });

  app.delete("/api/account/note-history", { preHandler: authenticate }, async (request) => {
    const { userId } = authenticatedScope(request);
    const clearedBefore = new Date().toISOString();
    const result = db.transaction(() => {
      db.prepare("UPDATE users SET history_cleared_before = ? WHERE id = ?").run(clearedBefore, userId);
      db.prepare("DELETE FROM note_history_clear_markers WHERE user_id = ?").run(userId);
      const deleted = db.prepare("DELETE FROM note_history WHERE user_id = ? AND is_protected = 0").run(userId).changes;
      const preserved = Number((db.prepare(`
        SELECT COUNT(*) AS count FROM note_history WHERE user_id = ? AND is_protected = 1
      `).get(userId) as { count: number }).count);
      return { deleted, preserved };
    })();
    return { ok: true, ...result, clearedBefore };
  });
}
