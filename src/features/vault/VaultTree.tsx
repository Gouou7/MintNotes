import { Button } from "@/components/ui/button";
import { type DragEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type ReactElement } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Ellipsis,
  FilePlus2,
  FileText,
  FileLock,
  FileLock2,
  FolderPlus,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Trash2
} from "lucide-react";
import { RowActionMenu, type RowMenuItems } from "../../components/RowActionMenu";
import { AppIcon } from "../../components/AppIcon";
import { TreeRenameInput } from "../../components/TreeRenameInput";
import { useI18n } from "../../i18n";
import type { OpenDocument } from "../../types";
import {
  lockedNoteInSelection,
  selectionRoots,
  treeDropPosition,
  type TreeDropPosition
} from "../tree";
import { isLockedNote } from "../noteLock";

const MULTI_DRAG_TYPE = "application/x-webmd-objects";
const SINGLE_DRAG_TYPE = "application/x-webmd-object";

export interface TreeDropTarget {
  objectId: string;
  position: TreeDropPosition;
}

export function acceptTreeDrag(event: DragEvent, allowed = true): boolean {
  const { dataTransfer } = event;
  if (!dataTransfer.types.includes(MULTI_DRAG_TYPE) && !dataTransfer.types.includes(SINGLE_DRAG_TYPE)) return false;
  event.stopPropagation();
  dataTransfer.dropEffect = allowed ? "move" : "none";
  if (allowed) event.preventDefault();
  return true;
}

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
  const single = dataTransfer.getData(SINGLE_DRAG_TYPE);
  return single ? [single] : [];
}

export function TreeNoteLock({ document }: { document: OpenDocument }) {
  const { t } = useI18n();
  return isLockedNote(document) ? <span className="tree-note-lock" title={t("app.noteLockedBadge")}>
    <AppIcon icon={FileLock} size={16} />
    <span className="sr-only">{t("app.noteLockedBadge")}</span>
  </span> : null;
}

