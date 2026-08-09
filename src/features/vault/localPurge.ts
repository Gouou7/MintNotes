import { localDb, localKey } from "../../storage/database";

export async function hasPendingLocalObjectGraph(userId: string, objectIds: ReadonlySet<string>): Promise<boolean> {
  if (!objectIds.size) return false;
  const [objects, history, historyMetadata, chunks] = await Promise.all([
    localDb.outbox.where("userId").equals(userId).toArray(),
    localDb.historyOutbox.where("userId").equals(userId).toArray(),
    localDb.historyMetadataOutbox.where("userId").equals(userId).toArray(),
    localDb.attachmentOutbox.where("userId").equals(userId).toArray()
  ]);
  return objects.some((entry) => objectIds.has(entry.objectId))
    || history.some((entry) => objectIds.has(entry.noteId))
    || historyMetadata.some((entry) => objectIds.has(entry.noteId))
    || chunks.some((entry) => objectIds.has(entry.attachmentId));
}

export async function hasPendingLocalAuxiliaryData(userId: string, objectId: string): Promise<boolean> {
  const [history, historyMetadata, chunks] = await Promise.all([
    localDb.historyOutbox.where("[userId+noteId]").equals([userId, objectId]).count(),
    localDb.historyMetadataOutbox.where("[userId+noteId]").equals([userId, objectId]).count(),
    localDb.attachmentOutbox.where("[userId+attachmentId]").equals([userId, objectId]).count()
  ]);
  return history > 0 || historyMetadata > 0 || chunks > 0;
}

export async function removePurgedLocalData(userId: string, objectId: string): Promise<void> {
  await localDb.transaction("rw", [
    localDb.objects,
    localDb.outbox,
    localDb.attachmentChunks,
    localDb.attachmentOutbox,
    localDb.historySnapshots,
    localDb.historyIndex,
    localDb.historyOutbox,
    localDb.historyMetadataOutbox
  ], async () => {
    await localDb.objects.delete(localKey(userId, objectId));
    await localDb.outbox.delete(localKey(userId, objectId));
    await localDb.attachmentChunks.where("[userId+attachmentId]").equals([userId, objectId]).delete();
    await localDb.attachmentOutbox.where("[userId+attachmentId]").equals([userId, objectId]).delete();
    await localDb.historySnapshots.where("[userId+noteId]").equals([userId, objectId]).delete();
    await localDb.historyIndex.where("[userId+noteId]").equals([userId, objectId]).delete();
    await localDb.historyOutbox.where("[userId+noteId]").equals([userId, objectId]).delete();
    await localDb.historyMetadataOutbox.where("[userId+noteId]").equals([userId, objectId]).delete();
  });
}
