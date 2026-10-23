import type { Dispatch, SetStateAction } from "react";
import { api } from "../../api";
import { translateError, type Translate } from "../../i18n";
import { historyKey, localDb } from "../../storage/database";
import type { HistoryListItem, OpenDocument } from "../../types";
import { attachmentIdsIn } from "../attachments";
import { canDeleteHistory, manualHistorySnapshotOptions, normalizeHistoryName } from "../history";
import { derivedNoteLockState, isLockedNote } from "../noteLock";
import { formatNoteTime } from "../noteTime";
import { siblingTitleExists, uniqueSiblingTitle } from "../tree";
import { makeDocument } from "./documentFactory";
import type { useObjectPersistence } from "./useObjectPersistence";
import type { useToastNotifications } from "./useToastNotifications";
import type { useVaultHistory } from "./useVaultHistory";
import type { useVaultModel } from "./useVaultModel";
import type { useWorkspaceSelection } from "./useWorkspaceSelection";

interface Options {
  model: ReturnType<typeof useVaultModel>;
  selection: ReturnType<typeof useWorkspaceSelection>;
  history: ReturnType<typeof useVaultHistory>;
  activeDocument: OpenDocument | null;
  flushDocument: (objectId: string) => Promise<void>;
  formatDateTime: (value: string | number | Date) => string;
  showMessage: ReturnType<typeof useToastNotifications>["showMessage"];
  t: Translate;
  userId: string;
  requestPush: (kind?: "editor" | "structural") => void;
  serverSessionVerified: boolean;
  synchronize: () => Promise<void>;
  nameDocuments: () => OpenDocument[];
  persistObject: ReturnType<typeof useObjectPersistence>["persistObject"];
  setTitleDraft: Dispatch<SetStateAction<string>>;
  setEditorSessionId: Dispatch<SetStateAction<number>>;
  persistDocumentCopy: (document: OpenDocument, sourceMarkdown: string, sourceAttachmentIds: readonly string[], options?: { commitState?: boolean; }) => Promise<OpenDocument>;
}

