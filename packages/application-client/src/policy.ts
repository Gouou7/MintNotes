import { ApplicationError, type ApplicationAccess } from "./protocol.js";
import type { VaultDocument, VaultObject } from "./types.js";

export function noteAccess(document: VaultDocument, access: ApplicationAccess) {
  // Future privacy policy belongs here. The current vault key is shared by
  // all objects, so this policy is not a cryptographic note-level boundary.
  return { canRead: !document.deleted, canWrite: document.kind === "note" && access === "read-write" && !document.deleted && !document.locked };
}

export function assertWritableNote(document: VaultDocument, access: ApplicationAccess): void {
  if (access !== "read-write") throw new ApplicationError("APPLICATION_READ_ONLY", "Application is read-only", 403);
  if (document.kind !== "note" || !noteAccess(document, access).canRead) throw new ApplicationError("NOTE_NOT_FOUND", "Note not found", 404);
  if (document.locked) throw new ApplicationError("NOTE_LOCKED", "Locked notes are read-only", 403);
}

export { attachmentIdsIn as attachmentReferences } from "./attachmentFormat.js";

export function validateVaultObject(value: unknown, type: string): VaultObject {
  if (!value || typeof value !== "object") throw new ApplicationError("INVALID_OBJECT", "Invalid encrypted object");
  const object = value as Record<string, unknown>;
  if ((type === "note" || type === "folder") && object.locked === undefined) object.locked = false;
  if (object.schemaVersion !== 2 || object.kind !== type || typeof object.deleted !== "boolean"
    || typeof object.createdAt !== "string" || typeof object.updatedAt !== "string") {
    throw new ApplicationError("INVALID_OBJECT", "Unsupported or invalid encrypted object");
  }
  const strings = (item: unknown) => Array.isArray(item) && item.every((entry) => typeof entry === "string");
  if (type === "note" || type === "folder") {
    if (typeof object.title !== "string" || typeof object.markdown !== "string"
      || !(object.parentId === null || typeof object.parentId === "string")
      || !strings(object.tags) || !strings(object.attachmentIds)
      || typeof object.favorite !== "boolean" || typeof object.locked !== "boolean"
      || typeof object.manualOrder !== "number" || !Number.isFinite(object.manualOrder)) {
      throw new ApplicationError("INVALID_OBJECT", "Invalid note document");
    }
  } else if (type === "attachment") {
    if (typeof object.ownerNoteId !== "string" || typeof object.originalName !== "string"
      || !["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(String(object.mime))
      || typeof object.attachmentKey !== "string" || typeof object.sha256 !== "string"
      || !Number.isSafeInteger(object.size) || Number(object.size) < 0 || Number(object.size) > 25 * 1024 * 1024
      || !Number.isSafeInteger(object.chunkCount) || Number(object.chunkCount) < 1 || Number(object.chunkCount) > 25
      || object.chunkSize !== 1024 * 1024) {
      throw new ApplicationError("INVALID_OBJECT", "Invalid attachment metadata");
    }
  } else throw new ApplicationError("INVALID_OBJECT", "Unknown object type");
  return value as VaultObject;
}
