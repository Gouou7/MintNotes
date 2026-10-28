import { localDb } from "../../storage/database";
import { cryptoClient } from "../../crypto/client";
import type { OpenDocument, OpenAttachment, EncryptedAttachmentChunk } from "../../types";
import { exportMarkdownZip } from "../importExport";

/** Explicit user export; plaintext is created only while unlocked and is never cached. */
export async function exportRecoveryCopies(userId: string, active: () => boolean) {
  const records = await localDb.recoveries.where("userId").equals(userId).toArray();
  const documents: OpenDocument[] = [], attachments = new Map<string, OpenAttachment>();
  const chunks = new Map<string, EncryptedAttachmentChunk[]>();
  for (const record of records) {
    if (!active()) throw new DOMException("Cancelled", "AbortError");
    const source = record.source;
    const plain = await cryptoClient.decryptObject(userId, source.objectId, source.objectType, source.revision, source.ciphertext, source.nonce, source);
    if (plain.kind !== "note") continue;
    documents.push({ ...plain, objectId: crypto.randomUUID(), title: plain.title, parentId: null, deleted: false, serverRevision: 0, dirty: false });
    for (const object of record.attachments) {
      const metadata = await cryptoClient.decryptObject(userId, object.objectId, object.objectType, object.revision, object.ciphertext, object.nonce, object);
      if (metadata.kind !== "attachment") throw new Error("Invalid recovery attachment");
      attachments.set(object.objectId, { ...metadata, objectId: object.objectId, deleted: false, serverRevision: object.revision, dirty: false });
      chunks.set(object.objectId, record.chunks.filter((chunk) => chunk.attachmentId === object.objectId));
    }
  }
  if (!active()) throw new DOMException("Cancelled", "AbortError");
  await exportMarkdownZip(documents, [...attachments.values()], async (attachment) => {
    const bytes = await cryptoClient.decryptAttachment(userId, attachment.objectId, attachment, structuredClone(chunks.get(attachment.objectId) ?? []));
    if (!active()) throw new DOMException("Cancelled", "AbortError");
    return new Blob([bytes], { type: attachment.mime });
  }, null, active);
}
