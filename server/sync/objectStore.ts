import { z } from "zod";
import type { AppDatabase } from "../database.js";
import type { AuthenticatedScope } from "../types.js";

const envelopeField = z.string().min(16).max(2_000_000);

export const objectSchema = z.object({
  objectType: z.enum(["note", "folder", "attachment"]),
  ciphertext: envelopeField,
  nonce: z.string().min(16).max(200),
  encryptionVersion: z.number().int().positive(),
  baseRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().uuid(),
  deleted: z.boolean().default(false)
});

export const objectBatchSchema = z.object({
  objects: z.array(objectSchema.extend({ objectId: z.string().uuid() })).min(1).max(50)
}).superRefine(({ objects }, context) => {
  const seen = new Set<string>();
  objects.forEach((object, index) => {
    if (seen.has(object.objectId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate object ID",
        path: ["objects", index, "objectId"]
      });
    }
    seen.add(object.objectId);
  });
});

export type ObjectWrite = z.infer<typeof objectSchema>;
export type ObjectWriteResult =
  | { objectId: string; status: "accepted"; revision: number; sequence: number }
  | { objectId: string; status: "idempotent"; revision: number }
  | { objectId: string; status: "conflict"; currentRevision: number; reason: "revision" | "objectType" | "idempotency" };

export class StorageQuotaError extends Error {
  constructor() {
    super("User storage quota exceeded");
  }
}

export function writeObject(
  db: AppDatabase,
  scope: AuthenticatedScope,
  objectId: string,
  body: ObjectWrite,
  quotaBytes: number
): ObjectWriteResult {
  const userId = scope.userId;
  const priorIdempotent = db.prepare(
    `SELECT object_id, object_type, ciphertext, nonce, encryption_version, revision, deleted
     FROM object_revisions WHERE user_id = ? AND idempotency_key = ?`
  ).get(userId, body.idempotencyKey) as {
    object_id: string; object_type: string; ciphertext: string; nonce: string;
    encryption_version: number; revision: number; deleted: number;
  } | undefined;
  if (priorIdempotent) {
    const matches = priorIdempotent.object_id === objectId
      && priorIdempotent.object_type === body.objectType
      && priorIdempotent.ciphertext === body.ciphertext
      && priorIdempotent.nonce === body.nonce
      && priorIdempotent.encryption_version === body.encryptionVersion
      && priorIdempotent.revision - 1 === body.baseRevision
      && Boolean(priorIdempotent.deleted) === body.deleted;
    if (!matches) {
      return { objectId, status: "conflict", currentRevision: priorIdempotent.revision, reason: "idempotency" };
    }
    return {
      objectId: priorIdempotent.object_id,
      status: "idempotent",
      revision: priorIdempotent.revision
    };
  }
  const current = db.prepare(
    "SELECT revision, object_type FROM objects WHERE user_id = ? AND object_id = ?"
  ).get(userId, objectId) as { revision: number; object_type: string } | undefined;
  if (current && current.object_type !== body.objectType) {
    return {
      objectId,
      status: "conflict",
      currentRevision: current.revision,
      reason: "objectType"
    };
  }
  const currentRevision = current?.revision ?? 0;
  if (currentRevision !== body.baseRevision) {
    return { objectId, status: "conflict", currentRevision, reason: "revision" };
  }
  const usedBytes = Number((db.prepare(`
    SELECT
      COALESCE((SELECT SUM(LENGTH(ciphertext) + LENGTH(nonce)) FROM object_revisions WHERE user_id = ?), 0)
      + COALESCE((SELECT SUM(LENGTH(ciphertext) + LENGTH(nonce)) FROM attachment_chunks WHERE user_id = ?), 0)
      AS bytes
  `).get(userId, userId) as { bytes: number }).bytes);
  if (usedBytes + Buffer.byteLength(body.ciphertext, "utf8") + Buffer.byteLength(body.nonce, "utf8") > quotaBytes) {
    throw new StorageQuotaError();
  }
  const revision = currentRevision + 1;
  const now = new Date().toISOString();
  const sequence = db.transaction(() => {
    db.prepare(`
      INSERT INTO object_revisions (
        user_id, object_id, object_type, ciphertext, nonce, encryption_version,
        revision, deleted, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      objectId,
      body.objectType,
      body.ciphertext,
      body.nonce,
      body.encryptionVersion,
      revision,
      body.deleted ? 1 : 0,
      body.idempotencyKey,
      now
    );
    db.prepare(`
      INSERT INTO objects (
        user_id, object_id, object_type, ciphertext, nonce,
        encryption_version, revision, deleted, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, object_id) DO UPDATE SET
        object_type = excluded.object_type,
        ciphertext = excluded.ciphertext,
        nonce = excluded.nonce,
        encryption_version = excluded.encryption_version,
        revision = excluded.revision,
        deleted = excluded.deleted,
        updated_at = excluded.updated_at
    `).run(
      userId,
      objectId,
      body.objectType,
      body.ciphertext,
      body.nonce,
      body.encryptionVersion,
      revision,
      body.deleted ? 1 : 0,
      now
    );
    return Number(db.prepare(
      "INSERT INTO changes (user_id, object_id, revision, change_type, created_at) VALUES (?, ?, ?, 'upsert', ?)"
    ).run(userId, objectId, revision, now).lastInsertRowid);
  })();
  return { objectId, status: "accepted", revision, sequence };
}
