import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { buildOutline } from "../../editor/outline";
import type { OpenDocument, SortMode } from "../../types";
import { compareDocuments, pinnedDocuments } from "../tree";
import { countText } from "../wordCount";

const DOCUMENT_DERIVATION_DELAY_MS = 180;

function useSettledMarkdown(markdown: string, documentKey: string) {
  const [settled, setSettled] = useState({ documentKey, markdown });
  const previousKey = useRef(documentKey);

  useEffect(() => {
    if (previousKey.current !== documentKey) {
      previousKey.current = documentKey;
      setSettled({ documentKey, markdown });
      return;
    }
    const timer = window.setTimeout(
      () => setSettled({ documentKey, markdown }),
      DOCUMENT_DERIVATION_DELAY_MS
    );
    return () => window.clearTimeout(timer);
  }, [documentKey, markdown]);

  return settled.documentKey === documentKey ? settled.markdown : markdown;
}

interface VaultDerivedViewOptions {
  documents: OpenDocument[];
  documentKey: string;
  markdown: string;
  search: string;
  expanded: Set<string>;
  sortMode: SortMode;
}

export function useVaultDerivedView({
  documents,
  documentKey,
  markdown,
  search,
  expanded,
  sortMode
}: VaultDerivedViewOptions) {
  const settledMarkdown = useSettledMarkdown(markdown, documentKey);
  const deferredDocuments = useDeferredValue(documents);
  const deferredSearch = useDeferredValue(search);
  const outline = useMemo(() => buildOutline(settledMarkdown), [settledMarkdown]);
  const statistics = useMemo(() => countText(settledMarkdown), [settledMarkdown]);

  const visibleDocuments = useMemo(
    () => deferredDocuments.filter((entry) => !entry.deleted),
    [deferredDocuments]
  );
  const trashItems = useMemo(
    () => deferredDocuments.filter((entry) => entry.deleted),
    [deferredDocuments]
  );
  const searched = useMemo(() => {
    const normalized = deferredSearch.trim().toLowerCase();
    if (!normalized) return visibleDocuments;
    const documentIndex = new Map(deferredDocuments.map((entry) => [entry.objectId, entry]));
    const included = new Set(
      visibleDocuments
        .filter((entry) => `${entry.title}\n${entry.markdown}`.toLowerCase().includes(normalized))
        .map((entry) => entry.objectId)
    );
    for (const id of [...included]) {
      let parentId = documentIndex.get(id)?.parentId;
      while (parentId) {
        included.add(parentId);
        parentId = documentIndex.get(parentId)?.parentId;
      }
    }
    return visibleDocuments.filter((entry) => included.has(entry.objectId));
  }, [deferredDocuments, deferredSearch, visibleDocuments]);
  const treeChildren = useMemo(() => {
    const indexed = new Map<string | null, OpenDocument[]>();
    for (const entry of searched) {
      const siblings = indexed.get(entry.parentId) ?? [];
      siblings.push(entry);
      indexed.set(entry.parentId, siblings);
    }
    for (const siblings of indexed.values()) siblings.sort(compareDocuments(sortMode));
    return indexed;
  }, [searched, sortMode]);
  const visibleTree = useMemo(() => {
    const ordered: OpenDocument[] = [];
    const visit = (parentId: string | null) => {
      for (const entry of treeChildren.get(parentId) ?? []) {
        ordered.push(entry);
        if (entry.kind === "folder" && expanded.has(entry.objectId)) visit(entry.objectId);
      }
    };
    visit(null);
    return ordered;
  }, [expanded, treeChildren]);
  const pinned = useMemo(() => pinnedDocuments(searched, sortMode), [searched, sortMode]);

  return { outline, statistics, trashItems, searched, treeChildren, visibleTree, pinned };
}
