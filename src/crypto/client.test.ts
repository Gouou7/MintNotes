import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    FakeWorker.instances.push(this);
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("crypto client worker lifecycle", () => {
  it("rejects pending and future operations when the worker crashes", async () => {
    const { createCryptoClient } = await import("./client");
    const client = createCryptoClient();
    const worker = FakeWorker.instances.at(-1)!;
    const pending = client.lock();
    const preventDefault = vi.fn();

    worker.onerror?.({ preventDefault } as unknown as ErrorEvent);

    await expect(pending).rejects.toThrow("Crypto worker became unavailable");
    await expect(client.lock()).rejects.toThrow("Crypto worker became unavailable");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
