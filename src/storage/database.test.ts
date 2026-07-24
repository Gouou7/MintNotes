import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cursorKey,
  deleteLocalUserData,
  ignoredDecryptFailuresKey,
  historySettingsKey,
  localDb,
  preferencesKey
} from "./database";

afterEach(() => vi.restoreAllMocks());

describe("deleteLocalUserData", () => {
  it("scopes every deletion to the selected account", async () => {
    const userId = "user-a";
    const deleteObjects = vi.fn().mockResolvedValue(undefined);
    const deleteOutbox = vi.fn().mockResolvedValue(undefined);
    const deleteChunks = vi.fn().mockResolvedValue(undefined);
    const deleteChunkOutbox = vi.fn().mockResolvedValue(undefined);
    const deleteRevocations = vi.fn().mockResolvedValue(undefined);
    const deleteHistory = vi.fn().mockResolvedValue(undefined);
    const deleteHistoryOutbox = vi.fn().mockResolvedValue(undefined);
    const tableScenarios = [
      [localDb.objects, deleteObjects],
      [localDb.outbox, deleteOutbox],
      [localDb.attachmentChunks, deleteChunks],
      [localDb.attachmentOutbox, deleteChunkOutbox],
      [localDb.pendingEndpointRevocations, deleteRevocations],
      [localDb.historySnapshots, deleteHistory],
      [localDb.historyOutbox, deleteHistoryOutbox]
    ] as const;
    const equalsSpies: ReturnType<typeof vi.fn>[] = [];

    for (const [table, deletion] of tableScenarios) {
      const equals = vi.fn().mockReturnValue({ delete: deletion });
      equalsSpies.push(equals);
      vi.spyOn(table, "where").mockReturnValue({ equals } as never);
    }
    const deleteMeta = vi.spyOn(localDb.meta, "bulkDelete").mockResolvedValue(undefined);
    const deleteCredential = vi.spyOn(localDb.deviceCredentials, "delete").mockResolvedValue(undefined);
    vi.spyOn(localDb, "transaction").mockImplementation((...arguments_: unknown[]) => {
      const scope = arguments_.at(-1) as () => Promise<void>;
      return scope() as never;
    });

    await deleteLocalUserData(userId);

    for (const [table, deletion] of tableScenarios) {
      const index = tableScenarios.findIndex(([candidate]) => candidate === table);
      expect(table.where).toHaveBeenCalledWith("userId");
      expect(equalsSpies[index]).toHaveBeenCalledWith(userId);
      expect(deletion).toHaveBeenCalledOnce();
    }
    expect(deleteMeta).toHaveBeenCalledWith([
      cursorKey(userId),
      preferencesKey(userId),
      ignoredDecryptFailuresKey(userId),
      historySettingsKey(userId)
    ]);
    expect(deleteCredential).toHaveBeenCalledWith(userId);
  });
});
