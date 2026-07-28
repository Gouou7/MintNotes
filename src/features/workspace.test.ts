import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVICE_WORKSPACE_PREFERENCES,
  parseLegacyWorkspaceState,
  resolveDeviceActiveNoteId,
  resolveDeviceWorkspacePreferences,
  shouldSynchronizeWorkspaceObject,
  WORKSPACE_OBJECT_ID
} from "./workspace";
import type { OpenDocument } from "../types";

describe("workspace state", () => {
  it("parses legacy synchronized workspace records for local migration", () => {
    const document = {
      markdown: JSON.stringify({
        version: 1,
        activeNoteId: "note-b",
        openNoteIds: ["note-a"],
        editorMode: "source",
        treeCollapsed: true,
        outlineCollapsed: false
      })
    };

    expect(parseLegacyWorkspaceState(document)).toEqual({
      version: 1,
      activeNoteId: "note-b",
      openNoteIds: ["note-a", "note-b"],
      editorMode: "source",
      treeCollapsed: true,
      outlineCollapsed: false
    });
  });

  it("rejects malformed or unknown workspace versions", () => {
    expect(parseLegacyWorkspaceState({ markdown: "not-json" })).toBeNull();
    expect(parseLegacyWorkspaceState({ markdown: JSON.stringify({ version: 2 }) })).toBeNull();
  });

  it("restores legacy version-one workspaces in live mode", () => {
    expect(parseLegacyWorkspaceState({ markdown: JSON.stringify({
      version: 1,
      activeNoteId: "note-a",
      openNoteIds: ["note-a"],
      treeCollapsed: false,
      outlineCollapsed: false
    }) })?.editorMode).toBe("live");
  });

  it("prefers versioned device-local workspace preferences over legacy synchronized state", () => {
    expect(resolveDeviceWorkspacePreferences({
      workspaceVersion: 1,
      activeNoteId: "local-note",
      openNoteIds: [],
      editorMode: "readonly",
      treeCollapsed: false,
      outlineCollapsed: true
    }, {
      version: 1,
      activeNoteId: "remote-note",
      openNoteIds: ["remote-note"],
      editorMode: "source",
      treeCollapsed: true,
      outlineCollapsed: false
    })).toEqual({
      workspaceVersion: 1,
      activeNoteId: "local-note",
      openNoteIds: ["local-note"],
      editorMode: "readonly",
      treeCollapsed: false,
      outlineCollapsed: true
    });
  });

  it("migrates only a locally supplied legacy record and otherwise starts blank", () => {
    const legacy = {
      version: 1 as const,
      activeNoteId: "legacy-note",
      openNoteIds: ["legacy-note"],
      editorMode: "source" as const,
      treeCollapsed: true,
      outlineCollapsed: true
    };
    expect(resolveDeviceWorkspacePreferences({}, legacy)).toMatchObject({
      activeNoteId: "legacy-note",
      editorMode: "source",
      treeCollapsed: true,
      outlineCollapsed: true
    });
    expect(resolveDeviceWorkspacePreferences({}, null)).toEqual(DEFAULT_DEVICE_WORKSPACE_PREFERENCES);
  });

  it("restores only a live note and otherwise leaves the editor blank", () => {
    const document = (objectId: string, kind: "note" | "folder", deleted = false): OpenDocument => ({
      objectId,
      kind,
      title: objectId,
      markdown: "",
      parentId: null,
      tags: [],
      favorite: false,
      locked: false,
      deleted,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
      manualOrder: 0,
      attachmentIds: [],
      schemaVersion: 2,
      serverRevision: 1,
      dirty: false
    });
    const documents = [
      document("live-note", "note"),
      document("deleted-note", "note", true),
      document("folder", "folder")
    ];

    expect(resolveDeviceActiveNoteId("live-note", documents)).toBe("live-note");
    expect(resolveDeviceActiveNoteId("deleted-note", documents)).toBeNull();
    expect(resolveDeviceActiveNoteId("folder", documents)).toBeNull();
    expect(resolveDeviceActiveNoteId("missing", documents)).toBeNull();
    expect(resolveDeviceActiveNoteId(null, documents)).toBeNull();
  });

  it("excludes the legacy workspace control object from synchronization", () => {
    expect(shouldSynchronizeWorkspaceObject(WORKSPACE_OBJECT_ID)).toBe(false);
    expect(shouldSynchronizeWorkspaceObject("note-a")).toBe(true);
  });
});
