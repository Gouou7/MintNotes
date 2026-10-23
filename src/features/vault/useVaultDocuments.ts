import type { Dispatch, RefObject, SetStateAction } from "react";
import { useRef } from "react";
import { translateError, type Translate } from "../../i18n";
import type { HistoryListItem, NoteHistoryPayload, OpenDocument, UiPreferences } from "../../types";
import { AttachmentCloneService } from "../attachmentClone";
import { createLocalAttachment, decryptAttachmentBlob } from "../attachments";
import { documentPatchChanges } from "../documentPatch";
import { derivedNoteLockState, effectiveEditorMode, isLockedNote } from "../noteLock";
import { NameReservations } from "../siblingNames";
import {
  canMoveDocument,
  compareDocuments,
  descendantsOf,
  nextManualOrder,
  reorderedSiblingBatch,
  reorderedSiblings,
  resolveManualDropBeforeId,
  selectionRoots,
  siblingTitleExists,
  uniqueSiblingTitle
} from "../tree";
import { makeDocument } from "./documentFactory";
import type { useDocumentNavigation } from "./useDocumentNavigation";
import type { useObjectPersistence } from "./useObjectPersistence";
import type { useToastNotifications } from "./useToastNotifications";
import type { useVaultModel } from "./useVaultModel";
import type { useWorkspaceSelection } from "./useWorkspaceSelection";

export type CreateDocumentOptions = { focusName?: boolean; activate?: boolean };

interface Options {
  model: ReturnType<typeof useVaultModel>;
  selection: ReturnType<typeof useWorkspaceSelection>;
  scheduleHistoryEdit: (before: OpenDocument, after: OpenDocument) => void;
  queueDocument: (document: OpenDocument, delay?: number, maxWait?: number) => void;
  t: Translate;
  nameDocuments: () => OpenDocument[];
  setSearch: Dispatch<SetStateAction<string>>;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  persistObject: ReturnType<typeof useObjectPersistence>["persistObject"];
  beginTreeRename: (objectId: string) => void;
  applyDeferredActiveRemote: (objectId: string) => void;
  pendingTitleFocus: RefObject<string | null>;
  setEditorSessionId: Dispatch<SetStateAction<number>>;
  setTreeOpen: Dispatch<SetStateAction<boolean>>;
  requestPush: (kind?: "editor" | "structural") => void;
  nameReservations: RefObject<NameReservations>;
  userId: string;
  logoutStarted: RefObject<boolean>;
  serverSessionVerified: boolean;
  removePurgedLocal: (objectId: string, commitState?: boolean) => Promise<void>;
  showMessage: ReturnType<typeof useToastNotifications>["showMessage"];
  preferences: UiPreferences;
  titleDraft: string;
  flushDocument: (objectId: string) => Promise<void>;
  documentNavigation: ReturnType<typeof useDocumentNavigation>;
  historyPreview: { item: HistoryListItem; payload: NoteHistoryPayload; } | null;
  setRenamingDocumentId: Dispatch<SetStateAction<string | null>>;
}

