import { describe, expect, it } from "vitest";
import type { OpenDocument } from "../types";
import { canMoveDocument, compareDocuments, isFolderDropZone, lockedNoteInSelection, pinnedDocuments, reorderedSiblingBatch, reorderedSiblings, resolveManualDropBeforeId, selectionRoots, siblingTitleExists, treeDropPosition, treeSelectionRange, uniqueSiblingTitle, visibleTreeOrder } from "./tree";

function doc(objectId: string, parentId: string | null, manualOrder: number, kind: "note" | "folder" = "note"): OpenDocument {
  return { objectId, parentId, manualOrder, kind, title: objectId, markdown: "", tags: [], favorite: false, locked: false, deleted: false, createdAt: "2026-01-01", updatedAt: "2026-01-01", attachmentIds: [], schemaVersion: 2, serverRevision: 0, dirty: false };
}

describe("tree operations", () => {
  it("rejects moving a folder into a descendant", () => {
    const documents = [doc("root", null, 1, "folder"), doc("child", "root", 1, "folder")];
    expect(canMoveDocument(documents, "root", "child")).toBe(false);
    expect(canMoveDocument(documents, "child", null)).toBe(true);
  });

  it("renumbers manual siblings deterministically", () => {
    const documents = [doc("a", null, 1024), doc("b", null, 2048), doc("c", null, 3072)];
    expect(reorderedSiblings(documents, "c", null, "a").map((entry) => entry.objectId)).toEqual(["c", "a", "b"]);
    expect(reorderedSiblings(documents, "a", null, "missing").map((entry) => entry.objectId)).toEqual(["b", "c", "a"]);
    expect(documents.slice().sort(compareDocuments("manual")).map((entry) => entry.objectId)).toEqual(["a", "b", "c"]);
  });

  it("generates the first available title among non-deleted siblings", () => {
    const first = { ...doc("first", null, 1024), title: "无标题笔记" };
    const second = { ...doc("second", null, 2048), title: "无标题笔记 2" };
    const deleted = { ...doc("deleted", null, 3072), title: "无标题笔记 3", deleted: true };
    const nested = { ...doc("nested", "folder", 1024), title: "无标题笔记 3" };
    const documents = [first, second, deleted, nested];

    expect(uniqueSiblingTitle(documents, "无标题笔记", null)).toBe("无标题笔记 3");
    expect(uniqueSiblingTitle(documents, "无标题笔记", "folder")).toBe("无标题笔记");
  });

  it("treats note and folder titles as one sibling namespace", () => {
    const folder = { ...doc("folder", null, 1024, "folder"), title: "项目" };
    expect(siblingTitleExists([folder], "项目", null)).toBe(true);
    expect(siblingTitleExists([folder], "项目", null, folder.objectId)).toBe(false);
  });

  it("builds shift-selection order from sorted, expanded tree rows", () => {
    const folder = { ...doc("folder", null, 1024, "folder"), title: "A folder" };
    const child = { ...doc("child", "folder", 1024), title: "Child" };
    const sibling = { ...doc("sibling", null, 2048), title: "B note" };
    const documents = [sibling, child, folder];

    expect(visibleTreeOrder(documents, new Set(), "alphabetical").map((entry) => entry.objectId)).toEqual(["folder", "sibling"]);
    const visible = visibleTreeOrder(documents, new Set(["folder"]), "alphabetical");
    expect(visible.map((entry) => entry.objectId)).toEqual(["folder", "child", "sibling"]);
    expect(treeSelectionRange(visible, "folder", "sibling")).toEqual(["folder", "child", "sibling"]);
    expect(treeSelectionRange(visible, "missing", "child")).toEqual(["child"]);
  });

  it("removes selected descendants from recursive batch roots", () => {
    const folder = doc("folder", null, 1024, "folder");
    const child = doc("child", "folder", 1024);
    const sibling = doc("sibling", null, 2048);
    expect(selectionRoots([folder, child, sibling], ["folder", "child", "sibling"])).toEqual(["folder", "sibling"]);
  });

  it("finds locked notes directly and at any folder depth", () => {
    const root = doc("root", null, 1024, "folder");
    const nested = doc("nested", "root", 1024, "folder");
    const locked = { ...doc("locked", "nested", 1024), locked: true };
    const unlocked = doc("unlocked", null, 2048);
    const documents = [root, nested, locked, unlocked];

    expect(lockedNoteInSelection(documents, ["locked"])?.objectId).toBe("locked");
    expect(lockedNoteInSelection(documents, ["root"])?.objectId).toBe("locked");
    expect(lockedNoteInSelection(documents, ["unlocked"])).toBeUndefined();
  });

  it("blocks a mixed selection as a whole but ignores deleted locked notes", () => {
    const unlocked = doc("unlocked", null, 1024);
    const locked = { ...doc("locked", null, 2048), locked: true };
    const deletedLocked = { ...doc("deleted-locked", null, 3072), locked: true, deleted: true };

    expect(lockedNoteInSelection([unlocked, locked], ["unlocked", "locked"])?.objectId).toBe("locked");
    expect(lockedNoteInSelection([unlocked, deletedLocked], ["unlocked", "deleted-locked"])).toBeUndefined();
  });

  it("builds a sorted pinned shortcut list without deleted items", () => {
    const note = { ...doc("note", null, 1024), favorite: true, title: "B note" };
    const folder = { ...doc("folder", null, 2048, "folder"), favorite: true, title: "A folder" };
    const deleted = { ...doc("deleted", null, 3072), favorite: true, deleted: true };
    expect(pinnedDocuments([note, deleted, folder], "alphabetical").map((entry) => entry.objectId)).toEqual(["folder", "note"]);
  });

  it("only treats the middle of a folder row as an inside-folder drop zone", () => {
    expect(isFolderDropZone("folder", .5)).toBe(true);
    expect(isFolderDropZone("folder", .1)).toBe(false);
    expect(isFolderDropZone("note", .5)).toBe(false);
  });

  it("describes manual insertion positions separately from inside-folder drops", () => {
    expect(treeDropPosition("folder", .1, true)).toBe("before");
    expect(treeDropPosition("folder", .5, true)).toBe("inside");
    expect(treeDropPosition("folder", .9, true)).toBe("after");
    expect(treeDropPosition("note", .1, true)).toBe("before");
    expect(treeDropPosition("note", .9, true)).toBe("after");
    expect(treeDropPosition("note", .5, false)).toBeNull();
    expect(treeDropPosition("folder", .5, false)).toBe("inside");
  });

  it("keeps drops onto the moving selection anchored at its original position", () => {
    const documents = [
      doc("a", null, 1024),
      doc("b", null, 2048),
      doc("c", null, 3072)
    ];
    expect(resolveManualDropBeforeId(documents, new Set(["b"]), null, "b")).toBe("c");
    expect(resolveManualDropBeforeId(documents, new Set(["c"]), null, "c")).toBeNull();
    expect(resolveManualDropBeforeId(documents, new Set(["a", "b"]), null, "a")).toBe("c");
    expect(resolveManualDropBeforeId(documents, new Set(["a"]), null, "c")).toBe("c");
    const anchoredBeforeId = resolveManualDropBeforeId(documents, new Set(["b"]), null, "b");
    expect(reorderedSiblings(documents, "b", null, anchoredBeforeId).map((entry) => entry.objectId)).toEqual(["a", "b", "c"]);
    const batchBeforeId = resolveManualDropBeforeId(documents, new Set(["a", "b"]), null, "a");
    expect(reorderedSiblingBatch(documents, ["a", "b"], null, batchBeforeId).map((entry) => entry.objectId)).toEqual(["a", "b", "c"]);
  });
});
