import { describe, expect, it } from "vitest";
import type { VaultDocument } from "../types";
import { derivedNoteLockState, effectiveEditorMode, isLockedNote } from "./noteLock";

function document(kind: VaultDocument["kind"], locked: boolean): Pick<VaultDocument, "kind" | "locked"> {
  return { kind, locked };
}

describe("note locking", () => {
  it("forces locked notes into reading mode without changing the workspace mode", () => {
    const workspaceMode = "source" as const;
    expect(effectiveEditorMode(workspaceMode, document("note", true))).toBe("readonly");
    expect(workspaceMode).toBe("source");
  });

  it("leaves unlocked notes and folders in the workspace mode", () => {
    expect(effectiveEditorMode("live", document("note", false))).toBe("live");
    expect(effectiveEditorMode("source", document("folder", true))).toBe("source");
    expect(isLockedNote(document("folder", true))).toBe(false);
  });

  it("unlocks explicit copies but preserves protection on conflict copies", () => {
    const locked = document("note", true);
    expect(derivedNoteLockState(locked, "explicit-copy")).toBe(false);
    expect(derivedNoteLockState(locked, "conflict-copy")).toBe(true);
  });
});
