import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApplicationConnections } from "./useApplicationConnections";
import { api } from "../../api";
import { cryptoClient } from "../../crypto/client";
vi.mock("../../api", () => ({ api: vi.fn() }));
vi.mock("../../crypto/client", () => ({ cryptoClient: { createApplicationCredential: vi.fn() } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let current: ReturnType<typeof useApplicationConnections>;
const credential = { applicationKey: "test-key", connectionId: "test-id", authSecret: "test-auth", vaultEnvelope: { version: 1 as const, ciphertext: "wrapped", nonce: "nonce" } };
function Harness({ userId = "user", online = true }: { userId?: string; online?: boolean }) { current = useApplicationConnections(userId, online); return null; }
async function render(online = true, userId = "user") {
  if (!root) { const container = document.createElement("div"); document.body.append(container); root = createRoot(container); }
  await act(async () => root.render(<Harness online={online} userId={userId} />));
}
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined as never; document.body.replaceChildren(); vi.resetAllMocks(); });
describe("application connection controller", () => {
  it("shows a key only after acknowledged registration and retries the same credential", async () => {
    let fails = true;
    vi.mocked(api).mockImplementation(async (_path, init) => {
      if (init?.method === "POST") { if (fails) throw new Error("network"); return { connection: { connectionId: "test-id", status: "active" } } as never; }
      return { connections: [] } as never;
    });
    vi.mocked(cryptoClient.createApplicationCredential).mockResolvedValue(credential);
    await render();
    const policy = { name: "plugin", idleTimeoutDays: 30 as const, expiresAt: null };
    await act(async () => { await current.create(policy, "read-write"); });
    expect(current.applicationKey).toBe(null); expect(current.retryPending).toBe(true);
    const original = vi.mocked(api).mock.calls.find(([, init]) => init?.method === "POST")![1]!.body;
    fails = false;
    await act(async () => { await current.create({ ...policy, name: "modified" }, "read"); });
    expect(vi.mocked(api).mock.calls.filter(([, init]) => init?.method === "POST")[1][1]?.body).toBe(original);
    expect(cryptoClient.createApplicationCredential).toHaveBeenCalledTimes(1);
    expect(current.applicationKey).toBe("test-key");
    await act(async () => current.dismissKey()); expect(current.applicationKey).toBe(null);
    await act(async () => { await current.refresh(); }); expect(current.applicationKey).toBe(null);
  });
  it("allows correcting a definitively rejected policy", async () => {
    vi.mocked(api).mockImplementation(async (_path, init) => {
      if (init?.method === "POST") throw Object.assign(new Error("invalid expiry"), { status: 400 });
      return { connections: [] } as never;
    });
    vi.mocked(cryptoClient.createApplicationCredential).mockResolvedValue(credential);
    await render();
    await act(async () => { await current.create({ name: "plugin", idleTimeoutDays: 30, expiresAt: "2000-01-01T00:00:00Z" }, "read-write"); });
    expect(current.retryPending).toBe(false); expect(current.applicationKey).toBe(null);
    await act(async () => { await current.create({ name: "corrected", idleTimeoutDays: 30, expiresAt: null }, "read-write"); });
    expect(cryptoClient.createApplicationCredential).toHaveBeenCalledTimes(2);
  });
  it("discards an in-flight credential when the session loses online validation", async () => {
    vi.mocked(api).mockResolvedValue({ connections: [] } as never);
    let resolve!: (value: typeof credential) => void;
    vi.mocked(cryptoClient.createApplicationCredential).mockImplementation(() => new Promise((done) => { resolve = done; }));
    await render();
    let operation!: Promise<boolean>;
    await act(async () => { operation = current.create({ name: "plugin", idleTimeoutDays: 30, expiresAt: null }, "read-write"); });
    await render(false);
    await act(async () => { resolve(credential); await operation; });
    expect(current.applicationKey).toBe(null);
    expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    await act(async () => { await current.create({ name: "offline", idleTimeoutDays: null, expiresAt: null }, "read"); });
    expect(cryptoClient.createApplicationCredential).toHaveBeenCalledTimes(1);
  });
});
