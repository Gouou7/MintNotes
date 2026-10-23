import type { Dispatch, RefObject, SetStateAction } from "react";
import { useState } from "react";
import { api } from "../../api";
import { translateError, type Translate } from "../../i18n";
import type { OpenDocument } from "../../types";
import { NameReservations } from "../siblingNames";
import { descendantsOf, lockedNoteInSelection, selectionRoots } from "../tree";
import { hasPendingLocalObjectGraph } from "./localPurge";
import type { useDocumentSaveQueue } from "./useDocumentSaveQueue";
import type { useObjectPersistence } from "./useObjectPersistence";
import type { useToastNotifications } from "./useToastNotifications";
import type { useVaultModel } from "./useVaultModel";
import type { useWorkspaceSelection } from "./useWorkspaceSelection";

interface Options {
  model: ReturnType<typeof useVaultModel>;
  selection: ReturnType<typeof useWorkspaceSelection>;
  showMessage: ReturnType<typeof useToastNotifications>["showMessage"];
  t: Translate;
  nameReservations: RefObject<NameReservations>;
  persistObject: ReturnType<typeof useObjectPersistence>["persistObject"];
  setEditorSessionId: Dispatch<SetStateAction<number>>;
  requestPush: (kind?: "editor" | "structural") => void;
  serverSessionVerified: boolean;
  documentSaveQueue: ReturnType<typeof useDocumentSaveQueue>;
  objectPersistence: ReturnType<typeof useObjectPersistence>;
  synchronize: () => Promise<void>;
  userId: string;
  syncClientId: RefObject<string>;
  removePurgedLocal: (objectId: string, commitState?: boolean) => Promise<void>;
}

/** 回收站、附件墓碑与永久清除。 */
export function useVaultTrash(options: Options) {
  const {
    model,
    selection,
    showMessage,
    t,
    nameReservations,
    persistObject,
    setEditorSessionId,
    requestPush,
    serverSessionVerified,
    documentSaveQueue,
    objectPersistence,
    synchronize,
    userId,
    syncClientId,
    removePurgedLocal
  } = options;
  const { documentsRef, attachmentsRef } = model;
  const { activeIdRef, activateDocument, setSelectedIds, selectionAnchor } = selection;

  const [purging, setPurging] = useState(false);

  const setDeletedMany = async (objectIds: string[], deleted: boolean) => {
    const roots = selectionRoots(documentsRef.current, objectIds);
    if (deleted) {
      const locked = lockedNoteInSelection(documentsRef.current, roots);
      if (locked) {
        showMessage(t("notice.lockedTrashBlocked", { title: locked.title }));
        return;
      }
    }
    const ids = new Set(roots.flatMap((objectId) => [...descendantsOf(documentsRef.current, objectId)]));
    if (!ids.size) return;
    if (!deleted) {
      const restoring = documentsRef.current.filter((entry) => ids.has(entry.objectId));
      const conflict = nameReservations.current.claim(documentsRef.current, restoring.map((entry) => ({ ...entry, deleted: false })));
      if (conflict) return showMessage(t("notice.restoreNameConflict", { title: conflict.title }));
    }
    try {
      const noteIds = new Set([...ids].filter((id) => documentsRef.current.find((entry) => entry.objectId === id)?.kind === "note"));
      const ownedAttachments = attachmentsRef.current.filter((entry) => noteIds.has(entry.ownerNoteId));
      for (const id of ids) {
        const document = documentsRef.current.find((entry) => entry.objectId === id);
        if (document) await persistObject({ ...document, deleted, dirty: true });
      }
      for (const attachment of ownedAttachments) await persistObject({ ...attachment, deleted, dirty: true });
      if (deleted && ids.has(activeIdRef.current ?? "")) {
        activateDocument(null);
        setEditorSessionId((current) => current + 1);
      }
      setSelectedIds((current) => new Set([...current].filter((id) => !ids.has(id))));
      if (selectionAnchor.current && ids.has(selectionAnchor.current)) selectionAnchor.current = null;
      requestPush("structural");
    } finally {
      if (!deleted) for (const id of ids) nameReservations.current.release(id);
    }
  };

  const requestPurgeDocuments = (objectIds: string[]) => {
    const roots = selectionRoots(documentsRef.current, objectIds);
    const targets = roots.map((id) => documentsRef.current.find((entry) => entry.objectId === id && entry.deleted)).filter(Boolean) as OpenDocument[];
    if (!targets.length) return;
    const label = targets.length === 1
      ? t("notice.purgeSingleLabel", { title: targets[0].title })
      : t("notice.purgeMultipleLabel", { count: targets.length });
    if (window.confirm(t("notice.purgeConfirm", { label }))) {
      void purgeTrash(roots);
    }
  };

  const requestClearTrash = () => {
    if (!documentsRef.current.some((entry) => entry.deleted) && !attachmentsRef.current.some((entry) => entry.deleted)) return;
    if (window.confirm(t("notice.clearTrashConfirm"))) {
      void purgeTrash(null);
    }
  };

  const purgeTrash = async (objectIds: string[] | null) => {
    if (purging) return;
    if (!serverSessionVerified) return showMessage(t("notice.purgeOnlineOnly"));
    setPurging(true);
    try {
      await documentSaveQueue.flushAll();
      await objectPersistence.drainAll();
      await synchronize();
      const documentIds = objectIds === null
        ? new Set(documentsRef.current.filter((entry) => entry.deleted).map((entry) => entry.objectId))
        : new Set(selectionRoots(documentsRef.current, objectIds).flatMap((objectId) => [...descendantsOf(documentsRef.current, objectId)]));
      const noteIds = new Set([...documentIds].filter((id) => documentsRef.current.find((entry) => entry.objectId === id)?.kind === "note"));
      const targets = [
        ...documentsRef.current.filter((entry) => documentIds.has(entry.objectId) && entry.deleted),
        ...attachmentsRef.current.filter((entry) => entry.deleted && (objectIds === null || noteIds.has(entry.ownerNoteId)))
      ];
      if (!targets.length) return;
      const targetIds = new Set(targets.map((entry) => entry.objectId));
      if (
        targets.some((entry) => entry.dirty || entry.serverRevision < 1)
        || await hasPendingLocalObjectGraph(userId, targetIds)
      ) {
        return showMessage(t("notice.purgeWaitSync"));
      }
      await api("/api/objects/purge", {
        method: "POST",
        headers: { "X-WebMD-Sync-Client": syncClientId.current },
        body: JSON.stringify({ objects: targets.map((entry) => ({ objectId: entry.objectId, baseRevision: entry.serverRevision })) })
      });
      for (const entry of targets) await removePurgedLocal(entry.objectId);
      showMessage(t("notice.purgeComplete"), "info");
      requestPush("structural");
    } catch (error) {
      showMessage(translateError(error, t, "notice.purgeFailed"), "critical");
    } finally {
      setPurging(false);
    }
  };

  return { purging, setDeletedMany, requestPurgeDocuments, requestClearTrash };
}
