import type { LocalEncryptedObject, OutboxEntry } from "../storage/database";
import type { OpenAttachment, OpenDocument, VaultObject } from "../types";

export function decryptFailureFingerprint(object: LocalEncryptedObject): string {
  return `${object.objectId}:${object.revision}:${object.nonce}`;
}

export async function decryptAvailableLocalObjects(
  stored: LocalEncryptedObject[],
  pendingByKey: Map<string, OutboxEntry>,
  decrypt: (object: LocalEncryptedObject) => Promise<VaultObject>
): Promise<{ documents: OpenDocument[]; attachments: OpenAttachment[]; failed: LocalEncryptedObject[] }> {
  const documents: OpenDocument[] = [];
  const attachments: OpenAttachment[] = [];
  const failed: LocalEncryptedObject[] = [];
  for (const object of stored) {
    try {
      const decrypted = await decrypt(object);
      const pending = pendingByKey.get(object.key);
      const open = { ...decrypted, objectId: object.objectId, serverRevision: pending?.baseRevision ?? object.revision, dirty: Boolean(pending) };
      if (decrypted.kind === "attachment") attachments.push(open as OpenAttachment);
      else documents.push(open as OpenDocument);
    } catch {
      failed.push(object);
    }
  }
  return { documents, attachments, failed };
}
