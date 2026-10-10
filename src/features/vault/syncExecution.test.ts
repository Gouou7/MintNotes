import { describe, expect, it, vi } from "vitest";
import { executeVaultSync } from "./syncExecution";

describe("vault synchronization execution", () => {
  it("drains failed writes on a periodic pull and reconciles uploads before remote changes", async () => {
    const order: string[] = [];
    const dependencies = {
      isActive: () => true,
      countPending: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      push: vi.fn(async () => { order.push("push"); }),
      pull: vi.fn(async () => { order.push("pull"); return new Set<string>(); })
    };
    expect(await executeVaultSync(dependencies, { pull: true, push: false })).toMatchObject({ pending: 0 });
    expect(order).toEqual(["push", "pull"]);
  });

  it("does not pull after locking while an upload was in flight", async () => {
    let active = true;
    const pull = vi.fn();
    await executeVaultSync({
      isActive: () => active, countPending: async () => 1,
      push: async () => { active = false; }, pull
    }, { pull: true, push: true });
    expect(pull).not.toHaveBeenCalled();
  });
});
