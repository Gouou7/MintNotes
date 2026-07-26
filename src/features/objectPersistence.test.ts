import { describe, expect, it } from "vitest";
import type { OpenDocument } from "../types";
import { prepareObjectForPersistence } from "./objectPersistence";

const note: OpenDocument = {
  objectId: "note-1",
  kind: "note",
  title: "Note",
  markdown: "Body",
  parentId: null,
  tags: [],
  favorite: false,
  locked: false,
  deleted: false,
  createdAt: "2026-07-25T01:00:00.000Z",
  updatedAt: "2026-07-25T02:00:00.000Z",
  manualOrder: 0,
  attachmentIds: [],
  schemaVersion: 2,
  serverRevision: 3,
  dirty: false
};

describe("prepareObjectForPersistence", () => {
  it("updates the modification time for ordinary changes", () => {
    const next = prepareObjectForPersistence(note, 4, { now: "2026-07-26T01:00:00.000Z" });
    expect(next.updatedAt).toBe("2026-07-26T01:00:00.000Z");
    expect(next.serverRevision).toBe(4);
    expect(next.dirty).toBe(true);
  });

  it("preserves the note modification time for metadata-only changes", () => {
    const next = prepareObjectForPersistence(
      { ...note, locked: true },
      4,
      { preserveUpdatedAt: true, now: "2026-07-26T01:00:00.000Z" }
    );
    expect(next.locked).toBe(true);
    expect(next.updatedAt).toBe(note.updatedAt);
    expect(next.serverRevision).toBe(4);
    expect(next.dirty).toBe(true);
  });
});
