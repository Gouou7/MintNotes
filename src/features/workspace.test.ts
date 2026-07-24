import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_STATE, makeWorkspaceDocument, parseWorkspaceState, workspaceStateEquals } from "./workspace";

describe("workspace state", () => {
  it("keeps a versioned open-note list as the foundation for future tabs", () => {
    const document = makeWorkspaceDocument({
      version: 1,
      activeNoteId: "note-b",
      openNoteIds: ["note-a"],
      editorMode: "source",
      treeCollapsed: true,
      outlineCollapsed: false
    });

    expect(parseWorkspaceState(document)).toEqual({
      version: 1,
      activeNoteId: "note-b",
      openNoteIds: ["note-a", "note-b"],
      editorMode: "source",
      treeCollapsed: true,
      outlineCollapsed: false
    });
  });

  it("rejects malformed or unknown workspace versions", () => {
    expect(parseWorkspaceState({ markdown: "not-json" })).toBeNull();
    expect(parseWorkspaceState({ markdown: JSON.stringify({ version: 2 }) })).toBeNull();
    expect(workspaceStateEquals(DEFAULT_WORKSPACE_STATE, { ...DEFAULT_WORKSPACE_STATE })).toBe(true);
  });

  it("restores legacy version-one workspaces in live mode", () => {
    expect(parseWorkspaceState({ markdown: JSON.stringify({
      version: 1,
      activeNoteId: "note-a",
      openNoteIds: ["note-a"],
      treeCollapsed: false,
      outlineCollapsed: false
    }) })?.editorMode).toBe("live");
  });
});
