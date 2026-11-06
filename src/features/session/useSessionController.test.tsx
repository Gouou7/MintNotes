import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDb, type DeviceUnlockCredential } from "../../storage/database";
import { writeSelection } from "./browserCoordinator";
import { useSessionController } from "./useSessionController";

const mocks = vi.hoisted(() => ({ dispose: vi.fn(), unlock: vi.fn(), unlockPin: vi.fn() }));
vi.mock("../../crypto/client", () => ({
  createCryptoClient: () => ({ dispose: mocks.dispose, unlockVaultFromDevice: mocks.unlock, unlockVaultFromDeviceWithPin: mocks.unlockPin,
    lock: vi.fn().mockResolvedValue(undefined), wrapVaultForDevice: vi.fn().mockResolvedValue({ ciphertext: "refresh", nonce: "nonce" }) })
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let controller: ReturnType<typeof useSessionController>;
function Harness() {
  controller = useSessionController();
  return null;
}
async function seed(id: string, pin = false) {
  const user = { id, username: id, displayName: id, role: "user" as const };
  const endpoint = { id: `endpoint-${id}`, remembered: true };
  const base = {
    version: 3 as const, userId: id, endpointId: endpoint.id, mode: "remembered" as const, deviceKey: {} as CryptoKey,
    verifiedSession: { version: 1 as const, user, endpoint, verifiedAt: new Date().toISOString() },
    failedPinAttempts: 0, autoLockMinutes: 0, updatedAt: new Date().toISOString()
  };
  const credential: DeviceUnlockCredential = pin
    ? { ...base, protection: "pin", pinKdfVersion: 1, pinSalt: "salt", pinCiphertext: "pin", pinNonce: "nonce" }
    : { ...base, protection: "device", ciphertext: "device", nonce: "nonce" };
  await localDb.deviceCredentials.put(credential);
  return { user, endpoint, credential };
}
async function boot() {
  await act(async () => root.render(<Harness />));
  await act(async () => { await vi.waitFor(() => expect(controller.restoring).toBe(false)); });
}

beforeEach(async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await localDb.delete();
  await localDb.open();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.unlock.mockResolvedValue(undefined);
  mocks.unlockPin.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await localDb.delete();
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("account lifecycle", () => {
  it("restores the selected account offline and asks for its own PIN on switch", async () => {
    const a = await seed("alpha");
    const b = await seed("beta", true);
    await writeSelection({ userId: a.user.id, generation: "old" });
    await boot();
    expect(controller.workspace?.account.user.id).toBe(a.user.id);
    expect(controller.online).toBe(false);
    const close = vi.fn().mockResolvedValue(true);
    controller.registerClose(close);
    await act(async () => controller.choose(b));
    expect(close).toHaveBeenCalledWith(false);
    expect(controller.workspace).toBeNull();
    expect(controller.locked?.user.id).toBe(b.user.id);
    expect(mocks.unlockPin).not.toHaveBeenCalled();
    await act(async () => { await controller.unlock("beta-pin"); });
    expect(controller.workspace?.account.user.id).toBe(b.user.id);
    expect(mocks.unlockPin.mock.calls[0]?.slice(0, 4)).toEqual([b.user.id, b.endpoint.id, {}, "beta-pin"]);
    expect(await localDb.deviceCredentials.get(a.user.id)).toEqual(a.credential);
  });

  it("keeps the original instance if a pending save fails", async () => {
    const a = await seed("alpha");
    const b = await seed("beta");
    await writeSelection({ userId: a.user.id, generation: "old" });
    await boot();
    const workspaceId = controller.workspace?.id;
    controller.registerClose(vi.fn().mockResolvedValue(false));
    await act(async () => controller.choose(b));
    expect(controller.workspace?.id).toBe(workspaceId);
    expect(controller.error).toBe("switchFailed");
    expect(mocks.dispose).not.toHaveBeenCalled();
  });

  it("retries a pending device revocation on reconnect while signed out", async () => {
    const target = { endpointId: "endpoint-a", grantId: "grant-a" };
    await localDb.pendingEndpointRevocations.put({ ...target, userId: "alpha", createdAt: new Date().toISOString() });
    await boot();
    expect(controller.workspace).toBeNull();
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(target));
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.waitFor(async () => expect(await localDb.pendingEndpointRevocations.get(target.endpointId)).toBeUndefined());
    });
    expect(fetch).toHaveBeenCalledWith("/api/auth/device-grant/revoke", expect.objectContaining({
      method: "POST", body: JSON.stringify(target)
    }));
  });

  it("exhausts only the selected account's PIN trust", async () => {
    const a = await seed("alpha");
    const b = await seed("beta", true);
    await writeSelection({ userId: b.user.id, generation: "old" });
    await boot();
    expect(controller.locked?.user.id).toBe(b.user.id);
    mocks.unlockPin.mockRejectedValue(new Error("Invalid PIN"));
    for (let index = 0; index < 5; index++) {
      await act(async () => { await controller.unlock("wrong"); });
    }
    expect(await localDb.deviceCredentials.get(b.user.id)).toBeUndefined();
    expect(await localDb.deviceCredentials.get(a.user.id)).toEqual(a.credential);
    expect(await localDb.pendingEndpointRevocations.get(b.endpoint.id)).toMatchObject({ userId: b.user.id });
  });
});
