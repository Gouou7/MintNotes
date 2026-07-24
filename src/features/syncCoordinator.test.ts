import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SyncCoordinator,
  acknowledgeByObjectId,
  mergeByObjectId,
  packBySerializedSize
} from "./syncCoordinator";

describe("SyncCoordinator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces repeated trailing requests and enforces the first hard deadline", async () => {
    const execute = vi.fn(async () => undefined);
    const coordinator = new SyncCoordinator({ execute });

    coordinator.request({ push: true }, { delayMs: 2_000, maxWaitMs: 15_000 });
    for (let elapsed = 1_000; elapsed < 15_000; elapsed += 1_000) {
      await vi.advanceTimersByTimeAsync(1_000);
      coordinator.request({ push: true }, { delayMs: 2_000, maxWaitMs: 15_000 });
    }
    await vi.advanceTimersByTimeAsync(1_000);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ pull: false, push: true });
    coordinator.dispose();
  });

  it("merges pull and push work and serializes a follow-up request", async () => {
    let release: (() => void) | undefined;
    let callCount = 0;
    const execute = vi.fn(() => {
      callCount += 1;
      return callCount === 1 ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
    });
    const coordinator = new SyncCoordinator({ execute });
    const first = coordinator.runNow({ pull: true });
    await vi.advanceTimersByTimeAsync(0);
    coordinator.request({ push: true }, { delayMs: 0, maxWaitMs: 0 });
    release?.();
    await first;
    expect(execute).toHaveBeenNthCalledWith(1, { pull: true, push: false });
    expect(execute).toHaveBeenNthCalledWith(2, { pull: false, push: true });
    coordinator.dispose();
  });

  it("keeps pending work while execution is paused", async () => {
    let enabled = false;
    const execute = vi.fn(async () => undefined);
    const coordinator = new SyncCoordinator({ execute, canRun: () => enabled });
    coordinator.request({ pull: true, push: true }, { delayMs: 0, maxWaitMs: 0 });
    await vi.runAllTimersAsync();
    expect(execute).not.toHaveBeenCalled();
    enabled = true;
    await coordinator.resume();
    expect(execute).toHaveBeenCalledWith({ pull: true, push: true });
    coordinator.dispose();
  });

  it("limits a minute of continuous editor activity to four deadline batches", async () => {
    const execute = vi.fn(async () => undefined);
    const coordinator = new SyncCoordinator({ execute });
    for (let second = 0; second < 60; second += 1) {
      coordinator.request({ push: true }, { delayMs: 2_000, maxWaitMs: 15_000 });
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(execute).toHaveBeenCalledTimes(4);
    coordinator.dispose();
  });
});

describe("synchronization batch helpers", () => {
  it("merges updates and removals in one indexed pass", () => {
    const current = [
      { objectId: "a", value: 1 },
      { objectId: "b", value: 2 }
    ];
    expect(mergeByObjectId(current, [{ objectId: "b", value: 3 }, { objectId: "c", value: 4 }], ["a"])).toEqual([
      { objectId: "b", value: 3 },
      { objectId: "c", value: 4 }
    ]);
  });

  it("applies upload acknowledgements without scanning once per object", () => {
    const current = [
      { objectId: "a", serverRevision: 1, dirty: true },
      { objectId: "b", serverRevision: 2, dirty: true }
    ];
    expect(acknowledgeByObjectId(current, new Map([["b", 3]]))).toEqual([
      current[0],
      { objectId: "b", serverRevision: 3, dirty: false }
    ]);
  });

  it("packs entries by count and encoded payload size with single-object fallback", () => {
    const entries = ["a", "bb", "x".repeat(20)];
    const packed = packBySerializedSize(entries, (batch) => JSON.stringify(batch), 2, 12);
    expect(packed.batches).toEqual([["a", "bb"]]);
    expect(packed.oversized).toEqual(["x".repeat(20)]);
  });

  it("merges five hundred changes into ten thousand objects without nested scans", () => {
    const current = Array.from({ length: 10_000 }, (_, index) => ({ objectId: `note-${index}`, revision: 1 }));
    const changes = Array.from({ length: 500 }, (_, index) => ({ objectId: `note-${index * 2}`, revision: 2 }));
    const merged = mergeByObjectId(current, changes);
    expect(merged).toHaveLength(10_000);
    expect(new Map(merged.map((entry) => [entry.objectId, entry])).get("note-998")?.revision).toBe(2);
  });
});
