import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("caps concurrent work while preserving input order", async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const promise = mapWithConcurrency([3, 1, 2, 0], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return value * 10;
    });

    await Promise.resolve();
    expect(active).toBe(2);
    releases.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(2);
    while (releases.length) {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }

    await expect(promise).resolves.toEqual([30, 10, 20, 0]);
    expect(peak).toBe(2);
  });

  it("rejects invalid limits", async () => {
    await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow(RangeError);
  });
});
