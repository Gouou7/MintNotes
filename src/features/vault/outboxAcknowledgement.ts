import { cryptoClient } from "../../crypto/client";
import { localDb, type LocalEncryptedObject, type OutboxEntry } from "../../storage/database";
import type { VaultObject } from "../../types";

function plainObject(object: VaultObject): VaultObject {
  return object;
}

export type OutboxAcknowledgement =
  | { status: "missing" }
  | { status: "acknowledged" }
  | { status: "rebased"; entry: OutboxEntry };

interface OutboxCryptoPort {
  decryptObject: typeof cryptoClient.decryptObject;
  encryptObject: typeof cryptoClient.encryptObject;
}

/** Rebase a newer local generation onto an accepted older server revision without an outbox deletion gap. */
export async function acknowledgeOutboxEntry(
  userId: string,
  sent: OutboxEntry,
  acceptedRevision: number,
  nextGeneration: () => number,
  crypto: OutboxCryptoPort = cryptoClient
): Promise<OutboxAcknowledgement> {
  const current = await localDb.outbox.get(sent.key);
  if (!current) return { status: "missing" };
  if (current.generation === sent.generation) {
    let committed = false;
    await localDb.transaction("rw", localDb.objects, localDb.outbox, async () => {
      const latest = await localDb.outbox.get(sent.key);
      if (latest?.generation !== sent.generation) return;
      await localDb.outbox.delete(sent.key);
      const stored = await localDb.objects.get(sent.key);
      if (stored?.revision === sent.revision) {
        await localDb.objects.put({ ...stored, revision: acceptedRevision });
      }
      committed = true;
    });
    return committed ? { status: "acknowledged" } : { status: "missing" };
  }

  const decrypted = await crypto.decryptObject(
    userId,
    current.objectId,
    current.objectType,
    current.revision,
    current.ciphertext,
    current.nonce
  );
  const intendedRevision = acceptedRevision + 1;
  const encrypted = await crypto.encryptObject(
    userId,
    current.objectId,
    current.objectType,
    intendedRevision,
    plainObject(decrypted)
  );
  const localObject: LocalEncryptedObject = {
    key: current.key,
    userId,
    objectId: current.objectId,
    objectType: current.objectType,
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    encryptionVersion: encrypted.encryptionVersion,
    revision: intendedRevision,
    deleted: current.deleted,
    updatedAt: current.updatedAt
  };
  const rebased: OutboxEntry = {
    ...localObject,
    operation: "upsert",
    baseRevision: acceptedRevision,
    idempotencyKey: globalThis.crypto.randomUUID(),
    generation: nextGeneration()
  };
  let committed = false;
  await localDb.transaction("rw", localDb.objects, localDb.outbox, async () => {
    const latest = await localDb.outbox.get(sent.key);
    if (latest?.generation !== current.generation) return;
    await localDb.objects.put(localObject);
    await localDb.outbox.put(rebased);
    committed = true;
  });
  return committed ? { status: "rebased", entry: rebased } : { status: "missing" };
}
