import type { OpenDocument, UiPreferences, VaultDocument, WorkspaceEditorMode } from "../types";

export const WORKSPACE_OBJECT_ID = "00000000-0000-4000-8000-000000000001";
export type { WorkspaceEditorMode } from "../types";

export function shouldSynchronizeWorkspaceObject(objectId: string): boolean {
  return objectId !== WORKSPACE_OBJECT_ID;
}

export interface LegacyWorkspaceState {
  version: 1;
  activeNoteId: string | null;
  openNoteIds: string[];
  editorMode: WorkspaceEditorMode;
  treeCollapsed: boolean;
  outlineCollapsed: boolean;
}

export type DeviceWorkspacePreferences = Pick<
  UiPreferences,
  "workspaceVersion" | "activeNoteId" | "openNoteIds" | "editorMode" | "treeCollapsed" | "outlineCollapsed"
>;

export const DEFAULT_DEVICE_WORKSPACE_PREFERENCES: DeviceWorkspacePreferences = {
  workspaceVersion: 1,
  activeNoteId: null,
  openNoteIds: [],
  editorMode: "live",
  treeCollapsed: false,
  outlineCollapsed: false
};

function normalizeOpenNoteIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === "string"))]
    : [];
}

function normalizeEditorMode(value: unknown): WorkspaceEditorMode {
  return value === "source" || value === "readonly" ? value : "live";
}

export function parseLegacyWorkspaceState(document: Pick<VaultDocument, "markdown">): LegacyWorkspaceState | null {
  try {
    const parsed = JSON.parse(document.markdown) as Partial<LegacyWorkspaceState>;
    if (parsed.version !== 1) return null;
    const openNoteIds = normalizeOpenNoteIds(parsed.openNoteIds);
    const activeNoteId = typeof parsed.activeNoteId === "string" ? parsed.activeNoteId : null;
    if (activeNoteId && !openNoteIds.includes(activeNoteId)) openNoteIds.push(activeNoteId);
    return {
      version: 1,
      activeNoteId,
      openNoteIds,
      editorMode: normalizeEditorMode(parsed.editorMode),
      treeCollapsed: parsed.treeCollapsed === true,
      outlineCollapsed: parsed.outlineCollapsed === true
    };
  } catch {
    return null;
  }
}

export function resolveDeviceWorkspacePreferences(
  stored: Partial<UiPreferences>,
  legacy: LegacyWorkspaceState | null
): DeviceWorkspacePreferences {
  if (stored.workspaceVersion === 1) {
    const openNoteIds = normalizeOpenNoteIds(stored.openNoteIds);
    const activeNoteId = typeof stored.activeNoteId === "string" ? stored.activeNoteId : null;
    if (activeNoteId && !openNoteIds.includes(activeNoteId)) openNoteIds.push(activeNoteId);
    return {
      workspaceVersion: 1,
      activeNoteId,
      openNoteIds,
      editorMode: normalizeEditorMode(stored.editorMode),
      treeCollapsed: stored.treeCollapsed === true,
      outlineCollapsed: stored.outlineCollapsed === true
    };
  }
  if (legacy) {
    return {
      workspaceVersion: 1,
      activeNoteId: legacy.activeNoteId,
      openNoteIds: [...legacy.openNoteIds],
      editorMode: legacy.editorMode,
      treeCollapsed: typeof stored.treeCollapsed === "boolean" ? stored.treeCollapsed : legacy.treeCollapsed,
      outlineCollapsed: typeof stored.outlineCollapsed === "boolean" ? stored.outlineCollapsed : legacy.outlineCollapsed
    };
  }
  return {
    ...DEFAULT_DEVICE_WORKSPACE_PREFERENCES,
    openNoteIds: []
  };
}

export function resolveDeviceActiveNoteId(
  activeNoteId: string | null,
  documents: readonly OpenDocument[]
): string | null {
  if (!activeNoteId) return null;
  const active = documents.find((document) => document.objectId === activeNoteId);
  return active?.kind === "note" && !active.deleted ? active.objectId : null;
}