export function TreeLevel({ childrenByParent, parentId, activeId, selectedIds, expanded, draggingIds, dropTarget, renamingDocumentId, onDropTarget, onSelect, onContext, menuActions, onDragSelection, onDragFinish, onMove, onRenameCommit, onRenameCancel }: {
  childrenByParent: Map<string | null, OpenDocument[]>;
  parentId: string | null;
  activeId: string | null;
  selectedIds: Set<string>;
  expanded: Set<string>;
  draggingIds: ReadonlySet<string>;
  dropTarget: TreeDropTarget | null;
  renamingDocumentId: string | null;
  onDropTarget: (target: TreeDropTarget | null) => void;
  onSelect: (document: OpenDocument, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onContext: (document: OpenDocument) => void;
  menuActions?: TreeMenuActions;
  onDragSelection: (document: OpenDocument) => string[];
  onDragFinish: () => void;
  onMove: (ids: string[], parentId: string | null, beforeId?: string | null) => void;
  onRenameCommit: (objectId: string, value: string) => void;
  onRenameCancel: () => void;
}) {
  const { t } = useI18n();
  const children = childrenByParent.get(parentId) ?? [];
  return children.map((entry, entryIndex) => {
    const dropPosition = dropTarget?.objectId === entry.objectId ? dropTarget.position : null;
    const positionAtPointer = (event: DragEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return treeDropPosition(entry.kind, (event.clientY - rect.top) / rect.height);
    };
    const updateDropTarget = (event: DragEvent<HTMLDivElement>) => {
      const position = positionAtPointer(event);
      const isDragged = draggingIds.has(entry.objectId);
      if (acceptTreeDrag(event, position !== "inside" || !isDragged)) {
        onDropTarget(isDragged ? null : { objectId: entry.objectId, position });
      }
    };
    const row = (more?: ReactNode) => <div
        className={`tree-row ${entry.objectId === activeId ? "active" : ""} ${selectedIds.has(entry.objectId) ? "selected" : ""} ${dropPosition === "inside" ? "drop-target" : ""} ${dropPosition === "before" ? "drop-before" : ""} ${dropPosition === "after" ? "drop-after" : ""}`}
        data-object-id={entry.objectId}
        data-drop-position={dropPosition ?? undefined}
        role="treeitem"
        aria-selected={selectedIds.has(entry.objectId)}
        draggable={!entry.deleted && renamingDocumentId !== entry.objectId}
        onDragStart={(event) => {
          const ids = onDragSelection(entry);
          event.dataTransfer.setData(MULTI_DRAG_TYPE, JSON.stringify(ids));
          event.dataTransfer.setData(SINGLE_DRAG_TYPE, ids[0] ?? entry.objectId);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={onDragFinish}
        onDragEnter={updateDropTarget}
        onDragOver={updateDropTarget}
        onDrop={(event) => {
          const ids = draggedDocumentIds(event.dataTransfer);
          if (!ids.length) return;
          event.preventDefault();
          event.stopPropagation();
          onDragFinish();
          const position = positionAtPointer(event);
          if (position === "inside") {
            if (!draggingIds.has(entry.objectId)) onMove(ids, entry.objectId);
          } else {
            onMove(ids, entry.parentId, position === "before" ? entry.objectId : (children[entryIndex + 1]?.objectId ?? null));
          }
        }}
      >
        {renamingDocumentId === entry.objectId
          ? <div className="tree-main tree-main-renaming"><span className={entry.kind === "note" ? "tree-spacer" : undefined}>{entry.kind === "folder" && <AppIcon icon={expanded.has(entry.objectId) ? ChevronDown : ChevronRight} size={16} />}</span><TreeRenameInput initialValue={entry.title} label={t("app.rename")} onCommit={(value) => onRenameCommit(entry.objectId, value)} onCancel={onRenameCancel} /><TreeNoteLock document={entry} /></div>
          : entry.kind === "folder"
            ? <Button variant="ghost" className="tree-main" onClick={(event) => onSelect(entry, event)}><span><AppIcon icon={expanded.has(entry.objectId) ? ChevronDown : ChevronRight} /></span><span className="tree-title">{entry.title}</span></Button>
            : <Button variant="ghost" className="tree-main" onClick={(event) => onSelect(entry, event)}><span className="tree-spacer" /><span className="tree-title">{entry.title || t("app.untitled")}</span>{entry.dirty && <i title={t("app.notSynced")} />}<TreeNoteLock document={entry} /></Button>}
        {more}
      </div>;
    return <div className="tree-node" key={entry.objectId}>
      {menuActions ? <TreeRowMenu document={entry} actions={menuActions} row={row} onOpen={() => onContext(entry)}
        contextDisabled={renamingDocumentId === entry.objectId} /> : row()}
      {entry.kind === "folder" && expanded.has(entry.objectId) && <div className="tree-children" role="group"><TreeLevel childrenByParent={childrenByParent} parentId={entry.objectId} activeId={activeId} selectedIds={selectedIds} expanded={expanded} draggingIds={draggingIds} dropTarget={dropTarget} renamingDocumentId={renamingDocumentId} onDropTarget={onDropTarget} onSelect={onSelect} onContext={onContext} menuActions={menuActions} onDragSelection={onDragSelection} onDragFinish={onDragFinish} onMove={onMove} onRenameCommit={onRenameCommit} onRenameCancel={onRenameCancel} /></div>}
    </div>
  }) as ReactNode;
}

export interface TreeMenuActions {
  selection: (document: OpenDocument) => OpenDocument[];
  documents: OpenDocument[];
  onSelect: (id: string) => void;
  onRename: (id: string) => void;
  onToggleLock: (id: string) => Promise<void>;
  onCreate: (kind: "note" | "folder", parentId: string | null) => Promise<string>;
  onDuplicate: (ids: string[]) => Promise<void>;
  onExport: (ids: string[]) => Promise<void>;
  onPin: (ids: string[], pinned: boolean) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
  onRestore: (ids: string[]) => Promise<void>;
  onPurge: (ids: string[]) => void;
}

export function TreeRowMenu({ document, actions, row, onOpen, contextDisabled }: {
  document: OpenDocument;
  actions: TreeMenuActions;
  row: (more: ReactNode) => ReactElement;
  onOpen: () => void;
  contextDisabled?: boolean;
}) {
  const { t } = useI18n();
  const { selection, documents, onSelect, onRename, onToggleLock, onCreate, onDuplicate, onExport, onPin, onDelete, onRestore, onPurge } = actions;
  const items: RowMenuItems = (Item, Separator) => {
    const selected = selection(document);
    const selectedIds = selected.map((entry) => entry.objectId);
    const roots = selectionRoots(documents, selectedIds);
    const single = selected.length === 1;
    const deleted = selected.every((entry) => entry.deleted);
    const lockedTrashNote = deleted ? undefined : lockedNoteInSelection(documents, roots);
    const allPinned = selected.every((entry) => entry.favorite);
    return <>
        {!single && <p className="context-selection-count">{t("app.selectedCount", { count: selected.length })}</p>}
        {single && document.kind === "note" && <Item onClick={() => void onSelect(document.objectId)}><AppIcon icon={FileText} size={16} strokeWidth={1.5} />{t("app.open")}</Item>}
        {!deleted && <>
          {single && <Item disabled={isLockedNote(document)} title={isLockedNote(document) ? t("app.unlockToEdit") : undefined} onClick={() => void onRename(document.objectId)}><AppIcon icon={Pencil} size={16} strokeWidth={1.5} />{t("app.rename")}</Item>}
          {single && document.kind === "note" && <Item onClick={() => void onToggleLock(document.objectId)}><AppIcon icon={FileLock2} size={16} strokeWidth={1.5} />{isLockedNote(document) ? t("app.unlockNote") : t("app.lockNote")}</Item>}
          <Item onClick={() => void onPin(selectedIds, !allPinned)}><AppIcon icon={allPinned ? PinOff : Pin} size={16} strokeWidth={1.5} />{allPinned ? t("app.unpin") : t("app.pinned")}</Item>
        </>}
        {!deleted && single && document.kind === "folder" && <>
          <Item onClick={() => void onCreate("note", document.objectId)}><AppIcon icon={FilePlus2} size={16} strokeWidth={1.5} />{t("app.createNoteInFolder")}</Item>
          <Item onClick={() => void onCreate("folder", document.objectId)}><AppIcon icon={FolderPlus} size={16} strokeWidth={1.5} />{t("app.createSubfolder")}</Item>
        </>}
        {!deleted && <Item onClick={() => void onDuplicate(selectedIds)}><AppIcon icon={Copy} size={16} strokeWidth={1.5} />{t("app.duplicate")}</Item>}
        <Item onClick={() => void onExport(selectedIds)}><AppIcon icon={Download} size={16} strokeWidth={1.5} />{t("app.export")}</Item>
        <Separator />
        {deleted ? <>
          <Item onClick={() => void onRestore(selectedIds)}><AppIcon icon={RotateCcw} size={16} strokeWidth={1.5} />{t("app.restore")}</Item>
          <Item variant="destructive" onClick={() => void onPurge(selectedIds)}><AppIcon icon={Trash2} size={16} strokeWidth={1.5} />{t("app.permanentDeleteEllipsis")}</Item>
        </> : <Item variant="destructive" disabled={Boolean(lockedTrashNote)} title={lockedTrashNote ? t("notice.lockedTrashBlocked", { title: lockedTrashNote.title }) : undefined} onClick={() => void onDelete(selectedIds)}><AppIcon icon={Trash2} size={16} strokeWidth={1.5} />{t("app.moveToTrash")}</Item>}
      </>;
  };
  return <RowActionMenu row={row} items={items} onOpen={onOpen} contextDisabled={contextDisabled}
    trigger={<Button variant="ghost" size="icon" className="tree-more" aria-label={t("app.openMenu", { title: document.title })}><AppIcon icon={Ellipsis} /></Button>} />;
}
