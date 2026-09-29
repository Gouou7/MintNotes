import { afterEach, expect, it, vi } from "vitest";
import { downloadAttachmentChunk } from "./api";
afterEach(() => vi.unstubAllGlobals());
it("forwards cancellation to an in-flight attachment download", async () => {
  let received!: AbortSignal;
  vi.stubGlobal("fetch", vi.fn((_path, options: RequestInit) => {
    received = options.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => received.addEventListener("abort", () => reject(received.reason), { once: true }));
  }));
  const controller = new AbortController();
  const download = downloadAttachmentChunk("/api/attachments/example/chunks/0", controller.signal);
  const rejected = expect(download).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  expect(received.aborted).toBe(true);
});
