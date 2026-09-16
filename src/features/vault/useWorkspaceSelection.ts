import { useCallback, useRef, useState } from "react";

export function useWorkspaceSelection() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionAnchor = useRef<string | null>(null);

  const activateDocument = useCallback((objectId: string | null) => {
    activeIdRef.current = objectId;
    setActiveId(objectId);
    setSelectedIds(new Set(objectId === null ? [] : [objectId]));
    selectionAnchor.current = objectId;
  }, []);

  return {
    activeId,
    activeIdRef: activeIdRef as Readonly<typeof activeIdRef>,
    activateDocument,
    selectedIds,
    setSelectedIds,
    selectionAnchor
  };
}
