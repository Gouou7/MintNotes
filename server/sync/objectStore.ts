import { StorageQuotaError, assertStorageGrowth } from "../storageQuota.js";
import { z } from "zod";
import type { AppDatabase } from "../database.js";
import type { ObjectScope } from "../types.js";
import { createHash } from "node:crypto";
import { metadataUsage } from "../storageUsage.js";
import { operationKeySchema, recordChange, requireLiveOperation } from "./lifecycle.js";

const envelopeField = z.string().min(16).max(2_000_000);

const objectFields = z.object({
  objectType: z.enum(["note", "folder", "attachment"]),
  ciphertext: envelopeField,
  nonce: z.string().min(16).max(200),
  encryptionVersion: z.number().int().positive(),
  baseRevision: z.number().int().nonnegative(),
  idempotencyKey: operationKeySchema,
  ownerNoteId: z.string().uuid().optional(),
  deleted: z.boolean().default(false)
});
const validOwner = (body: { objectType: string; ownerNoteId?: string }) => body.objectType === "attachment" ? Boolean(body.ownerNoteId) : body.ownerNoteId === undefined;
export const objectSchema = objectFields.refine(validOwner, { message: "Invalid attachment ownership" });

export const objectBatchSchema = z.object({
  objects: z.array(objectFields.extend({ objectId: z.string().uuid() }).refine(validOwner)).min(1).max(50)
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

class ObjectOwnershipError extends Error {
  readonly statusCode = 409;
  readonly code = "ATTACHMENT_OWNERSHIP_CONFLICT";
}
export { StorageQuotaError } from "../storageQuota.js";

export function writeObject(
  db: AppDatabase,
  scope: ObjectScope,
  objectId: string,
  body: ObjectWrite,
  quotaBytes: number
): ObjectWriteResult {
  return db.transaction((): ObjectWriteResult => {
    const userId = scope.userId;
    requireLiveOperation(body.idempotencyKey);
    const digest = createHash("sha256").update(JSON.stringify([objectId, body.objectType, body.ciphertext,
      body.nonce, body.encryptionVersion, body.baseRevision, body.deleted, body.ownerNoteId ?? null])).digest("hex");
    const prior = db.prepare("SELECT object_id, digest, revision FROM sync_receipts WHERE user_id = ? AND operation_id = ?")
      .get(userId, body.idempotencyKey) as { object_id: string; digest: string; revision: number } | undefined;
    if (prior) return prior.object_id === objectId && prior.digest === digest
      ? { objectId, status: "idempotent", revision: prior.revision }
      : { objectId, status: "conflict", currentRevision: prior.revision, reason: "idempotency" };
    const current = db.prepare("SELECT *, LENGTH(CAST(ciphertext AS BLOB)) + LENGTH(CAST(nonce AS BLOB)) AS bytes FROM objects WHERE user_id = ? AND object_id = ?")
      .get(userId, objectId) as { revision: number; object_type: string; bytes: number; deleted: number; trashed_at: string | null; owner_note_id: string | null } | undefined;
    if (current && current.object_type !== body.objectType) return { objectId, status: "conflict", currentRevision: current.revision, reason: "objectType" };
    const revision = current?.revision ?? 0;
    if (revision !== body.baseRevision || (!current && db.prepare("SELECT 1 FROM changes WHERE user_id = ? AND object_id = ? AND change_type = 'purge'").get(userId, objectId))) {
      return { objectId, status: "conflict", currentRevision: revision, reason: "revision" };
    }
    if (body.objectType !== "attachment" && body.ownerNoteId) throw new ObjectOwnershipError("ATTACHMENT_OWNER_INVALID");
    if (body.objectType === "attachment" && !body.ownerNoteId) throw new ObjectOwnershipError("ATTACHMENT_OWNER_REQUIRED");
    if (current?.owner_note_id && current.owner_note_id !== body.ownerNoteId) throw new ObjectOwnershipError("ATTACHMENT_OWNER_IMMUTABLE");
    if (body.ownerNoteId && !(current && body.deleted) && db.prepare("SELECT 1 FROM changes WHERE user_id = ? AND object_id = ? AND change_type = 'purge'").get(userId, body.ownerNoteId)) return { objectId, status: "conflict", currentRevision: revision, reason: "revision" };
    if (body.ownerNoteId && db.prepare("SELECT 1 FROM objects WHERE user_id = ? AND object_id = ? AND object_type != 'note'").get(userId, body.ownerNoteId)) throw new ObjectOwnershipError("ATTACHMENT_OWNER_INVALID");
    const growth = Buffer.byteLength(body.ciphertext) + Buffer.byteLength(body.nonce) - (current?.bytes ?? 0);
    // Tombstones and non-growing replacements must remain possible above quota.
    if (!(current && !current.deleted && body.deleted && growth <= 1024)) assertStorageGrowth(db, userId, growth, quotaBytes);
    // Every live object reserves two metadata slots for its eventual purge and receipt.
    const metadata = metadataUsage(db, userId);
    if (!(current && !current.deleted && body.deleted) && metadata.metadataUsedSlots + (current ? 1 : 4) > metadata.metadataLimit) throw new StorageQuotaError("Synchronization metadata quota exceeded", "METADATA_QUOTA_EXCEEDED");
    const now = new Date().toISOString();
    if (current?.deleted && !body.deleted && current.trashed_at) {
      db.prepare(`UPDATE note_history SET retention_at = strftime('%Y-%m-%dT%H:%M:%fZ',
        julianday(COALESCE(retention_at, captured_at)) + MAX(0, julianday(?) - MAX(julianday(?), julianday(captured_at))))
        WHERE user_id = ? AND note_id = ?`).run(now, current.trashed_at, userId, objectId);
      db.prepare("UPDATE note_trash_periods SET restored_at = ? WHERE user_id = ? AND note_id = ? AND restored_at IS NULL").run(now, userId, objectId);

    }
    db.prepare(`INSERT INTO objects (user_id, object_id, object_type, ciphertext, nonce, encryption_version, revision, deleted, updated_at, trashed_at, owner_note_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, object_id) DO UPDATE SET ciphertext = excluded.ciphertext, nonce = excluded.nonce,
        encryption_version = excluded.encryption_version, revision = excluded.revision, deleted = excluded.deleted,
        updated_at = excluded.updated_at, owner_note_id = COALESCE(objects.owner_note_id, excluded.owner_note_id),
        trashed_at = CASE WHEN excluded.deleted = 0 THEN NULL ELSE COALESCE(objects.trashed_at, excluded.trashed_at) END,
        trash_grace_until = CASE WHEN excluded.deleted = 0 THEN NULL ELSE objects.trash_grace_until END`)
      .run(userId, objectId, body.objectType, body.ciphertext, body.nonce, body.encryptionVersion, revision + 1, Number(body.deleted), now, body.deleted ? now : null, body.ownerNoteId ?? null);
    if (body.objectType === "note" && body.deleted && !current?.deleted) {
      db.prepare("INSERT INTO note_trash_periods(user_id, note_id, entered_at) VALUES (?, ?, ?)").run(userId, objectId, now);
    }
    if (body.ownerNoteId) {
      const priorOwner = db.prepare("SELECT note_id FROM attachment_owners WHERE user_id = ? AND attachment_id = ?").get(userId, objectId) as { note_id: string } | undefined;
      if (priorOwner && priorOwner.note_id !== body.ownerNoteId) throw new ObjectOwnershipError("ATTACHMENT_OWNER_IMMUTABLE");
      db.prepare("INSERT OR IGNORE INTO attachment_owners VALUES (?, ?, ?)").run(userId, objectId, body.ownerNoteId);
      if (!current?.owner_note_id) db.prepare(`INSERT INTO ownership_versions VALUES (?, ?, 1)
        ON CONFLICT(user_id, note_id) DO UPDATE SET version = version + 1`).run(userId, body.ownerNoteId);
      db.prepare(`INSERT INTO ownership_state(user_id, complete, version) VALUES (?, 1, 1)
        ON CONFLICT(user_id) DO UPDATE SET version = version + 1`).run(userId);
      db.prepare("DELETE FROM attachment_gc WHERE user_id = ? AND note_id = ?").run(userId, body.ownerNoteId);
    }
    db.prepare("DELETE FROM attachment_gc WHERE user_id = ? AND note_id = ?").run(userId, objectId);
    db.prepare("INSERT INTO sync_receipts(user_id, operation_id, object_id, digest, revision, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(userId, body.idempotencyKey, objectId, digest, revision + 1, now);
    const sequence = recordChange(db, userId, objectId, revision + 1, "upsert", now);
    return { objectId, status: "accepted", revision: revision + 1, sequence };
  }).immediate();
}
