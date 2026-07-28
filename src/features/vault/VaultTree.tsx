import { type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Ellipsis, FileText, Folder, LockKeyhole } from "lucide-react";
import { AppIcon } from "../../components/AppIcon";
import { TreeRenameInput } from "../../components/TreeRenameInput";
import { useI18n } from "../../i18n";
import type { OpenDocument } from "../../types";
import {
  canMoveDocument,
  isFolderDropZone,
  lockedNoteInSelection,
  selectionRoots
} from "../tree";
import { isLockedNote } from "../noteLock";

const MULTI_DRAG_TYPE = "application/x-webmd-objects";

export function draggedDocumentIds(dataTransfer: DataTransfer): string[] {
  const multiple = dataTransfer.getData(MULTI_DRAG_TYPE);
  if (multiple) {
    try {
      const parsed = JSON.parse(multiple);
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) return parsed;
    } catch {
      // Fall back to the single-item payload used by older clients.
    }
  }
  const single = dataTransfer.getData("application/x-webmd-object");
  return single ? [single] : [];
}

export function TreeDocumentIcon({ document }: { document: OpenDocument }) {
  const { t } = useI18n();
  const locked = isLockedNote(document);
  return <span className={`tree-document-icon ${locked ? "locked" : ""}`}>
    <AppIcon icon={document.kind === "folder" ? Folder : FileText} size={17} />
    {locked && <span className="tree-lock-badge" title={t("app.noteLockedBadge")}><AppIcon icon={LockKeyhole} size={8} /><span className="sr-only">{t("app.noteLockedBadge")}</span></span>}
  </span>;
}

export function TreeLevel({ childrenByParent, parentId, activeId, selectedIds, expanded, dropTargetId, renamingDocumentId, onDropTarget, onSelect, onContext, onDragSelection, onMove, onRenameCommit, onRenameCancel }: {
  childrenByParent: Map<string | null, OpenDocument[]>;
  parentId: string | null;
  activeId: string | null;
  selectedIds: Set<string>;
  expanded: Set<string>;
  dropTargetId: string | null;
  renamingDocumentId: string | null;
  onDropTarget: (objectId: string | null) => void;
  onSelect: (document: OpenDocument, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onContext: (document: OpenDocument, x: number, y: number) => void;
  onDragSelection: (document: OpenDocument) => string[];
  onMove: (ids: string[], parentId: string | null, beforeId?: string | null) => void;
  onRenameCommit: (objectId: string, value: string) => void;
  onRenameCancel: () => void;
}) {
  const { t } = useI18n();
  const children = childrenByParent.get(parentId) ?? [];
  return children.map((entry, entryIndex) => (
    <div className="tree-node" key={entry.objectId}>
      <div
        className={`tree-row ${entry.objectId === activeId ? "active" : ""} ${selectedIds.has(entry.objectId) ? "selected" : ""} ${dropTargetId === entry.objectId ? "drop-target" : ""}`}
        data-object-id={entry.objectId}
        role="treeitem"
        aria-selected={selectedIds.has(entry.objectId)}
        draggable={!entry.deleted && renamingDocumentId !== entry.objectId}
        onDragStart={(event) => {
          const ids = onDragSelection(entry);
          event.dataTransfer.setData(MULTI_DRAG_TYPE, JSON.stringify(ids));
          event.dataTransfer.setData("application/x-webmd-object", ids[0] ?? entry.objectId);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => onDropTarget(null)}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(MULTI_DRAG_TYPE) && !event.dataTransfer.types.includes("application/x-webmd-object")) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientY - rect.top) / rect.height;
          onDropTarget(isFolderDropZone(entry.kind, ratio) ? entry.objectId : null);
        }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && dropTargetId === entry.objectId) onDropTarget(null); }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDropTarget(null);
          const ids = draggedDocumentIds(event.dataTransfer);
          if (!ids.length) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientY - rect.top) / rect.height;
          if (isFolderDropZone(entry.kind, ratio)) onMove(ids, entry.objectId);
          else onMove(ids, entry.parentId, ratio < .5 ? entry.objectId : (children[entryIndex + 1]?.objectId ?? null));
        }}
        onContextMenu={(event) => { event.preventDefault(); onContext(entry, event.clientX, event.clientY); }}
      >
        {renamingDocumentId === entry.objectId
          ? <div className="tree-main tree-main-renaming"><span className={entry.kind === "note" ? "tree-spacer" : undefined}>{entry.kind === "folder" && <AppIcon icon={expanded.has(entry.objectId) ? ChevronDown : ChevronRight} size={14} />}</span><TreeDocumentIcon document={entry} /><TreeRenameInput initialValue={entry.title} label={t("app.rename")} onCommit={(value) => onRenameCommit(entry.objectId, value)} onCancel={onRenameCancel} /></div>
          : entry.kind === "folder"
            ? <button className="tree-main" onClick={(event) => onSelect(entry, event)}><span><AppIcon icon={expanded.has(entry.objectId) ? ChevronDown : ChevronRight} size={14} /></span><TreeDocumentIcon document={entry} /><span>{entry.title}</span></button>
            : <button className="tree-main" onClick={(event) => onSelect(entry, event)}><span className="tree-spacer" /><TreeDocumentIcon document={entry} /><span>{entry.title || t("app.untitled")}</span>{entry.dirty && <i title={t("app.notSynced")} />}</button>}
        <button className="tree-more" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); onContext(entry, rect.right, rect.bottom); }} aria-label={t("app.openMenu", { title: entry.title })}><AppIcon icon={Ellipsis} size={17} /></button>
      </div>
      {entry.kind === "folder" && expanded.has(entry.objectId) && <div className="tree-children" role="group"><TreeLevel childrenByParent={childrenByParent} parentId={entry.objectId} activeId={activeId} selectedIds={selectedIds} expanded={expanded} dropTargetId={dropTargetId} renamingDocumentId={renamingDocumentId} onDropTarget={onDropTarget} onSelect={onSelect} onContext={onContext} onDragSelection={onDragSelection} onMove={onMove} onRenameCommit={onRenameCommit} onRenameCancel={onRenameCancel} /></div>}
    </div>
  )) as ReactNode;
}

