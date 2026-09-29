import { cryptoClient } from "../../crypto/client";
import { localDb, localKey, type LocalEncryptedObject, type OutboxEntry } from "../../storage/database";
import type { OpenDocument } from "../../types";
import { prepareLocalAttachment, writePreparedAttachment, type PreparedAttachment } from "../attachments";
import { rewriteMarkdownImages, type MarkdownImage } from "../markdownImages";
import type { ImportNote } from "../importPlan";

export async function persistImportedDocument(userId: string, document: OpenDocument, input: ImportNote | undefined, isActive: () => boolean) {
  const check = () => { if (!isActive()) throw new DOMException("Import cancelled", "AbortError"); };
  check();
  const attachments = new Map<string, PreparedAttachment>();
  const replacements = new Map<MarkdownImage, string>();
  for (const [reference, image] of input?.images ?? []) {
    check();
    let prepared = attachments.get(image.key);
    if (!prepared) {
      prepared = await prepareLocalAttachment(userId, document.objectId, image.file, isActive);
      attachments.set(image.key, prepared);
    }
    replacements.set(reference, `webmd-attachment:${prepared.attachment.objectId}`);
  }
  const next: OpenDocument = { ...document, markdown: rewriteMarkdownImages(document.markdown, replacements), attachmentIds: [...attachments.values()].map((entry) => entry.attachment.objectId) };
  const { objectId, dirty: _dirty, serverRevision: _revision, ...plain } = next;
  const encrypted = await cryptoClient.encryptObject(userId, objectId, next.kind, 1, plain);
  check();
  const object: LocalEncryptedObject = {
    key: localKey(userId, objectId), userId, objectId, objectType: next.kind,
    ...encrypted, revision: 1, deleted: false, updatedAt: next.updatedAt
  };
  const outbox: OutboxEntry = { ...object, operation: "upsert", baseRevision: 0, idempotencyKey: crypto.randomUUID(), generation: Date.now() * 1000 };
  // All IDs are new and unpublished, so no existing object's write lane can race this transaction.
  await localDb.transaction("rw", [localDb.objects, localDb.outbox, localDb.attachmentChunks, localDb.attachmentOutbox], async () => {
    check();
    for (const prepared of attachments.values()) { await writePreparedAttachment(prepared); check(); }
    await localDb.objects.add(object);
    await localDb.outbox.add(outbox);
    check();
  });
  return { document: next, attachments: [...attachments.values()].map((entry) => entry.attachment) };
}
