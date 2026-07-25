import { describe, expect, it } from "vitest";
import type { OpenDocument } from "../types";
import { documentPatchChanges } from "./documentPatch";

const document: OpenDocument = {
  objectId: "note-1",
  kind: "note",
  title: "Note",
  markdown: "Hello",
  parentId: null,
  tags: ["one", "two"],
  favorite: false,
  deleted: false,
  createdAt: "2026-07-25T01:00:00.000Z",
  updatedAt: "2026-07-25T01:00:00.000Z",
  manualOrder: 0,
  attachmentIds: ["attachment-1"],
  schemaVersion: 2,
  serverRevision: 1,
  dirty: false
};

describe("documentPatchChanges", () => {
  it("ignores patches that reproduce the current content", () => {
    expect(documentPatchChanges(document, {
      markdown: "Hello",
      attachmentIds: ["attachment-1"]
    })).toBe(false);
  });

  it("detects scalar and array content changes", () => {
    expect(documentPatchChanges(document, { markdown: "Hello!" })).toBe(true);
    expect(documentPatchChanges(document, { tags: ["one", "three"] })).toBe(true);
  });
});
