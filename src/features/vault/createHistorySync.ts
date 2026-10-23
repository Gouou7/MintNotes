import type { RefObject } from "react";
import { api, ApiError } from "../../api";
import { cryptoClient } from "../../crypto/client";
import { type Translate } from "../../i18n";
import { localDb } from "../../storage/database";
import type { useToastNotifications } from "./useToastNotifications";
import type { useVaultHistory } from "./useVaultHistory";

interface Options {
  history: ReturnType<typeof useVaultHistory>;
  userId: string;
  logoutStarted: RefObject<boolean>;
  showMessage: ReturnType<typeof useToastNotifications>["showMessage"];
  t: Translate;
  generation: RefObject<number>;
  requestPush: (kind?: "editor" | "structural") => void;
}

/** 历史正文与元数据发件箱的上传和确认。 */
export function createHistorySync(options: Options) {
  const {
    history,
    userId,
    logoutStarted,
    showMessage,
    t,
    generation,
    requestPush
  } = options;
  const { metadataForSnapshot, setHistoryItems, historyQuotaPaused } = history;

  const pushHistoryPending = async (): Promise<boolean> => {
    const entries = await localDb.historyOutbox.where("userId").equals(userId).sortBy("generation");
    let pushed = false;
    for (const entry of entries) {
      if (logoutStarted.current) return pushed;
      try {
        const metadata = await metadataForSnapshot(entry);
        const response = await api<{ protected: boolean }>(`/api/notes/${entry.noteId}/history/${entry.historyId}`, {
          method: "POST",
          body: JSON.stringify({
            capturedAt: entry.capturedAt,
            captureKind: entry.captureKind,
            ciphertext: entry.ciphertext,
            nonce: entry.nonce,
            encryptionVersion: entry.encryptionVersion,
            metadataCiphertext: entry.metadataCiphertext,
            metadataNonce: entry.metadataNonce,
            metadataEncryptionVersion: entry.metadataEncryptionVersion,
            protected: entry.protected,
            attachmentIds: entry.protected ? metadata.attachmentIds : [],
            idempotencyKey: entry.idempotencyKey
          })
        });
        if (entry.protected && !response.protected) throw new Error("History protection was not acknowledged");
        const current = await localDb.historyOutbox.get(entry.key);
        if (!current || current.generation === entry.generation) {
          await localDb.historyOutbox.delete(entry.key);
          const metadataPending = await localDb.historyMetadataOutbox.get(entry.key);
          await localDb.historySnapshots.update(entry.key, { pending: Boolean(metadataPending) });
          await localDb.historyIndex.update(entry.key, { pending: Boolean(metadataPending) });
          setHistoryItems((items) => items.map((item) => (
            item.historyId === entry.historyId ? { ...item, pending: Boolean(metadataPending) } : item
          )));
        }
        pushed = true;
        historyQuotaPaused.current = false;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          await localDb.transaction("rw", localDb.historySnapshots, localDb.historyIndex, localDb.historyOutbox, async () => {
            await localDb.historySnapshots.delete(entry.key);
            await localDb.historyIndex.delete(entry.key);
            await localDb.historyOutbox.delete(entry.key);
          });
          setHistoryItems((items) => items.filter((item) => item.historyId !== entry.historyId));
          continue;
        }
        if (error instanceof ApiError && error.status === 413) {
          if (!historyQuotaPaused.current) showMessage(t("notice.historyQuotaReached"), "warning");
          historyQuotaPaused.current = true;
          break;
        }
        if (error instanceof ApiError && error.status === 404) break;
        throw error;
      }
    }
    return pushed;
  };

  const pushHistoryMetadataPending = async (): Promise<boolean> => {
    const entries = await localDb.historyMetadataOutbox.where("userId").equals(userId).sortBy("generation");
    let pushed = false;
    for (const entry of entries) {
      if (logoutStarted.current) return pushed;
      const snapshot = await localDb.historySnapshots.get(entry.key);
      const index = await localDb.historyIndex.get(entry.key);
      const record = snapshot ?? index;
      if (!record) {
        await localDb.historyMetadataOutbox.delete(entry.key);
        continue;
      }
      try {
        const metadata = await cryptoClient.decryptHistoryMetadata(
          userId,
          entry.noteId,
          entry.historyId,
          entry.capturedAt,
          entry.metadataCiphertext,
          entry.metadataNonce
        );
        const response = await api<{ protected: boolean; byteSize: number }>(
          `/api/notes/${entry.noteId}/history/${entry.historyId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              metadataCiphertext: entry.metadataCiphertext,
              metadataNonce: entry.metadataNonce,
              metadataEncryptionVersion: entry.metadataEncryptionVersion,
              ...(entry.protected === undefined ? {} : {
                protected: entry.protected,
                attachmentIds: entry.protected ? metadata.attachmentIds : []
              })
            })
          }
        );
        if (entry.protected === true && !response.protected) throw new Error("History protection was not acknowledged");
        const current = await localDb.historyMetadataOutbox.get(entry.key);
        if (current?.generation === entry.generation) {
          await localDb.historyMetadataOutbox.delete(entry.key);
          const createPending = await localDb.historyOutbox.get(entry.key);
          if (snapshot) await localDb.historySnapshots.update(entry.key, { pending: Boolean(createPending), byteSize: response.byteSize });
          await localDb.historyIndex.update(entry.key, { pending: Boolean(createPending), byteSize: response.byteSize });
          setHistoryItems((items) => items.map((item) => item.historyId === entry.historyId
            ? { ...item, pending: Boolean(createPending), byteSize: response.byteSize }
            : item));
        }
        pushed = true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404 && record.protected && snapshot) {
          const nextGeneration = Date.now() * 1000 + ++generation.current;
          await localDb.historyOutbox.put({
            ...snapshot,
            pending: true,
            idempotencyKey: crypto.randomUUID(),
            generation: nextGeneration
          });
          requestPush("editor");
          break;
        }
        if (error instanceof ApiError && error.status === 404 && record.protected) break;
        if (error instanceof ApiError && error.status === 404) {
          await localDb.transaction("rw", localDb.historySnapshots, localDb.historyIndex, localDb.historyMetadataOutbox, async () => {
            await localDb.historySnapshots.delete(entry.key);
            await localDb.historyIndex.delete(entry.key);
            await localDb.historyMetadataOutbox.delete(entry.key);
          });
          setHistoryItems((items) => items.filter((item) => item.historyId !== entry.historyId));
          continue;
        }
        throw error;
      }
    }
    return pushed;
  };

  return { pushHistoryPending, pushHistoryMetadataPending };
}
