import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { DeviceUnlockCredential } from "../storage/database";
import type { AuthEndpoint, User } from "../types";
import { LockScreen } from "./LockScreen";

vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../crypto/client", () => ({ cryptoClient: { prepareLogin: vi.fn(), unlockVault: vi.fn() } }));
vi.mock("../crypto/deviceUnlock", () => ({
  markEndpointRevocationPending: vi.fn(),
  restoreDeviceUnlock: vi.fn(),
  verifyDevicePin: vi.fn()
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];

const user: User = { id: "user-id", username: "user", displayName: "User", role: "user" };
const endpoint: AuthEndpoint = { id: "endpoint-id", remembered: true };
const credential: DeviceUnlockCredential = {
  userId: user.id,
  endpointId: endpoint.id,
  mode: "remembered",
  deviceKey: {} as CryptoKey,
  ciphertext: "ciphertext",
  nonce: "nonce",
  version: 2,
  pinSalt: "salt",
  pinVerifier: "verifier",
  failedPinAttempts: 0,
  autoLockMinutes: 0,
  updatedAt: "2026-07-24T00:00:00.000Z"
};

function button(container: HTMLElement, label: string) {
  const result = [...container.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button ${label}`);
  return result;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("LockScreen keyboard submission", () => {
  it("submits PIN and master-password unlock with Enter", async () => {
    localStorage.setItem("webmd-notes-language", "zh-CN");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<I18nProvider><LockScreen user={user} endpoint={endpoint} credential={credential} onUnlocked={vi.fn()} onTrustExhausted={vi.fn()} onLogout={vi.fn()} /></I18nProvider>));

    const pin = container.querySelector("input[type='password']") as HTMLInputElement;
    const pinSubmit = button(container, "使用 PIN 解锁");
    const pinRequestSubmit = vi.spyOn(pin.form!, "requestSubmit").mockImplementation(() => undefined);
    await act(async () => pin.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(pin.getAttribute("enterkeyhint")).toBe("done");
    expect(pinRequestSubmit).toHaveBeenCalledWith(pinSubmit);

    await act(async () => button(container, "改用主密码").click());
    const password = container.querySelector("input[type='password']") as HTMLInputElement;
    const passwordSubmit = button(container, "使用主密码解锁");
    const passwordRequestSubmit = vi.spyOn(password.form!, "requestSubmit").mockImplementation(() => undefined);
    await act(async () => password.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(password.getAttribute("enterkeyhint")).toBe("done");
    expect(passwordRequestSubmit).toHaveBeenCalledWith(passwordSubmit);
  });

  it("requires confirmation before deleting local data on logout", async () => {
    localStorage.setItem("webmd-notes-language", "zh-CN");
    const onLogout = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<I18nProvider><LockScreen user={user} endpoint={endpoint} credential={credential} onUnlocked={vi.fn()} onTrustExhausted={vi.fn()} onLogout={onLogout} /></I18nProvider>));

    await act(async () => button(container, "退出登录").click());
    expect(onLogout).not.toHaveBeenCalled();
    expect(container.querySelector(".logout-confirm")?.textContent).toContain("未同步数据将无法恢复");
    await act(async () => button(container, "登出").click());
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
