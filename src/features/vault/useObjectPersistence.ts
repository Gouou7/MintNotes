import { persistWithCacheRecovery } from "../../storage/cache";
import { persistBodyBlocks } from "../../storage/noteBodies";
import { reserveConflictRecovery } from "./conflictRecovery";
import { shouldSynchronizeWorkspaceObject } from "../workspace";
import { operationId } from "@mint-notes/application-client";
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
  getServerRevision?: (objectId: string) => number | undefined;
}

function plainObject(object: PersistableObject): VaultObject {
  const { objectId: _objectId, serverRevision: _serverRevision, dirty: _dirty, serverTrashedAt: _trashedAt, ...plain } = object;
  return plain;
}

export function useObjectPersistence(dependencies: ObjectPersistenceDependencies) {
  const coordinator = useRef(new ObjectWriteCoordinator());
  const writerId = useRef(crypto.randomUUID());

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
      const baseRevision = pending?.baseRevision ?? dependencies.getServerRevision?.(object.objectId) ?? object.serverRevision;
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
        ...(object.kind === "attachment" ? { ownerNoteId: object.ownerNoteId } : {}),
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        encryptionVersion: encrypted.encryptionVersion,
        ...(encrypted.bodyBlockIds ? { bodyBlockIds: encrypted.bodyBlockIds } : {}),
        revision: intendedRevision,
        deleted: next.deleted,
        updatedAt: next.updatedAt,
        serverTrashedAt: next.deleted ? next.serverTrashedAt : null
      };
      const outbox: OutboxEntry = {
        ...localObject,
        operation: "upsert",
        baseRevision,
        idempotencyKey: operationId(),
        generation: Date.now() * 1000 + ++dependencies.generation.current,
        writerId: writerId.current,
        ...(pending?.upload ? { upload: pending.upload } : {})
      };
      await persistWithCacheRecovery(dependencies.userId, () => localDb.transaction("rw", localDb.objects, localDb.outbox, localDb.bodyBlocks, localDb.recoveries, localDb.attachmentChunks, async () => {
        if (!dependencies.isActive()) return;
        const latest = await localDb.outbox.get(key);
        const previous = await localDb.objects.get(key);
        if (latest && latest.writerId !== writerId.current && shouldSynchronizeWorkspaceObject(object.objectId)) {
          await reserveConflictRecovery(dependencies.userId, latest,
            latest.objectType === "attachment" ? [latest.objectId] : [], dependencies.isActive);
        }
        if (previous?.encryptionVersion === 1 && encrypted.encryptionVersion === 2) {
          const recoveryKey = `${key}:conversion:${previous.nonce}`;
          const attachments = (await localDb.objects.where("userId").equals(dependencies.userId).toArray()).filter((entry) => entry.ownerNoteId === object.objectId);
          const ids = new Set(attachments.map((entry) => entry.objectId));
          const chunks = (await localDb.attachmentChunks.where("userId").equals(dependencies.userId).toArray()).filter((chunk) => ids.has(chunk.attachmentId));
          if (!await localDb.recoveries.get(recoveryKey)) await localDb.recoveries.add({
            key: recoveryKey, userId: dependencies.userId, sourceId: object.objectId, copyId: object.objectId,
            kind: "conversion", source: { ...previous, operation: "upsert", baseRevision: Math.max(0, previous.revision - 1),
              idempotencyKey: operationId(), generation: outbox.generation }, attachments, chunks
          });
        }
        await persistBodyBlocks(dependencies.userId, object.objectId, encrypted);
        await localDb.objects.put(localObject);
        // Upload staging can happen while encryption runs. Carry that exact
        // request forward even when this save replaces its durable generation.
        await localDb.outbox.put({ ...outbox, ...(latest?.upload ? { upload: latest.upload } : {}) });
      }));
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
    coordinate: <T,>(objectId: string, operation: () => Promise<T>) => (
      coordinator.current.runExclusive(localKey(dependencies.userId, objectId), operation)
    ),
    drain: (objectId: string) => coordinator.current.drain(localKey(dependencies.userId, objectId)),
    drainAll: () => coordinator.current.drainAll(),
    pause: () => coordinator.current.pause(),
    resume: () => coordinator.current.resume()
  };
}