export function ContextMenu({ document, selection, documents, position, onClose, onSelect, onRename, onToggleLock, onMove, onCreate, onDuplicate, onExport, onPin, onDelete, onRestore, onPurge }: {
  document: OpenDocument;
  selection: OpenDocument[];
  documents: OpenDocument[];
  position: { x: number; y: number };
  onClose: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string) => void;
  onToggleLock: (id: string) => Promise<void>;
  onMove: (ids: string[], parentId: string | null) => void;
  onCreate: (kind: "note" | "folder", parentId: string | null) => Promise<string>;
  onDuplicate: (ids: string[]) => Promise<void>;
  onExport: (ids: string[]) => Promise<void>;
  onPin: (ids: string[], pinned: boolean) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
  onRestore: (ids: string[]) => Promise<void>;
  onPurge: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const selected = selection.length ? selection : [document];
  const selectedIds = selected.map((entry) => entry.objectId);
  const roots = selectionRoots(documents, selectedIds);
  const single = selected.length === 1;
  const deleted = selected.every((entry) => entry.deleted);
  const lockedTrashNote = deleted ? undefined : lockedNoteInSelection(documents, roots);
  const allPinned = selected.every((entry) => entry.favorite);
  const folders = documents.filter((entry) => entry.kind === "folder" && !entry.deleted && !selectedIds.includes(entry.objectId) && roots.every((id) => canMoveDocument(documents, id, entry.objectId)));
  const act = (callback: () => unknown | Promise<unknown>) => { onClose(); void callback(); };
  return (
    <div className="context-menu" style={{ left: Math.min(position.x, window.innerWidth - 230), top: Math.min(position.y, window.innerHeight - 430) }} onPointerDown={(event) => event.stopPropagation()}>
      {!single && <p className="context-selection-count">{t("app.selectedCount", { count: selected.length })}</p>}
      {single && document.kind === "note" && <button onClick={() => act(() => onSelect(document.objectId))}>{t("app.open")}</button>}
      {!deleted && <>{single && <button disabled={isLockedNote(document)} title={isLockedNote(document) ? t("app.unlockToEdit") : undefined} onClick={() => act(() => onRename(document.objectId))}>{t("app.rename")}</button>}{single && document.kind === "note" && <button onClick={() => act(() => onToggleLock(document.objectId))}>{isLockedNote(document) ? t("app.unlockNote") : t("app.lockNote")}</button>}<button onClick={() => act(() => onPin(selectedIds, !allPinned))}>{allPinned ? t("app.unpin") : t("app.pinned")}</button></>}
      {!deleted && single && document.kind === "folder" && <><button onClick={() => act(() => onCreate("note", document.objectId))}>{t("app.createNoteInFolder")}</button><button onClick={() => act(() => onCreate("folder", document.objectId))}>{t("app.createSubfolder")}</button></>}
      {!deleted && <button onClick={() => act(() => onDuplicate(selectedIds))}>{t("app.duplicate")}</button>}
      <button onClick={() => act(() => onExport(selectedIds))}>{t("app.export")}</button>
      {!deleted && <details><summary>{t("app.moveTo")}</summary><button onClick={() => act(() => onMove(selectedIds, null))}>{t("app.rootDirectory")}</button>{folders.map((folder) => <button key={folder.objectId} onClick={() => act(() => onMove(selectedIds, folder.objectId))}>{folder.title}</button>)}</details>}
      <hr />
      {deleted ? <><button onClick={() => act(() => onRestore(selectedIds))}>{t("app.restore")}</button><button className="danger" onClick={() => act(() => onPurge(selectedIds))}>{t("app.permanentDeleteEllipsis")}</button></> : <button className="danger" disabled={Boolean(lockedTrashNote)} title={lockedTrashNote ? t("notice.lockedTrashBlocked", { title: lockedTrashNote.title }) : undefined} onClick={() => act(() => onDelete(selectedIds))}>{t("app.moveToTrash")}</button>}
    </div>
  );
}
