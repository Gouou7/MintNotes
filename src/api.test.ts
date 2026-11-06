import { afterEach, expect, it, vi } from "vitest";
import { createApiClient } from "./api";
const { downloadAttachmentChunk } = createApiClient();
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


it("discards a late unauthorized response after rebinding", async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  try {
    const invalidated = vi.fn();
    const client = createApiClient({ requireSession: true, onInvalid: invalidated });
    client.bindSession("account-a");
    const request = client.api("/api/auth/me");
    client.bindSession("account-b");
    finish(Response.json({ code: "BROWSER_SESSION_INVALID" }, { status: 401 }));
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(invalidated).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});
