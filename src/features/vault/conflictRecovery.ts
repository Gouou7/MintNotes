import { localDb, localKey, type OutboxEntry } from "../../storage/database";

/** Persist the source and its local attachment graph before copying or replacing anything. */
export async function reserveConflictRecovery(userId: string, source: OutboxEntry, attachmentIds: readonly string[] = [], active: () => boolean = () => true) {
  const key = localKey(userId, source.idempotencyKey);
  return localDb.transaction("rw", [localDb.recoveries, localDb.objects, localDb.attachmentChunks], async () => {
    if (!active()) throw new DOMException("Inactive vault", "AbortError");
    const existing = await localDb.recoveries.get(key);
    if (existing) return existing;
    const objects = await localDb.objects.where("userId").equals(userId).toArray();
    const requested = new Set(attachmentIds);
    const attachments = objects.filter((object) => object.objectType === "attachment"
      && (object.ownerNoteId === source.objectId || requested.has(object.objectId)
        || (source.objectType !== "attachment" && !object.ownerNoteId)));
    const ids = new Set(attachments.map((object) => object.objectId));
    const chunks = (await localDb.attachmentChunks.where("userId").equals(userId).toArray())
      .filter((chunk) => ids.has(chunk.attachmentId));
    const record = { key, userId, sourceId: source.objectId, source, copyId: crypto.randomUUID(), attachments, chunks };
    if (!active()) throw new DOMException("Inactive vault", "AbortError");
    await localDb.recoveries.add(record);
    return record;
  });
}

/** Missing cache rows may be restored from the encrypted journal without replacing newer rows. */
export async function restoreRecoveryChunks(record: import("../../storage/database").RecoveryRecord, active: () => boolean = () => true) {
  await localDb.transaction("rw", localDb.attachmentChunks, async () => {
    for (const chunk of record.chunks) {
      if (!active()) throw new DOMException("Inactive vault", "AbortError");
      if (!await localDb.attachmentChunks.get(chunk.key)) await localDb.attachmentChunks.add(chunk);
    }
  });
}

/** The source may be released only after every copied dependency is remotely acknowledged. */
export async function completeConflictRecoveries(userId: string, active: () => boolean = () => true) {
  await localDb.transaction("rw", [localDb.recoveries, localDb.objects, localDb.outbox, localDb.attachmentOutbox], async () => {
    for (const record of await localDb.recoveries.where("userId").equals(userId).toArray()) {
      if (!active()) return;
      const copy = await localDb.objects.get(localKey(userId, record.copyId));
      if (!copy || await localDb.outbox.get(copy.key)) continue;
      const objects = await localDb.objects.where("userId").equals(userId).toArray();
      const children = objects.filter((object) => object.ownerNoteId === record.copyId);
      let pending = false;
      for (const child of children) if (await localDb.outbox.get(child.key)
        || await localDb.attachmentOutbox.where("[userId+attachmentId]").equals([userId, child.objectId]).count()) pending = true;
      if (!pending && active()) await localDb.recoveries.delete(record.key);
    }
  });
}
