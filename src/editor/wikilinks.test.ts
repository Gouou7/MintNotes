import { describe, expect, it } from "vitest";
import type { OpenDocument } from "../types";
import { parseWikiLinkTarget, resolveWikiLink } from "./wikilinks";

function document(objectId: string, kind: "note" | "folder", title: string, parentId: string | null): OpenDocument {
  return {
    objectId,
    kind,
    title,
    parentId,
    markdown: "",
    tags: [],
    favorite: false,
    deleted: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    manualOrder: 0,
    attachmentIds: [],
    schemaVersion: 2,
    serverRevision: 0,
    dirty: false
  };
}

describe("WikiLinks", () => {
  it("parses note and heading targets", () => {
    expect(parseWikiLinkTarget("./Guide/Setup.md#Install")).toEqual({
      note: "Guide/Setup",
      heading: "Install"
    });
  });

  it("resolves folder paths and prefers a note in the current folder", () => {
    const folder = document("folder", "folder", "Guide", null);
    const rootSetup = document("root-setup", "note", "Setup", null);
    const nestedSetup = document("nested-setup", "note", "Setup", folder.objectId);
    const current = document("current", "note", "Current", folder.objectId);
    const documents = [folder, rootSetup, nestedSetup, current];

    expect(resolveWikiLink(documents, "Guide/Setup#Install", current)?.objectId).toBe(nestedSetup.objectId);
    expect(resolveWikiLink(documents, "Setup", current)?.objectId).toBe(nestedSetup.objectId);
    expect(resolveWikiLink(documents, "#Local", current)?.objectId).toBe(current.objectId);
  });
});
