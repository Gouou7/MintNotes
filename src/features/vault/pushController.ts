import { ApiError, api, uploadAttachmentChunk } from "../../api";
import { localDb, type ObjectUploadAttempt } from "../../storage/database";
import { ATTACHMENT_TRANSFER_CONCURRENCY } from "../attachments";
import { mapWithConcurrency } from "../concurrency";
import { packBySerializedSize } from "../syncCoordinator";
import { shouldSynchronizeWorkspaceObject } from "../workspace";

interface PushControllerDependencies {
  userId: string;
  clientId: string;
  isActive: () => boolean;
  acknowledge: (entry: ObjectUploadAttempt, revision: number) => Promise<void>;
  onConflict: () => Promise<void>;
  pushHistory: () => Promise<boolean>;
  pushHistoryMetadata: () => Promise<boolean>;
}

type WriteResult =
  | { objectId: string; status: "accepted" | "idempotent"; revision: number }
  | { objectId: string; status: "conflict"; currentRevision: number; reason: string };

function payload(entry: ObjectUploadAttempt) {
  const { objectId, objectType, ciphertext, nonce, encryptionVersion, baseRevision, idempotencyKey, deleted } = entry;
  return { objectId, objectType, ciphertext, nonce, encryptionVersion, baseRevision, idempotencyKey, deleted };
}

/** Snapshot dependency graphs together; retain exact requests through response loss and later edits. */
export async function pushVaultPending(dependencies: PushControllerDependencies): Promise<void> {
  const { userId, isActive } = dependencies;
  if (!isActive()) return;
  const snapshot = await localDb.transaction("rw", localDb.objects, localDb.outbox, localDb.attachmentOutbox, async () => {
    const entries: ObjectUploadAttempt[] = [];
    const pending = await localDb.outbox.where("userId").equals(userId).sortBy("generation");
    for (const current of pending) {
      if (!isActive()) break;
      if (!shouldSynchronizeWorkspaceObject(current.objectId)) {
        await localDb.objects.delete(current.key);
        await localDb.outbox.delete(current.key);
      } else if (current.operation === "purge") {
        await localDb.outbox.delete(current.key);
      } else {
        const { upload: _upload, ...attempt } = current;
        const upload = current.upload ?? attempt;
        if (!current.upload) await localDb.outbox.put({ ...current, upload });
        entries.push(upload);
      }
    }
    return { entries, chunks: await localDb.attachmentOutbox.where("userId").equals(userId).sortBy("generation") };
  });
  await mapWithConcurrency(snapshot.chunks, ATTACHMENT_TRANSFER_CONCURRENCY, async (entry) => {
    if (!isActive()) return;
    await uploadAttachmentChunk(`/api/attachments/${entry.attachmentId}/chunks/${entry.chunkIndex}`, entry.ciphertext, {
      "X-WebMD-Nonce": entry.nonce,
      "X-WebMD-Total-Chunks": String(entry.totalChunks),
      "X-WebMD-Encryption-Version": String(entry.encryptionVersion),
      "X-WebMD-Idempotency-Key": entry.idempotencyKey,
      "X-WebMD-Sync-Client": dependencies.clientId
    });
    if (!isActive()) return;
    await localDb.transaction("rw", localDb.attachmentOutbox, async () => {
      const current = await localDb.attachmentOutbox.get(entry.key);
      if (isActive() && current?.idempotencyKey === entry.idempotencyKey) await localDb.attachmentOutbox.delete(entry.key);
    });
  });
  let conflictDetected = false;
  const conflict = async (entry: ObjectUploadAttempt) => {
    conflictDetected = true;
    await localDb.transaction("rw", localDb.outbox, async () => {
      const current = await localDb.outbox.get(entry.key);
      if (isActive() && current?.upload?.idempotencyKey === entry.idempotencyKey) {
        const { upload: _upload, ...rest } = current;
        await localDb.outbox.put(rest);
      }
    });
  };
  // A note is eligible only after this snapshot's attachment manifests are accepted.
  for (const entries of [
    snapshot.entries.filter((entry) => entry.objectType === "attachment"),
    snapshot.entries.filter((entry) => entry.objectType !== "attachment")
  ]) {
    if (!isActive() || conflictDetected) break;
    const packed = packBySerializedSize(entries, (batch) => JSON.stringify({ objects: batch.map(payload) }));
    for (const batch of packed.batches) {
      if (!isActive()) return;
      const response = await api<{ results: WriteResult[] }>("/api/objects/batch", {
        method: "POST", headers: { "X-WebMD-Sync-Client": dependencies.clientId },
        body: JSON.stringify({ objects: batch.map(payload) })
      });
      if (!isActive()) return;
      if (response.results.length !== batch.length || response.results.some((result, index) => result.objectId !== batch[index].objectId)) {
        throw new Error("Invalid object upload results");
      }
      for (let index = 0; index < batch.length; index += 1) {
        const result = response.results[index];
        if (result.status === "conflict") await conflict(batch[index]);
        else await dependencies.acknowledge(batch[index], result.revision);
      }
    }
    for (const entry of packed.oversized) {
      if (!isActive()) return;
      try {
        const response = await api<{ revision: number }>(`/api/objects/${entry.objectId}`, {
          method: "PUT", headers: { "X-WebMD-Sync-Client": dependencies.clientId }, body: JSON.stringify(payload(entry))
        });
        if (isActive()) await dependencies.acknowledge(entry, response.revision);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) await conflict(entry);
        else throw error;
      }
    }
  }
  if (!isActive()) return;
  if (conflictDetected) await dependencies.onConflict();
  await dependencies.pushHistory();
  await dependencies.pushHistoryMetadata();
}
