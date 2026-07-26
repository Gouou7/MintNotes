import type { OpenAttachment, OpenDocument } from "../types";

type PersistableObject = OpenDocument | OpenAttachment;

type PreparePersistenceOptions = {
  preserveUpdatedAt?: boolean;
  now?: string;
};

export function prepareObjectForPersistence<T extends PersistableObject>(
  object: T,
  baseRevision: number,
  options: PreparePersistenceOptions = {}
): T {
  return {
    ...object,
    updatedAt: options.preserveUpdatedAt ? object.updatedAt : options.now ?? new Date().toISOString(),
    serverRevision: baseRevision,
    dirty: true
  };
}
