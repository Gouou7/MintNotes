import type { Dispatch, SetStateAction } from "react";
import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { buildOutline, findOutlineHeading } from "../../editor/product/outline";
import { parseWikiLinkTarget, resolveWikiLink } from "../../editor/product/wikiLinkResolver";
import { type Translate } from "../../i18n";
import type { HistoryListItem, NoteHistoryPayload, OpenDocument } from "../../types";
import { isLockedNote } from "../noteLock";
import { descendantsOf, folderRevealPath, selectionRoots, treeSelectionRange } from "../tree";
import type { useDocumentNavigation } from "./useDocumentNavigation";
import type { useToastNotifications } from "./useToastNotifications";
import type { useVaultModel } from "./useVaultModel";
import type { useWorkspaceSelection } from "./useWorkspaceSelection";
import { type TreeDropTarget } from "./VaultTree";

interface Options {
  model: ReturnType<typeof useVaultModel>;
  selection: ReturnType<typeof useWorkspaceSelection>;
  showMessage: ReturnType<typeof useToastNotifications>["showMessage"];
  t: Translate;
  setSearch: Dispatch<SetStateAction<string>>;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  finishHistorySession: (capture?: boolean) => Promise<void>;
  flushDocument: (objectId: string) => Promise<void>;
  applyDeferredActiveRemote: (objectId: string) => void;
  setEditorSessionId: Dispatch<SetStateAction<number>>;
  setHistoryPreview: Dispatch<SetStateAction<{ item: HistoryListItem; payload: NoteHistoryPayload; } | null>>;
  setTreeOpen: Dispatch<SetStateAction<boolean>>;
  visibleTree: OpenDocument[];
  activeDocument: OpenDocument | null;
  documentNavigation: ReturnType<typeof useDocumentNavigation>;
}