/** 笔记创建、编辑、命名、移动、复制及附件归属。 */
export function useVaultDocuments(options: Options) {
  const {
    model,
    selection,
    scheduleHistoryEdit,
    queueDocument,
    t,
    nameDocuments,
    setSearch,
    setExpanded,
    persistObject,
    beginTreeRename,
    applyDeferredActiveRemote,
    pendingTitleFocus,
    setEditorSessionId,
    setTreeOpen,
    requestPush,
    nameReservations,
    userId,
    logoutStarted,
    serverSessionVerified,
    removePurgedLocal,
    showMessage,
    preferences,
    titleDraft,
    flushDocument,
    documentNavigation,
    historyPreview,
    setRenamingDocumentId
  } = options;
  const { documentIndexRef, documentsRef, upsertDocument, attachmentIndexRef, upsertAttachment } = model;
  const { setSelectedIds, selectionAnchor, activeIdRef, activateDocument } = selection;

  const pendingTitleSave = useRef<Promise<boolean>>(Promise.resolve(true));

  const patchDocument = (objectId: string, patch: Partial<OpenDocument>, delay = 500) => {
    const current = documentIndexRef.current.get(objectId);
    if (!current || isLockedNote(current) || !documentPatchChanges(current, patch)) return;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString(), dirty: true };
    scheduleHistoryEdit(current, next);
    queueDocument(next, delay);
  };

  const createDocument = async (kind: "note" | "folder", title: string, parentId: string | null, markdown = "", options: CreateDocumentOptions = {}) => {
    const defaultTitle = kind === "note" ? t("app.untitled") : t("app.newFolder");
    const documentTitle = uniqueSiblingTitle(nameDocuments(), title.trim() || defaultTitle, parentId);
    const document = makeDocument(documentsRef.current, kind, documentTitle, parentId, markdown);
    const activate = options.activate !== false;
    if (options.focusName) setSearch("");
    upsertDocument(document);
    if (activate) {
      setSelectedIds(new Set([document.objectId]));
      selectionAnchor.current = document.objectId;
    }
    if (kind === "folder") {
      const foldersToExpand = new Set([document.objectId]);
      let ancestorId = parentId;
      while (ancestorId) {
        foldersToExpand.add(ancestorId);
        ancestorId = documentIndexRef.current.get(ancestorId)?.parentId ?? null;
      }
      setExpanded((current) => new Set([...current, ...foldersToExpand]));
    }
    await persistObject(document);
    if (kind === "folder" && options.focusName) {
      beginTreeRename(document.objectId);
    }
    if (kind === "note" && activate) {
      const previousActiveId = activeIdRef.current;
      if (previousActiveId && previousActiveId !== document.objectId) applyDeferredActiveRemote(previousActiveId);
      if (options.focusName) pendingTitleFocus.current = document.objectId;
      activateDocument(document.objectId);
      setEditorSessionId((current) => current + 1);
      if (options.focusName) setTreeOpen(false);
    }
    requestPush("structural");
    return document.objectId;
  };

  const createNewDocument = (kind: "note" | "folder", parentId: string | null) => createDocument(
    kind,
    kind === "note" ? t("app.untitled") : t("app.newFolder"),
    parentId,
    "",
    { focusName: true }
  );

  const persistDocumentCopy = async (
    document: OpenDocument,
    sourceMarkdown: string,
    sourceAttachmentIds: readonly string[],
    options: { commitState?: boolean } = {}
  ): Promise<OpenDocument> => {
    document = nameReservations.current.reserve(documentsRef.current, document);
    const attachmentCloner = new AttachmentCloneService({
      resolveAttachment: (attachmentId) => attachmentIndexRef.current.get(attachmentId),
      readAttachment: (attachment) => decryptAttachmentBlob(
        userId,
        attachment,
        () => !logoutStarted.current,
        serverSessionVerified
      ),
      createAttachment: (ownerNoteId, source, plaintext) => createLocalAttachment(
        userId,
        ownerNoteId,
        new File([plaintext], source.originalName, { type: source.mime }),
        () => !logoutStarted.current
      ),
      persistAttachment: async (attachment) => {
        upsertAttachment(attachment);
        return attachment;
      },
      removeAttachment: (attachmentId) => removePurgedLocal(attachmentId)
    });
    let cloned: Awaited<ReturnType<AttachmentCloneService["clone"]>> | null = null;
    let persistedCopy = false;
    try {
      cloned = await attachmentCloner.clone({
        sourceMarkdown,
        sourceAttachmentIds,
        targetNoteId: document.objectId
      });
      const persisted = await persistObject({
        ...document,
        markdown: cloned.markdown,
        attachmentIds: cloned.attachmentIds,
        dirty: true
      }, options);
      persistedCopy = true;
      return persisted;
    } catch (error) {
      if (cloned) {
        await Promise.allSettled(cloned.attachments.map((attachment) => (
          removePurgedLocal(attachment.objectId)
        )));
      }
      throw error;
    } finally {
      if (!persistedCopy || options.commitState !== false) nameReservations.current.release(document.objectId);
    }
  };

  const moveDocument = async (objectId: string, parentId: string | null, beforeId: string | null = null) => {
    if (!canMoveDocument(documentsRef.current, objectId, parentId)) return showMessage(t("notice.moveIntoDescendant"));
    const moving = documentsRef.current.find((entry) => entry.objectId === objectId);
    if (!moving) return;
    const conflict = nameReservations.current.claim(documentsRef.current, [{ ...moving, parentId }]);
    if (conflict) return showMessage(t("notice.moveNameConflict", { title: moving.title }));
    try {
      if (preferences.sortMode === "manual") {
        for (const change of reorderedSiblings(documentsRef.current, objectId, parentId, beforeId)) {
          const document = documentsRef.current.find((entry) => entry.objectId === change.objectId);
          if (document && (document.parentId !== change.parentId || document.manualOrder !== change.manualOrder)) await persistObject({ ...document, ...change, dirty: true });
        }
      } else {
        await persistObject({ ...moving, parentId, manualOrder: nextManualOrder(documentsRef.current, parentId), dirty: true });
      }
      if (parentId) setExpanded((current) => new Set(current).add(parentId));
      requestPush("structural");
    } finally { nameReservations.current.release(objectId); }
  };

  const moveDocuments = async (objectIds: string[], parentId: string | null, beforeId: string | null = null) => {
    const roots = selectionRoots(documentsRef.current, objectIds);
    if (!roots.length) return;
    const moving = roots.map((id) => documentsRef.current.find((entry) => entry.objectId === id)).filter(Boolean) as OpenDocument[];
    const movingTreeIds = new Set(roots.flatMap((id) => [...descendantsOf(documentsRef.current, id)]));
    if (parentId && movingTreeIds.has(parentId)) return showMessage(t("notice.batchMoveIntoDescendant"));
    const conflict = nameReservations.current.claim(documentsRef.current, moving.map((entry) => ({ ...entry, parentId })));
    if (conflict) return showMessage(t("notice.batchMoveNameConflict", { title: conflict.title }));
    try {
      if (preferences.sortMode === "manual") {
        beforeId = resolveManualDropBeforeId(documentsRef.current, movingTreeIds, parentId, beforeId);
        let changed = false;
        for (const change of reorderedSiblingBatch(documentsRef.current, roots, parentId, beforeId)) {
          const document = documentsRef.current.find((entry) => entry.objectId === change.objectId);
          if (document && (document.parentId !== change.parentId || document.manualOrder !== change.manualOrder)) {
            changed = true;
            await persistObject({ ...document, ...change, dirty: true });
          }
        }
        if (changed) {
          if (parentId) setExpanded((current) => new Set(current).add(parentId!));
          requestPush("structural");
        }
      } else {
        for (const entry of moving) await moveDocument(entry.objectId, parentId, beforeId);
      }
      setSelectedIds(new Set(roots));
      selectionAnchor.current = roots[roots.length - 1] ?? null;
    } finally { for (const entry of moving) nameReservations.current.release(entry.objectId); }
  };

  const addAttachment = async (noteId: string, file: File) => {
    const editableNote = documentIndexRef.current.get(noteId);
    if (editableNote && isLockedNote(editableNote)) throw new Error(t("notice.noteLockedEdit", { title: editableNote.title }));
    showMessage(t("notice.encryptingAttachment", { name: file.name }), "info");
    const attachment = await createLocalAttachment(userId, noteId, file, () => !logoutStarted.current);
    upsertAttachment(attachment);
    const note = documentsRef.current.find((entry) => entry.objectId === noteId && entry.kind === "note");
    if (note) patchDocument(note.objectId, { attachmentIds: [...new Set([...note.attachmentIds, attachment.objectId])] }, 0);
    showMessage(t("notice.attachmentSaved", { name: attachment.originalName }), "info");
    requestPush("structural");
    return attachment;
  };

  const duplicateDocument = async (objectId: string, parentOverride?: string | null): Promise<string | null> => {
    const source = documentsRef.current.find((entry) => entry.objectId === objectId);
    if (!source) return null;
    if (source.kind === "folder") {
      const folderId = await createDocument("folder", `${source.title} ${t("app.copySuffix")}`, parentOverride === undefined ? source.parentId : parentOverride);
      const children = documentsRef.current.filter((entry) => entry.parentId === source.objectId && !entry.deleted).sort(compareDocuments("manual"));
      for (const child of children) await duplicateDocument(child.objectId, folderId);
      return folderId;
    }
    const parentId = parentOverride === undefined ? source.parentId : parentOverride;
    const title = uniqueSiblingTitle(nameDocuments(), `${source.title} ${t("app.copySuffix")}`, parentId);
    const copy = makeDocument(documentsRef.current, "note", title, parentId, source.markdown);
    copy.locked = derivedNoteLockState(source, "explicit-copy");
    const persisted = await persistDocumentCopy(copy, source.markdown, source.attachmentIds);
    const previousActiveId = activeIdRef.current;
    if (previousActiveId && previousActiveId !== persisted.objectId) applyDeferredActiveRemote(previousActiveId);
    activateDocument(persisted.objectId);
    setEditorSessionId((current) => current + 1);
    requestPush("structural");
    return persisted.objectId;
  };

  const duplicateDocuments = async (objectIds: string[]) => {
    const roots = selectionRoots(documentsRef.current, objectIds);
    const created: string[] = [];
    for (const objectId of roots) {
      const id = await duplicateDocument(objectId);
      if (id) created.push(id);
    }
    if (created.length) {
      setSelectedIds(new Set(created));
      selectionAnchor.current = created[created.length - 1];
      showMessage(t("notice.copiesCreated", { count: created.length }), "info");
    }
  };

  const pinDocuments = async (objectIds: string[], pinned: boolean) => {
    for (const objectId of objectIds) {
      const target = documentsRef.current.find((entry) => entry.objectId === objectId && !entry.deleted);
      if (target && target.favorite !== pinned) await persistObject({ ...target, favorite: pinned, dirty: true });
    }
    requestPush("structural");
  };

  const updateDocumentTitle = async (objectId: string, value: string): Promise<boolean> => {
    const target = documentsRef.current.find((entry) => entry.objectId === objectId);
    if (!target) return false;
    if (isLockedNote(target)) {
      showMessage(t("notice.noteLockedEdit", { title: target.title }));
      return false;
    }
    const title = value.trim();
    if (!title) {
      showMessage(t("notice.nameRequired"));
      return false;
    }
    if (title === target.title) return true;
    if (siblingTitleExists(nameDocuments(), title, target.parentId, target.objectId)) {
      showMessage(t("notice.renameConflict", { title }));
      return false;
    }
    const next = { ...target, title, dirty: true };
    scheduleHistoryEdit(target, next);
    upsertDocument(next);
    await persistObject(next, {
      commitState: () => documentIndexRef.current.get(objectId) === next
    });
    requestPush("structural");
    return true;
  };

  const commitDocumentTitle = (objectId: string, value: string): Promise<boolean> => {
    const next = pendingTitleSave.current
      .catch(() => false)
      .then(() => updateDocumentTitle(objectId, value));
    pendingTitleSave.current = next;
    return next;
  };

  const toggleNoteLock = async (noteId: string) => {
    const initial = documentIndexRef.current.get(noteId);
    if (!initial || initial.kind !== "note") return;
    try {
      if (noteId === activeIdRef.current && !isLockedNote(initial)) {
        const titleSaved = await commitDocumentTitle(noteId, titleDraft);
        if (!titleSaved) return;
        await flushDocument(noteId);
      }
      const current = documentIndexRef.current.get(noteId);
      if (!current || current.kind !== "note") return;
      const locked = !isLockedNote(current);
      if (noteId === activeIdRef.current) {
        documentNavigation.prepareModeChange(effectiveEditorMode(preferences.editorMode, { kind: "note", locked }));
      }
      await persistObject(
        { ...current, locked, dirty: true },
        { preserveUpdatedAt: true }
      );
      if (noteId === activeIdRef.current) setEditorSessionId((value) => value + 1);
      requestPush("structural");
      showMessage(
        locked
          ? t("notice.noteLocked", { title: current.title })
          : t("notice.noteUnlocked", { title: current.title }),
        "info"
      );
    } catch (error) {
      showMessage(translateError(error, t, "notice.noteLockFailed"), "critical");
    }
  };

  const toggleActiveNoteLock = async () => {
    const noteId = activeIdRef.current;
    if (!noteId || historyPreview) return;
    await toggleNoteLock(noteId);
  };

  const commitTreeRename = (objectId: string, value: string) => {
    setRenamingDocumentId((current) => current === objectId ? null : current);
    void commitDocumentTitle(objectId, value);
  };

  const renameDocument = (objectId: string) => beginTreeRename(objectId);

  return {
    patchDocument,
    createDocument,
    createNewDocument,
    persistDocumentCopy,
    moveDocuments,
    addAttachment,
    duplicateDocuments,
    pinDocuments,
    commitDocumentTitle,
    toggleNoteLock,
    toggleActiveNoteLock,
    commitTreeRename,
    renameDocument
  };
}
