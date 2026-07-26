import type { OpenDocument, VaultDocument } from "../types";

export const WORKSPACE_OBJECT_ID = "00000000-0000-4000-8000-000000000001";
export type WorkspaceEditorMode = "live" | "source" | "readonly";

export interface WorkspaceState {
  version: 1;
  activeNoteId: string | null;
  openNoteIds: string[];
  editorMode: WorkspaceEditorMode;
  treeCollapsed: boolean;
  outlineCollapsed: boolean;
}

export const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  version: 1,
  activeNoteId: null,
  openNoteIds: [],
  editorMode: "live",
  treeCollapsed: false,
  outlineCollapsed: false
};

export function parseWorkspaceState(document: Pick<VaultDocument, "markdown">): WorkspaceState | null {
  try {
    const parsed = JSON.parse(document.markdown) as Partial<WorkspaceState>;
    if (parsed.version !== 1) return null;
    const openNoteIds = Array.isArray(parsed.openNoteIds)
      ? [...new Set(parsed.openNoteIds.filter((value): value is string => typeof value === "string"))]
      : [];
    const activeNoteId = typeof parsed.activeNoteId === "string" ? parsed.activeNoteId : null;
    if (activeNoteId && !openNoteIds.includes(activeNoteId)) openNoteIds.push(activeNoteId);
    const editorMode = parsed.editorMode === "source" || parsed.editorMode === "readonly" ? parsed.editorMode : "live";
    return {
      version: 1,
      activeNoteId,
      openNoteIds,
      editorMode,
      treeCollapsed: parsed.treeCollapsed === true,
      outlineCollapsed: parsed.outlineCollapsed === true
    };
  } catch {
    return null;
  }
}

export function workspaceStateEquals(left: WorkspaceState | null, right: WorkspaceState): boolean {
  return Boolean(left
    && left.activeNoteId === right.activeNoteId
    && left.editorMode === right.editorMode
    && left.treeCollapsed === right.treeCollapsed
    && left.outlineCollapsed === right.outlineCollapsed
    && left.openNoteIds.length === right.openNoteIds.length
    && left.openNoteIds.every((id, index) => id === right.openNoteIds[index]));
}

export function makeWorkspaceDocument(state: WorkspaceState, current: OpenDocument | null = null): OpenDocument {
  const now = new Date().toISOString();
  return {
    objectId: WORKSPACE_OBJECT_ID,
    kind: "note",
    title: "Mint Notes workspace",
    markdown: JSON.stringify(state),
    parentId: null,
    tags: [],
    favorite: false,
    locked: false,
    deleted: false,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    manualOrder: 0,
    attachmentIds: [],
    schemaVersion: 2,
    serverRevision: current?.serverRevision ?? 0,
    dirty: true
  };
}
