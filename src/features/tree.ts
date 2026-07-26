import type { OpenDocument, SortMode } from "../types";

export function descendantsOf(documents: OpenDocument[], objectId: string): Set<string> {
  const result = new Set<string>([objectId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of documents) {
      if (entry.parentId && result.has(entry.parentId) && !result.has(entry.objectId)) {
        result.add(entry.objectId);
        changed = true;
      }
    }
  }
  return result;
}

export function lockedNoteInSelection(
  documents: OpenDocument[],
  objectIds: Iterable<string>
): OpenDocument | undefined {
  const recursiveIds = new Set<string>();
  for (const objectId of objectIds) {
    for (const descendantId of descendantsOf(documents, objectId)) recursiveIds.add(descendantId);
  }
  return documents.find((entry) => (
    recursiveIds.has(entry.objectId)
    && !entry.deleted
    && entry.kind === "note"
    && entry.locked === true
  ));
}

export function canMoveDocument(documents: OpenDocument[], objectId: string, parentId: string | null): boolean {
  if (objectId === parentId) return false;
  return !parentId || !descendantsOf(documents, objectId).has(parentId);
}

export function siblingTitleExists(
  documents: OpenDocument[],
  title: string,
  parentId: string | null,
  exceptObjectId?: string
): boolean {
  return documents.some((entry) => (
    !entry.deleted
    && entry.parentId === parentId
    && entry.objectId !== exceptObjectId
    && entry.title === title
  ));
}

export function uniqueSiblingTitle(documents: OpenDocument[], title: string, parentId: string | null): string {
  if (!siblingTitleExists(documents, title, parentId)) return title;
  let suffix = 2;
  while (siblingTitleExists(documents, `${title} ${suffix}`, parentId)) suffix += 1;
  return `${title} ${suffix}`;
}

export function compareDocuments(mode: SortMode) {
  return (a: OpenDocument, b: OpenDocument): number => {
    if (mode !== "manual" && a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    if (mode === "created") return b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title, "zh-CN");
    if (mode === "updated") return b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title, "zh-CN");
    if (mode === "manual") return a.manualOrder - b.manualOrder || a.createdAt.localeCompare(b.createdAt);
    return a.title.localeCompare(b.title, "zh-CN", { numeric: true, sensitivity: "base" });
  };
}

export function pinnedDocuments(documents: OpenDocument[], mode: SortMode): OpenDocument[] {
  return documents.filter((entry) => entry.favorite && !entry.deleted).sort(compareDocuments(mode));
}

export function isFolderDropZone(kind: OpenDocument["kind"], ratio: number): boolean {
  return kind === "folder" && ratio >= .25 && ratio <= .75;
}

export function visibleTreeOrder(
  documents: OpenDocument[],
  expanded: Set<string>,
  mode: SortMode,
  parentId: string | null = null
): OpenDocument[] {
  const result: OpenDocument[] = [];
  const children = documents.filter((entry) => entry.parentId === parentId).sort(compareDocuments(mode));
  for (const entry of children) {
    result.push(entry);
    if (entry.kind === "folder" && expanded.has(entry.objectId)) {
      result.push(...visibleTreeOrder(documents, expanded, mode, entry.objectId));
    }
  }
  return result;
}

export function treeSelectionRange(visible: OpenDocument[], anchorId: string | null, targetId: string): string[] {
  const anchorIndex = anchorId ? visible.findIndex((entry) => entry.objectId === anchorId) : -1;
  const targetIndex = visible.findIndex((entry) => entry.objectId === targetId);
  if (anchorIndex < 0 || targetIndex < 0) return [targetId];
  return visible
    .slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
    .map((entry) => entry.objectId);
}

export function selectionRoots(documents: OpenDocument[], selectedIds: Iterable<string>): string[] {
  const selected = new Set(selectedIds);
  return [...selected].filter((objectId) => {
    let parentId = documents.find((entry) => entry.objectId === objectId)?.parentId ?? null;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      if (selected.has(parentId)) return false;
      seen.add(parentId);
      parentId = documents.find((entry) => entry.objectId === parentId)?.parentId ?? null;
    }
    return true;
  });
}

export function nextManualOrder(documents: OpenDocument[], parentId: string | null): number {
  const orders = documents.filter((entry) => entry.parentId === parentId && !entry.deleted).map((entry) => entry.manualOrder);
  return (orders.length ? Math.max(...orders) : 0) + 1024;
}

export function reorderedSiblings(
  documents: OpenDocument[],
  objectId: string,
  parentId: string | null,
  beforeId: string | null
): Array<{ objectId: string; parentId: string | null; manualOrder: number }> {
  const moving = documents.find((entry) => entry.objectId === objectId);
  if (!moving) return [];
  const siblings = documents
    .filter((entry) => !entry.deleted && entry.parentId === parentId && entry.objectId !== objectId)
    .sort(compareDocuments("manual"));
  const index = beforeId ? Math.max(0, siblings.findIndex((entry) => entry.objectId === beforeId)) : siblings.length;
  siblings.splice(index < 0 ? siblings.length : index, 0, moving);
  return siblings.map((entry, order) => ({ objectId: entry.objectId, parentId, manualOrder: (order + 1) * 1024 }));
}
