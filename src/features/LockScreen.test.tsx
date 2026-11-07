import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { User } from "../types";
import { LockScreen } from "./LockScreen";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];

const user: User = { id: "user-id", username: "user", displayName: "User", role: "user" };
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
  it.each([true, false])("keeps an incorrect PIN locked and permits retry (online: %s)", async (serverSessionVerified) => {
    localStorage.setItem("webmd-notes-language", "zh-CN");
    const onPin = vi.fn().mockResolvedValueOnce("invalid").mockResolvedValueOnce("ok");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<I18nProvider><LockScreen user={user} browserOnline={serverSessionVerified} onPin={onPin} onPasswordLogin={vi.fn()} onLogout={vi.fn()} /></I18nProvider>));

    const enterPin = async (value: string) => {
      const input = container.querySelector("input")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    };

    await enterPin("wrong");
    expect(onPin).toHaveBeenLastCalledWith("wrong");
    expect(container.querySelector(".error")?.textContent).toBe("PIN 不正确");
    expect(container.querySelector(".lock-status")?.textContent).toContain("笔记已锁定");
    expect(button(container, "使用 PIN 解锁").disabled).toBe(false);

    await enterPin("246810");
    expect(onPin).toHaveBeenLastCalledWith("246810");
    expect(container.querySelector(".error")).toBeNull();
  });

  it("submits the PIN with Enter and opens the password sign-in entry", async () => {
    const onPasswordLogin = vi.fn();
    localStorage.setItem("webmd-notes-language", "zh-CN");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<I18nProvider><LockScreen user={user} browserOnline onPin={vi.fn()} onPasswordLogin={onPasswordLogin} onLogout={vi.fn()} /></I18nProvider>));

    expect(container.querySelector(".lock-card h1")?.textContent).toBe(user.displayName);
    expect(container.querySelector(".lock-card h1")?.getAttribute("title")).toBe(user.displayName);
    expect(container.querySelector(".lock-status")?.textContent).toContain("笔记已锁定");
    expect(container.querySelector(".lock-status svg")).not.toBeNull();
    expect(container.textContent).not.toContain("保险箱已锁定");
    expect(container.textContent).not.toContain(`@${user.username}`);
    expect(container.querySelector(".lock-card img:not(.brand-mark)")).toBeNull();
    expect(container.querySelector(".auth-subtitle")).toBeNull();
    expect(container.textContent).not.toContain("当前设备仍保持登录");
    const pin = container.querySelector("input[type='password']") as HTMLInputElement;
    const pinSubmit = button(container, "使用 PIN 解锁");
    const pinRequestSubmit = vi.spyOn(pin.form!, "requestSubmit").mockImplementation(() => undefined);
    await act(async () => pin.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(pin.getAttribute("enterkeyhint")).toBe("done");
    expect(pinRequestSubmit).toHaveBeenCalledWith(pinSubmit);

    await act(async () => button(container, "改用主密码").click());
    expect(onPasswordLogin).toHaveBeenCalledOnce();
  });

  it("requires confirmation before deleting local data on logout", async () => {
    localStorage.setItem("webmd-notes-language", "zh-CN");
    const onLogout = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<I18nProvider><LockScreen user={user} browserOnline onPin={vi.fn()} onPasswordLogin={vi.fn()} onLogout={onLogout} /></I18nProvider>));

    await act(async () => button(container, "退出登录").click());
    expect(onLogout).not.toHaveBeenCalled();
    expect(document.querySelector(".logout-confirm")?.textContent).toContain("未同步数据将无法恢复");
    await act(async () => button(document.body, "登出").click());
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("requires the local PIN and hides master-password fallback in offline mode", async () => {
    localStorage.setItem("webmd-notes-language", "zh-CN");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<I18nProvider><LockScreen user={user} browserOnline={false} onPin={vi.fn()} onPasswordLogin={vi.fn()} onLogout={vi.fn()} /></I18nProvider>));

    expect(container.textContent).toContain("离线 · 暂无法使用主密码解锁");
    expect(button(container, "使用 PIN 解锁")).toBeTruthy();
    expect(container.textContent).not.toContain("改用主密码");
  });
});
