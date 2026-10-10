import { cryptoClient } from "../../crypto/client";
import { localDb, type ObjectUploadAttempt, type OutboxEntry } from "../../storage/database";
import type { VaultObject } from "../../types";

export type OutboxAcknowledgement =
  | { status: "missing" }
  | { status: "acknowledged"; object: VaultObject }
  | { status: "rebased"; entry: OutboxEntry; object: VaultObject };

interface OutboxCryptoPort {
  decryptObject: typeof cryptoClient.decryptObject;
  encryptObject: typeof cryptoClient.encryptObject;
}

export function sameOutboxEntry(left: OutboxEntry | undefined, right: OutboxEntry | undefined): boolean {
  return left === right || Boolean(left && right
    && left.idempotencyKey === right.idempotencyKey && left.generation === right.generation
    && left.baseRevision === right.baseRevision && left.ciphertext === right.ciphertext
    && left.nonce === right.nonce && left.revision === right.revision && left.objectType === right.objectType
    && left.encryptionVersion === right.encryptionVersion && left.deleted === right.deleted
    && left.operation === right.operation && left.upload?.idempotencyKey === right.upload?.idempotencyKey);
}

/** Runs in the object's write lane; compare-and-retry also protects against another tab. */
export async function acknowledgeOutboxEntry(
  userId: string,
  sent: ObjectUploadAttempt,
  acceptedRevision: number,
  nextGeneration: () => number,
  crypto: OutboxCryptoPort = cryptoClient,
  isActive: () => boolean = () => true
): Promise<OutboxAcknowledgement> {
  if (acceptedRevision !== sent.revision) throw new Error("Unexpected accepted object revision");
  while (isActive()) {
    const current = await localDb.outbox.get(sent.key);
    if (!current) return { status: "missing" };
    const object = await crypto.decryptObject(
      userId, current.objectId, current.objectType, current.revision, current.ciphertext, current.nonce
    );
    const matchesSent = current.idempotencyKey === sent.idempotencyKey;
    let rebased: OutboxEntry | undefined;
    if (!matchesSent) {
      if (current.baseRevision >= acceptedRevision) {
        const { upload: _upload, ...rest } = current;
        rebased = current.upload?.idempotencyKey === sent.idempotencyKey ? rest : current;
      } else {
        const encrypted = await crypto.encryptObject(
          userId, current.objectId, current.objectType, acceptedRevision + 1, object
        );
        rebased = {
          key: current.key, userId, objectId: current.objectId, objectType: current.objectType,
          ...encrypted, revision: acceptedRevision + 1, deleted: current.deleted, updatedAt: current.updatedAt,
          operation: "upsert", baseRevision: acceptedRevision,
          idempotencyKey: globalThis.crypto.randomUUID(), generation: nextGeneration()
        };
      }
    }
    if (!isActive()) return { status: "missing" };
    let committed = false;
    await localDb.transaction("rw", localDb.objects, localDb.outbox, async () => {
      if (!isActive() || !sameOutboxEntry(await localDb.outbox.get(sent.key), current)) return;
      if (rebased) {
        const { operation: _operation, baseRevision: _base, idempotencyKey: _id, generation: _generation, upload: _upload, ...stored } = rebased;
        await localDb.objects.put(stored);
        await localDb.outbox.put(rebased);
      } else {
        await localDb.outbox.delete(sent.key);
      }
      committed = true;
    });
    if (committed) return rebased
      ? { status: "rebased", entry: rebased, object }
      : { status: "acknowledged", object };
    // A new durable generation arrived during crypto work. Rebase that generation
    // instead of losing the accepted revision or deleting the newer request.
  }
  return { status: "missing" };
}
