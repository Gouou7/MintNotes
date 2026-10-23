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
  it.each(["", "Decryption failed"])("rejects an unlock error with message %j and allows retry", async (message) => {
    const { createCryptoClient } = await import("./client");
    const client = createCryptoClient();
    const worker = FakeWorker.instances.at(-1)!;
    const unlock = () => client.unlockVaultFromDeviceWithPin(
      "user-id", "endpoint-id", {} as CryptoKey, "1234", "salt", "ciphertext", "nonce", 1
    );
    const rejected = expect(unlock()).rejects.toThrow(message || "Cryptographic operation failed");
    const failedRequest = worker.postMessage.mock.calls.at(-1)![0];
    worker.onmessage?.({ data: { id: failedRequest.id, error: message } } as MessageEvent);
    await rejected;

    const retry = unlock();
    const retryRequest = worker.postMessage.mock.calls.at(-1)![0];
    worker.onmessage?.({ data: { id: retryRequest.id, result: { unlocked: true } } } as MessageEvent);
    await expect(retry).resolves.toEqual({ unlocked: true });
    expect(worker.terminate).not.toHaveBeenCalled();
  });

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
