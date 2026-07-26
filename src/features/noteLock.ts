import type { VaultDocument } from "../types";
import type { WorkspaceEditorMode } from "./workspace";

type LockableDocument = Pick<VaultDocument, "kind" | "locked">;

export function isLockedNote(document: LockableDocument | null | undefined): boolean {
  return document?.kind === "note" && document.locked === true;
}

export function effectiveEditorMode(
  workspaceMode: WorkspaceEditorMode,
  document: LockableDocument | null | undefined
): WorkspaceEditorMode {
  return isLockedNote(document) ? "readonly" : workspaceMode;
}

export function derivedNoteLockState(
  source: LockableDocument,
  reason: "explicit-copy" | "conflict-copy"
): boolean {
  return reason === "conflict-copy" && isLockedNote(source);
}
