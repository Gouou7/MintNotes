import type { LocalEncryptedObject } from "../storage/database";
import type { SyncChange } from "../types";

export function isAcknowledgedLocalEcho(
  local: LocalEncryptedObject | undefined,
  change: SyncChange
): boolean {
  return Boolean(
    local
      && !change.purged
      && local.objectId === change.objectId
      && local.objectType === change.objectType
      && local.revision === change.revision
      && local.ciphertext === change.ciphertext
      && local.nonce === change.nonce
      && local.encryptionVersion === change.encryptionVersion
      && local.deleted === change.deleted
  );
}
