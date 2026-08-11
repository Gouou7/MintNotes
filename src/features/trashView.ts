import type { OpenDocument } from "../types";

export type TrashKindFilter = "all" | OpenDocument["kind"];
export type TrashSortMode = "deleted-desc" | "deleted-asc" | "name";

export interface TrashView {
  roots: OpenDocument[];
  childrenByParent: Map<string, OpenDocument[]>;
  descendantCounts: Map<string, number>;
  automaticallyExpandedIds: Set<string>;
  matchCount: number;
  filtering: boolean;
}

function compareTrashItems(mode: TrashSortMode) {
  return (a: OpenDocument, b: OpenDocument): number => {
    const byName = a.title.localeCompare(b.title, "zh-CN", { numeric: true, sensitivity: "base" });
    if (mode === "deleted-desc") return b.updatedAt.localeCompare(a.updatedAt) || byName;
    if (mode === "deleted-asc") return a.updatedAt.localeCompare(b.updatedAt) || byName;
    return byName || b.updatedAt.localeCompare(a.updatedAt);
  };
}

export function createTrashView(
  items: OpenDocument[],
  query: string,
  kindFilter: TrashKindFilter,
  sortMode: TrashSortMode
): TrashView {
  const byId = new Map(items.map((item) => [item.objectId, item]));
  const allChildrenByParent = new Map<string, OpenDocument[]>();
  for (const item of items) {
    if (!item.parentId || !byId.has(item.parentId)) continue;
    const siblings = allChildrenByParent.get(item.parentId) ?? [];
    siblings.push(item);
    allChildrenByParent.set(item.parentId, siblings);
  }

  const compare = compareTrashItems(sortMode);
  for (const children of allChildrenByParent.values()) children.sort(compare);

  const descendantCounts = new Map<string, number>();
  const countDescendants = (objectId: string, visiting = new Set<string>()): number => {
    const cached = descendantCounts.get(objectId);
    if (cached !== undefined) return cached;
    if (visiting.has(objectId)) return 0;
    const nextVisiting = new Set(visiting).add(objectId);
    const count = (allChildrenByParent.get(objectId) ?? []).reduce(
      (total, child) => total + 1 + countDescendants(child.objectId, nextVisiting),
      0
    );
    descendantCounts.set(objectId, count);
    return count;
  };
  for (const item of items) countDescendants(item.objectId);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtering = normalizedQuery.length > 0 || kindFilter !== "all";
  const matchingIds = new Set(items.filter((item) => (
    (kindFilter === "all" || item.kind === kindFilter)
    && (!normalizedQuery || item.title.toLocaleLowerCase().includes(normalizedQuery))
  )).map((item) => item.objectId));

  const visibleIds = new Set<string>();
  if (filtering) {
    for (const objectId of matchingIds) {
      let currentId: string | null = objectId;
      const seen = new Set<string>();
      while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        visibleIds.add(currentId);
        currentId = byId.get(currentId)?.parentId ?? null;
      }
    }
  } else {
    for (const item of items) visibleIds.add(item.objectId);
  }

  const childrenByParent = new Map<string, OpenDocument[]>();
  for (const [parentId, children] of allChildrenByParent) {
    const visibleChildren = children.filter((child) => visibleIds.has(child.objectId));
    if (visibleChildren.length) childrenByParent.set(parentId, visibleChildren);
  }

  const automaticallyExpandedIds = new Set<string>();
  if (filtering) {
    for (const [parentId, children] of childrenByParent) {
      if (children.length) automaticallyExpandedIds.add(parentId);
    }
  }

  const roots = items
    .filter((item) => visibleIds.has(item.objectId) && (!item.parentId || !byId.has(item.parentId)))
    .sort(compare);

  return {
    roots,
    childrenByParent,
    descendantCounts,
    automaticallyExpandedIds,
    matchCount: matchingIds.size,
    filtering
  };
}