/** 手动快照、保护、清理和恢复操作。 */
export function useVaultHistoryActions(options: Options) {
  const {
    model,
    selection,
    history,
    activeDocument,
    flushDocument,
    formatDateTime,
    showMessage,
    t,
    userId,
    requestPush,
    serverSessionVerified,
    synchronize,
    nameDocuments,
    persistObject,
    setTitleDraft,
    setEditorSessionId,
    persistDocumentCopy
  } = options;
  const { documentIndexRef, attachmentIndexRef, documentsRef } = model;
  const { activateDocument } = selection;
  const {
    saveHistorySnapshot,
    setRenamingHistoryId,
    historyController,
    ensureHistorySnapshot,
    metadataForSnapshot,
    setHistorySettings,
    historySettingsRef,
    setHistoryItems,
    setHistoryPreview,
    historyPreview,
    refreshHistorySettings,
    historyLastCapturedAt,
    historyLastSignature
  } = history;

  const saveCurrentHistory = async () => {
    if (!activeDocument) return;
    try {
      await flushDocument(activeDocument.objectId);
      const current = documentIndexRef.current.get(activeDocument.objectId);
      const saved = current ? await saveHistorySnapshot(
        current,
        "manual",
        manualHistorySnapshotOptions(new Date(), formatDateTime)
      ) : null;
      if (saved) setRenamingHistoryId(saved.historyId);
      showMessage(saved ? t("notice.historySaved") : t("notice.historyUnchanged"), "info");
    } catch (error) {
      showMessage(translateError(error, t, "notice.historySaveFailed"), "critical");
    }
  };

  const updateHistoryMetadata = async (
    item: HistoryListItem,
    change: { name?: string; protected?: boolean }
  ): Promise<boolean> => {
    try {
      const key = historyKey(userId, item.noteId, item.historyId);
      let snapshot = await localDb.historySnapshots.get(key) ?? null;
      const metadataRecord = snapshot ?? await localDb.historyIndex.get(key) ?? item;
      let currentMetadata = await historyController.decryptMetadata(metadataRecord);
      if (!currentMetadata) {
        snapshot = await ensureHistorySnapshot(item);
        currentMetadata = await metadataForSnapshot(snapshot);
      }
      const name = change.name === undefined ? currentMetadata.name : normalizeHistoryName(change.name);
      if (change.name !== undefined && name === null) {
        showMessage(t("notice.historyNameRequired"));
        return false;
      }
      if (change.protected) {
        const invalid = currentMetadata.attachmentIds.filter((attachmentId) => {
          const attachment = attachmentIndexRef.current.get(attachmentId);
          return !attachment || attachment.deleted || attachment.ownerNoteId !== item.noteId;
        });
        if (invalid.length) {
          showMessage(t("notice.historyProtectedMissingAttachments", { count: invalid.length }), "critical");
          return false;
        }
      }
      const updated = await historyController.queueMetadataUpdate(item, snapshot, currentMetadata, {
        name,
        protected: change.protected
      });
      const { item: nextItem } = updated;
      const sizeDelta = nextItem.byteSize - item.byteSize;
      if (sizeDelta) {
        setHistorySettings((current) => {
          const next = { ...current, usedBytes: Math.max(0, current.usedBytes + sizeDelta) };
          historySettingsRef.current = next;
          return next;
        });
      }
      setHistoryItems((items) => items.map((entry) => entry.historyId === item.historyId ? nextItem : entry));
      setHistoryPreview((current) => current?.item.historyId === item.historyId
        ? { ...current, item: nextItem }
        : current);
      requestPush("structural");
      return true;
    } catch (error) {
      showMessage(translateError(error, t, "notice.historyUpdateFailed"), "critical");
      return false;
    }
  };

  const renameHistorySnapshot = async (item: HistoryListItem, name: string) => {
    const updated = await updateHistoryMetadata(item, { name });
    if (updated) setRenamingHistoryId((current) => current === item.historyId ? null : current);
    return updated;
  };

  const toggleHistoryProtection = async (item: HistoryListItem) => {
    const updated = await updateHistoryMetadata(item, { protected: !item.protected });
    if (updated) showMessage(item.protected ? t("notice.historyUnprotected") : t("notice.historyProtected"), "info");
  };

  const deleteHistorySnapshot = async (item: HistoryListItem) => {
    if (!canDeleteHistory(item)) return showMessage(t("notice.historyProtectedDeleteBlocked"));
    if (!serverSessionVerified) return showMessage(t("notice.historyDeleteOnlineOnly"));
    if (!window.confirm(t("history.deleteConfirm", { date: formatNoteTime(item.capturedAt) }))) return;
    try {
      await api(`/api/notes/${item.noteId}/history/${item.historyId}`, { method: "DELETE" });
      const key = historyKey(userId, item.noteId, item.historyId);
      await localDb.transaction("rw", localDb.historySnapshots, localDb.historyIndex, localDb.historyOutbox, localDb.historyMetadataOutbox, async () => {
        await localDb.historySnapshots.delete(key);
        await localDb.historyIndex.delete(key);
        await localDb.historyOutbox.delete(key);
        await localDb.historyMetadataOutbox.delete(key);
      });
      setHistoryItems((current) => current.filter((entry) => entry.historyId !== item.historyId));
      if (historyPreview?.item.historyId === item.historyId) setHistoryPreview(null);
      await refreshHistorySettings().catch(() => undefined);
      showMessage(t("notice.historyDeleted"), "info");
    } catch (error) {
      showMessage(translateError(error, t, "notice.historyDeleteFailed"), "critical");
    }
  };

  const clearCurrentHistory = async () => {
    if (!activeDocument) return;
    if (!serverSessionVerified) return showMessage(t("notice.historyDeleteOnlineOnly"));
    if (!window.confirm(t("history.clearNoteConfirm", { title: activeDocument.title }))) return;
    try {
      const protectionPending = (await localDb.historyMetadataOutbox
        .where("[userId+noteId]").equals([userId, activeDocument.objectId]).toArray())
        .some((entry) => entry.protected !== undefined);
      if (protectionPending) return showMessage(t("notice.historyProtectionSyncRequired"));
      const cleared = await api<{ deleted: number; preserved: number; clearedBefore: string }>(`/api/notes/${activeDocument.objectId}/history`, { method: "DELETE" });
      await localDb.transaction("rw", localDb.historySnapshots, localDb.historyIndex, localDb.historyOutbox, localDb.historyMetadataOutbox, async () => {
        const [snapshots, indexes] = await Promise.all([
          localDb.historySnapshots.where("[userId+noteId]").equals([userId, activeDocument.objectId]).toArray(),
          localDb.historyIndex.where("[userId+noteId]").equals([userId, activeDocument.objectId]).toArray()
        ]);
        const removeKeys = [...new Set([
          ...snapshots.filter((snapshot) => !snapshot.protected && snapshot.capturedAt <= cleared.clearedBefore).map((snapshot) => snapshot.key),
          ...indexes.filter((snapshot) => !snapshot.protected && snapshot.capturedAt <= cleared.clearedBefore).map((snapshot) => snapshot.key)
        ])];
        await localDb.historySnapshots.bulkDelete(removeKeys);
        await localDb.historyIndex.bulkDelete(removeKeys);
        await localDb.historyOutbox.bulkDelete(removeKeys);
        await localDb.historyMetadataOutbox.bulkDelete(removeKeys);
      });
      historyLastCapturedAt.current.delete(activeDocument.objectId);
      historyLastSignature.current.delete(activeDocument.objectId);
      setHistoryItems((items) => items.filter((item) => item.protected));
      setHistoryPreview((current) => current?.item.protected ? current : null);
      await refreshHistorySettings().catch(() => undefined);
      showMessage(t("notice.historyClearResult", { deleted: cleared.deleted, preserved: cleared.preserved }), "info");
    } catch (error) {
      showMessage(translateError(error, t, "notice.historyClearFailed"), "critical");
    }
  };

  const clearAllHistory = async () => {
    if (!serverSessionVerified) return showMessage(t("notice.historyDeleteOnlineOnly"));
    if (!window.confirm(t("history.clearAllConfirm"))) return;
    try {
      const protectionPending = (await localDb.historyMetadataOutbox.where("userId").equals(userId).toArray())
        .some((entry) => entry.protected !== undefined);
      if (protectionPending) return showMessage(t("notice.historyProtectionSyncRequired"));
      const cleared = await api<{ deleted: number; preserved: number; clearedBefore: string }>("/api/account/note-history", { method: "DELETE" });
      await localDb.transaction("rw", localDb.historySnapshots, localDb.historyIndex, localDb.historyOutbox, localDb.historyMetadataOutbox, async () => {
        const [snapshots, indexes] = await Promise.all([
          localDb.historySnapshots.where("userId").equals(userId).toArray(),
          localDb.historyIndex.where("userId").equals(userId).toArray()
        ]);
        const removeKeys = [...new Set([
          ...snapshots.filter((snapshot) => !snapshot.protected && snapshot.capturedAt <= cleared.clearedBefore).map((snapshot) => snapshot.key),
          ...indexes.filter((snapshot) => !snapshot.protected && snapshot.capturedAt <= cleared.clearedBefore).map((snapshot) => snapshot.key)
        ])];
        await localDb.historySnapshots.bulkDelete(removeKeys);
        await localDb.historyIndex.bulkDelete(removeKeys);
        await localDb.historyOutbox.bulkDelete(removeKeys);
        await localDb.historyMetadataOutbox.bulkDelete(removeKeys);
      });
      historyLastCapturedAt.current.clear();
      historyLastSignature.current.clear();
      setHistoryItems((items) => items.filter((item) => item.protected));
      setHistoryPreview((current) => current?.item.protected ? current : null);
      await refreshHistorySettings();
      showMessage(t("notice.historyClearResult", { deleted: cleared.deleted, preserved: cleared.preserved }), "info");
    } catch (error) {
      showMessage(translateError(error, t, "notice.historyClearFailed"), "critical");
    }
  };

  const restoreHistoryAsCurrent = async () => {
    if (!activeDocument || !historyPreview) return;
    if (isLockedNote(activeDocument)) {
      showMessage(t("notice.noteLockedEdit", { title: activeDocument.title }));
      return;
    }
    const missing = attachmentIdsIn(historyPreview.payload.markdown)
      .filter((id) => !attachmentIndexRef.current.get(id) || attachmentIndexRef.current.get(id)?.deleted);
    if (missing.length && !window.confirm(t("history.restoreMissingAttachments", { count: missing.length }))) return;
    try {
      await flushDocument(activeDocument.objectId);
      const current = documentIndexRef.current.get(activeDocument.objectId);
      if (!current) return;
      const checkpoint = await saveHistorySnapshot(current, "restore-safety", { force: true });
      if (!checkpoint) throw new Error(t("notice.historySaveFailed"));
      const title = siblingTitleExists(nameDocuments(), historyPreview.payload.title, current.parentId, current.objectId)
        ? uniqueSiblingTitle(nameDocuments(), historyPreview.payload.title, current.parentId)
        : historyPreview.payload.title;
      const restored = await persistObject({
        ...current,
        title,
        markdown: historyPreview.payload.markdown,
        tags: [...historyPreview.payload.tags],
        attachmentIds: attachmentIdsIn(historyPreview.payload.markdown),
        dirty: true
      });
      setTitleDraft(restored.title);
      setHistoryPreview(null);
      setEditorSessionId((value) => value + 1);
      requestPush("editor");
      showMessage(t("notice.historyRestored"), "info");
    } catch (error) {
      showMessage(translateError(error, t, "notice.historyRestoreFailed"), "critical");
    }
  };

  const restoreHistoryAsCopy = async () => {
    if (!activeDocument || !historyPreview) return;
    try {
      const title = uniqueSiblingTitle(
        documentsRef.current,
        t("history.restoredCopyTitle", { title: historyPreview.payload.title, date: formatNoteTime(historyPreview.item.capturedAt) }),
        activeDocument.parentId
      );
      const copy = makeDocument(documentsRef.current, "note", title, activeDocument.parentId, historyPreview.payload.markdown);
      copy.tags = [...historyPreview.payload.tags];
      copy.locked = derivedNoteLockState(activeDocument, "explicit-copy");
      const persisted = await persistDocumentCopy(
        copy,
        historyPreview.payload.markdown,
        historyPreview.payload.attachmentIds
      );
      activateDocument(persisted.objectId);
      setHistoryPreview(null);
      setEditorSessionId((value) => value + 1);
      requestPush("structural");
      showMessage(t("notice.historyCopyRestored"), "info");
    } catch (error) {
      showMessage(translateError(error, t, "notice.historyCopyFailed"), "critical");
    }
  };

  return {
    saveCurrentHistory,
    renameHistorySnapshot,
    toggleHistoryProtection,
    deleteHistorySnapshot,
    clearCurrentHistory,
    clearAllHistory,
    restoreHistoryAsCurrent,
    restoreHistoryAsCopy
  };
}