/** 目录树选择、导航、重命名和拖放交互。 */
export function useVaultTree(options: Options) {
  const {
    model,
    selection,
    showMessage,
    t,
    setSearch,
    setExpanded,
    finishHistorySession,
    flushDocument,
    applyDeferredActiveRemote,
    setEditorSessionId,
    setHistoryPreview,
    setTreeOpen,
    visibleTree,
    activeDocument,
    documentNavigation
  } = options;
  const { documentIndexRef, documentsRef } = model;
  const { setSelectedIds, selectionAnchor, activeIdRef, activateDocument, selectedIds } = selection;

  const [treeDraggingIds, setTreeDraggingIds] = useState<Set<string>>(new Set());

  const [treeDropTarget, setTreeDropTarget] = useState<TreeDropTarget | null>(null);

  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null);

  const [contextMenu, setContextMenu] = useState<{ objectId: string; x: number; y: number } | null>(null);

  const documentTree = useRef<HTMLDivElement>(null);

  const beginTreeRename = (objectId: string) => {
    const target = documentIndexRef.current.get(objectId);
    if (!target || target.deleted) return;
    if (isLockedNote(target)) {
      showMessage(t("notice.noteLockedEdit", { title: target.title }));
      return;
    }
    const ancestors = new Set<string>();
    let ancestorId = target.parentId;
    while (ancestorId) {
      ancestors.add(ancestorId);
      ancestorId = documentIndexRef.current.get(ancestorId)?.parentId ?? null;
    }
    setSearch("");
    setExpanded((current) => new Set([...current, ...ancestors]));
    setSelectedIds(new Set([objectId]));
    selectionAnchor.current = objectId;
    setRenamingDocumentId(objectId);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      documentTree.current
        ?.querySelector<HTMLElement>(`[data-object-id="${objectId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }));
  };

  const selectDocument = async (objectId: string) => {
    const currentActiveId = activeIdRef.current;
    if (currentActiveId && currentActiveId !== objectId) {
      await finishHistorySession(true);
      await flushDocument(currentActiveId);
      applyDeferredActiveRemote(currentActiveId);
      setEditorSessionId((current) => current + 1);
    }
    setHistoryPreview(null);
    activateDocument(objectId);
    setTreeOpen(false);
  };

  const selectPinnedEntry = (entry: OpenDocument, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (entry.kind !== "folder") {
      selectTreeEntry(entry, event);
    } else {
      const additive = event.ctrlKey || event.metaKey;
      if (event.shiftKey) {
        const range = treeSelectionRange(visibleTree, selectionAnchor.current, entry.objectId);
        setSelectedIds((current) => additive ? new Set([...current, ...range]) : new Set(range));
        if (!selectionAnchor.current) selectionAnchor.current = entry.objectId;
      } else if (additive) {
        setSelectedIds((current) => {
          const next = new Set(current);
          if (next.has(entry.objectId)) next.delete(entry.objectId); else next.add(entry.objectId);
          return next;
        });
        selectionAnchor.current = entry.objectId;
      } else {
        setSelectedIds(new Set([entry.objectId]));
        selectionAnchor.current = entry.objectId;
      }
    }
    setSearch("");
    setExpanded((current) => new Set([
      ...current,
      ...folderRevealPath(documentsRef.current, entry.objectId)
    ]));
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      documentTree.current
        ?.querySelector<HTMLElement>(`[data-object-id="${entry.objectId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }));
  };

  const openWikiLink = (target: string) => {
    const destination = resolveWikiLink(documentsRef.current, target, activeDocument);
    if (!destination) {
      showMessage(t("notice.wikiLinkNotFound", { target }));
      return;
    }
    const { heading } = parseWikiLinkTarget(target);
    const headingItem = heading
      ? findOutlineHeading(buildOutline(destination.markdown), heading)
      : null;
    void selectDocument(destination.objectId).then(() => {
      if (!headingItem) return;
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        documentNavigation.jumpToHeading(headingItem);
      }));
    });
  };

  const selectTreeEntry = (entry: OpenDocument, event: ReactMouseEvent<HTMLButtonElement>) => {
    const additive = event.ctrlKey || event.metaKey;
    if (event.shiftKey) {
      const anchorId = selectionAnchor.current;
      const anchorVisible = anchorId ? visibleTree.some((item) => item.objectId === anchorId) : false;
      const range = treeSelectionRange(visibleTree, anchorId, entry.objectId);
      setSelectedIds((current) => additive ? new Set([...current, ...range]) : new Set(range));
      if (!anchorVisible) selectionAnchor.current = entry.objectId;
      return;
    }
    selectionAnchor.current = entry.objectId;
    if (additive) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(entry.objectId)) next.delete(entry.objectId); else next.add(entry.objectId);
        return next;
      });
      return;
    }
    setSelectedIds(new Set([entry.objectId]));
    if (entry.kind === "folder") {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(entry.objectId)) next.delete(entry.objectId); else next.add(entry.objectId);
        return next;
      });
    } else {
      void selectDocument(entry.objectId);
    }
  };

  const openTreeContext = (entry: OpenDocument, x: number, y: number) => {
    if (!selectedIds.has(entry.objectId)) {
      setSelectedIds(new Set([entry.objectId]));
      selectionAnchor.current = entry.objectId;
    }
    setContextMenu({ objectId: entry.objectId, x, y });
  };

  const beginTreeDrag = (entry: OpenDocument): string[] => {
    const ids = selectedIds.has(entry.objectId)
      ? selectionRoots(documentsRef.current, selectedIds)
      : [entry.objectId];
    if (!selectedIds.has(entry.objectId)) {
      setSelectedIds(new Set(ids));
      selectionAnchor.current = entry.objectId;
    }
    setTreeDraggingIds(new Set(ids.flatMap((id) => [...descendantsOf(documentsRef.current, id)])));
    return ids;
  };

  const updateTreeDropTarget = (target: TreeDropTarget | null) => {
    setTreeDropTarget((current) => (
      current?.objectId === target?.objectId && current?.position === target?.position
        ? current
        : target
    ));
  };

  const revealActiveDocument = () => {
    if (!activeDocument) return;
    const ancestors = new Set<string>();
    const seen = new Set<string>();
    let parentId = activeDocument.parentId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      ancestors.add(parentId);
      parentId = documentIndexRef.current.get(parentId)?.parentId ?? null;
    }
    setSearch("");
    setExpanded((current) => new Set([...current, ...ancestors]));
    setSelectedIds(new Set([activeDocument.objectId]));
    selectionAnchor.current = activeDocument.objectId;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      documentTree.current
        ?.querySelector<HTMLElement>(`[data-object-id="${activeDocument.objectId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }));
  };

  return {
    treeDraggingIds,
    setTreeDraggingIds,
    treeDropTarget,
    setTreeDropTarget,
    renamingDocumentId,
    setRenamingDocumentId,
    contextMenu,
    setContextMenu,
    documentTree,
    beginTreeRename,
    selectDocument,
    selectPinnedEntry,
    openWikiLink,
    selectTreeEntry,
    openTreeContext,
    beginTreeDrag,
    updateTreeDropTarget,
    revealActiveDocument
  };
}
