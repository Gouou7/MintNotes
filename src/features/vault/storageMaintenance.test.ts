import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localDb } from "../../storage/database";
import type { OpenDocument } from "../../types";
import { testWorkspaceServices } from "../session/workspaceServices.testSupport";
import { maintainVaultStorage } from "./storageMaintenance";

const { api } = vi.hoisted(() => ({ api: vi.fn<(path: string) => Promise<unknown>>() }));
vi.mock("../../api", () => ({ api }));

const userId = "user";
const note: OpenDocument = {
  objectId: "note", kind: "note", title: "Note", markdown: "Body", parentId: null,
  tags: [], favorite: false, locked: false, deleted: false, attachmentIds: [], manualOrder: 0,
  createdAt: "2026-01-01", updatedAt: "2026-01-01", schemaVersion: 2, serverRevision: 1, dirty: false
};
const historyPath = `/api/notes/${note.objectId}/history?limit=100`;
const invalidKey = `history-invalid:${userId}:${note.objectId}`;
const verifiedKey = `history-verified:${userId}:${note.objectId}`;
const collectionKey = `attachment-gc:${userId}`;

function maintain(version: number) {
  api.mockImplementation(async (path) => {
    if (path === "/api/attachments/ownership") return { complete: 1, version: 1, notes: [] };
    if (path === historyPath) return { items: [], nextCursor: null, version };
    throw new Error(`Unexpected request: ${path}`);
  });
  return maintainVaultStorage({ services: testWorkspaceServices(), userId, isActive: () => true, documents: [note], attachments: [] });
}

describe("history directory maintenance", () => {
  beforeEach(async () => {
    api.mockReset();
    await localDb.meta.clear();
    await localDb.meta.put({ key: `sync-state:${userId}`, value: JSON.stringify({ epoch: "current" }) });
  });

  it.each([0, 3])("reuses a directory at version %i after the periodic check when there is no change notice", async (version) => {
    await maintain(version);
    expect((await localDb.meta.get(verifiedKey))?.value).toBe(String(version));
    expect(await localDb.meta.get(collectionKey)).toBeDefined();
    await maintain(version);
    expect(api.mock.calls.filter(([path]) => path === historyPath)).toHaveLength(1);
  });

  it("refreshes once when a remote history change arrives between periodic checks", async () => {
    await localDb.meta.bulkPut([
      { key: collectionKey, value: String(Date.now()) },
      { key: verifiedKey, value: "0" },
      { key: invalidKey, value: "1" }
    ]);
    await maintain(1);
    expect((await localDb.meta.get(verifiedKey))?.value).toBe("1");
    await maintain(1);
    expect(api.mock.calls.filter(([path]) => path === historyPath)).toHaveLength(1);
  });
});
