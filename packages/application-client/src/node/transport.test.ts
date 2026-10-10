// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { ApplicationTransport } from "./transport";
afterEach(() => vi.unstubAllGlobals());
it("does not expose an arbitrary server error code or response message", async () => {
  const secret = "SECRETVALUEABCDEFGHIJKLMNPQRSTUVWX";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: secret, error: secret }), { status: 401 })));
  const transport = new ApplicationTransport("https://notes.example.test", secret, new AbortController().signal);
  await expect(transport.json("/connection")).rejects.toMatchObject({ code: "HTTP_401", status: 401, message: "The notes request was rejected" });
  transport.dispose();
});
