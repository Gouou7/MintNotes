import { afterEach, describe, expect, it, vi } from "vitest";
import { withVaultSyncLock } from "./syncLock";

afterEach(() => vi.unstubAllGlobals());
describe("cross-tab synchronization ownership", () => {
  it("holds recovery and acknowledgements in one user lane while another user can proceed", async () => {
    const lanes = new Map<string, Promise<unknown>>();
    const request = vi.fn((name: string, operation: () => Promise<void>) => {
      const result = (lanes.get(name) ?? Promise.resolve()).then(operation);
      lanes.set(name, result.catch(() => {}));
      return result;
    });
    vi.stubGlobal("navigator", { locks: { request } });
    const events: string[] = [];
    let release!: () => void;
    const first = withVaultSyncLock("user", async () => {
      events.push("first started");
      await new Promise<void>((resolve) => { release = resolve; });
      events.push("first committed");
    });
    const second = withVaultSyncLock("user", async () => { events.push("second started"); });
    await withVaultSyncLock("another-user", async () => { events.push("other user"); });
    expect(events).toEqual(["first started", "other user"]);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first started", "other user", "first committed", "second started"]);
    expect(request.mock.calls.map(([name]) => name)).toEqual(["webmd-vault-sync:user", "webmd-vault-sync:user", "webmd-vault-sync:another-user"]);
  });
  it("keeps storage-based proposal protection usable without the optional browser lock API", async () => {
    vi.stubGlobal("navigator", {});
    const run = vi.fn(async () => {});
    await withVaultSyncLock("user", run);
    expect(run).toHaveBeenCalledOnce();
  });
});
