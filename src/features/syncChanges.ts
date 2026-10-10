import type { LocalEncryptedObject } from "../storage/database";
import type { OpenAttachment, OpenDocument, SyncChange, VaultObject } from "../types";

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

/** Ignore UI bookkeeping when deciding whether an upload covers the current draft. */
export function matchesVaultPayload(current: OpenDocument | OpenAttachment, payload: VaultObject): boolean {
  return Object.entries(payload).every(([key, value]) => {
    const actual = (current as unknown as Record<string, unknown>)[key];
    return Array.isArray(value) && Array.isArray(actual)
      ? value.length === actual.length && value.every((entry, index) => entry === actual[index])
      : actual === value;
  });
}

export function applyVaultAcknowledgement<T extends OpenDocument | OpenAttachment>(
  current: T, payload: VaultObject, revision: number, pending: boolean
): T {
  return {
    ...current,
    serverRevision: Math.max(current.serverRevision, revision),
    dirty: pending || !matchesVaultPayload(current, payload)
  };
}
