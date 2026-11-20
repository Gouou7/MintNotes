import { createHash } from "node:crypto";
import { z } from "zod";
import type { AppDatabase } from "../database.js";
import { assertStorageGrowth, StorageQuotaError } from "../storageQuota.js";

export const catalogSchema = z.object({
  ciphertext: z.string().regex(/^[A-Za-z0-9_-]+$/).min(23).max(65_536),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  sourceDigest: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
}).strict();

export function catalogMatches(catalog: z.infer<typeof catalogSchema>, ciphertext: string, nonce: string): boolean {
  return catalog.sourceDigest === createHash("sha256").update(JSON.stringify([ciphertext, nonce])).digest("base64url");
}

/** The optional acceleration may use spare quota without making an eligible note write fail. */
export function insertCatalog(db: AppDatabase, userId: string, noteId: string, revision: number, catalog: z.infer<typeof catalogSchema>, quota: number): boolean {
  const bytes = catalog.ciphertext.length + catalog.nonce.length + catalog.sourceDigest.length;
  try { assertStorageGrowth(db, userId, bytes, quota); }
  catch (error) { if (error instanceof StorageQuotaError) return false; throw error; }
  return Boolean(db.prepare("INSERT OR IGNORE INTO note_catalog VALUES (?, ?, ?, ?, ?, ?)")
    .run(userId, noteId, revision, catalog.ciphertext, catalog.nonce, catalog.sourceDigest).changes);
}
