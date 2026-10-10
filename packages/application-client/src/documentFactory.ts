import type { OpenDocument } from "./types.js";
import { nextManualOrder } from "./siblingNames.js";

export function makeDocument(
  documents: OpenDocument[],
  kind: "note" | "folder",
  title: string,
  parentId: string | null,
  markdown = ""
): OpenDocument {
  const now = new Date().toISOString();
  return {
    objectId: crypto.randomUUID(),
    kind,
    title,
    markdown,
    parentId,
    tags: [],
    favorite: false,
    locked: false,
    deleted: false,
    createdAt: now,
    updatedAt: now,
    manualOrder: nextManualOrder(documents, parentId),
    attachmentIds: [],
    schemaVersion: 2,
    serverRevision: 0,
    dirty: true
  };
}
