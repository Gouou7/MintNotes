import { describe, expect, it } from "vitest";
import type { OpenDocument } from "../types";
import { createTrashView } from "./trashView";

function item(objectId: string, title: string, kind: OpenDocument["kind"], parentId: string | null, updatedAt: string): OpenDocument {
  return {
    objectId,
    title,
    kind,
    parentId,
    markdown: "",
    tags: [],
    favorite: false,
    locked: false,
    deleted: true,
    createdAt: updatedAt,
    updatedAt,
    manualOrder: 0,
    attachmentIds: [],
    schemaVersion: 2,
    serverRevision: 1,
    dirty: false
  };
}

const items = [
  item("older", "Archive", "folder", null, "2026-07-01T00:00:00.000Z"),
  item("nested", "Project note", "note", "older", "2026-07-01T00:00:00.000Z"),
  item("newer", "Today", "note", null, "2026-08-01T00:00:00.000Z")
];

describe("createTrashView", () => {
  it("sorts deleted roots by newest deletion and counts every descendant", () => {
    const view = createTrashView(items, "", "all", "deleted-desc");
    expect(view.roots.map((entry) => entry.objectId)).toEqual(["newer", "older"]);
    expect(view.descendantCounts.get("older")).toBe(1);
    expect(view.automaticallyExpandedIds.size).toBe(0);
  });

  it("keeps matching nested items with their ancestor path", () => {
    const view = createTrashView(items, "project", "note", "name");
    expect(view.roots.map((entry) => entry.objectId)).toEqual(["older"]);
    expect(view.childrenByParent.get("older")?.map((entry) => entry.objectId)).toEqual(["nested"]);
    expect(view.automaticallyExpandedIds.has("older")).toBe(true);
    expect(view.matchCount).toBe(1);
  });
});
