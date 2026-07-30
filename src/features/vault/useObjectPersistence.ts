import { useEffect, useRef } from "react";
import { cryptoClient } from "../../crypto/client";
import {
  localDb,
  localKey,
  type LocalEncryptedObject,
  type OutboxEntry
} from "../../storage/database";
import type { OpenAttachment, OpenDocument, VaultObject } from "../../types";
import { ObjectWriteCoordinator, prepareObjectForPersistence } from "../objectPersistence";
import type { SaveState } from "./useSyncStatus";

type PersistableObject = OpenDocument | OpenAttachment;

export interface ObjectPersistenceOptions {
  commitState?: boolean | (() => boolean);
  preserveUpdatedAt?: boolean;
}

export interface ObjectPersistenceDependencies {
  userId: string;
  generation: { current: number };
  isActive: () => boolean;
  canSynchronize: () => boolean;
  setSaveState: (state: Exclude<SaveState, "error">) => void;
  onPersistenceError: (objectId: string, error: unknown) => void;
  onPersistenceSuccess: (objectId: string) => void;
  upsertDocument: (document: OpenDocument) => void;
  upsertAttachment: (attachment: OpenAttachment) => void;
}

function plainObject(object: PersistableObject): VaultObject {
  const { objectId: _objectId, serverRevision: _serverRevision, dirty: _dirty, ...plain } = object;
  return plain;
}

export function useObjectPersistence(dependencies: ObjectPersistenceDependencies) {
  const coordinator = useRef(new ObjectWriteCoordinator());

  useEffect(() => {
    coordinator.current.resume();
    return () => coordinator.current.pause();
  }, []);

  const persistObject = async <T extends PersistableObject>(
    object: T,
    options: ObjectPersistenceOptions = {}
  ): Promise<T> => {
    if (!dependencies.isActive()) return object;
    dependencies.setSaveState("saving");
    const key = localKey(dependencies.userId, object.objectId);
    const coordinated = await coordinator.current.enqueue(key, async () => {
      const pending = await localDb.outbox.get(key);
      if (!dependencies.isActive()) return object;
      const baseRevision = pending?.baseRevision ?? object.serverRevision;
      const intendedRevision = baseRevision + 1;
      const next = prepareObjectForPersistence(object, baseRevision, {
        preserveUpdatedAt: options.preserveUpdatedAt
      });
      const encrypted = await cryptoClient.encryptObject(
        dependencies.userId,
        object.objectId,
        object.kind,
        intendedRevision,
        plainObject(next)
      );
      if (!dependencies.isActive()) return object;
      const localObject: LocalEncryptedObject = {
        key,
        userId: dependencies.userId,
        objectId: object.objectId,
        objectType: object.kind,
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        encryptionVersion: encrypted.encryptionVersion,
        revision: intendedRevision,
        deleted: next.deleted,
        updatedAt: next.updatedAt
      };
      const outbox: OutboxEntry = {
        ...localObject,
        operation: "upsert",
        baseRevision,
        idempotencyKey: crypto.randomUUID(),
        generation: Date.now() * 1000 + ++dependencies.generation.current
      };
      await localDb.transaction("rw", localDb.objects, localDb.outbox, async () => {
        if (!dependencies.isActive()) return;
        await localDb.objects.put(localObject);
        await localDb.outbox.put(outbox);
      });
      return dependencies.isActive() ? next : object;
    }).catch((error: unknown) => {
      if (dependencies.isActive()) dependencies.onPersistenceError(object.objectId, error);
      throw error;
    });

    if (!dependencies.isActive()) return object;
    dependencies.onPersistenceSuccess(object.objectId);
    const commitState = typeof options.commitState === "function"
      ? options.commitState()
      : options.commitState !== false;
    if (coordinated.isLatest && commitState) {
      if (coordinated.value.kind === "attachment") {
        dependencies.upsertAttachment(coordinated.value as OpenAttachment);
      } else {
        dependencies.upsertDocument(coordinated.value as OpenDocument);
      }
    }
    if (coordinated.isLatest && commitState) {
      dependencies.setSaveState(dependencies.canSynchronize() ? "local" : "offline");
    }
    return coordinated.value;
  };

  return {
    persistObject,
    drain: (objectId: string) => coordinator.current.drain(localKey(dependencies.userId, objectId)),
    drainAll: () => coordinator.current.drainAll(),
    pause: () => coordinator.current.pause(),
    resume: () => coordinator.current.resume()
  };
}
