import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { I18nProvider } from "../i18n";
import { AuthScreen } from "./AuthScreen";

vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../crypto/client", () => ({
  cryptoClient: {
    lock: vi.fn(),
    prepareLogin: vi.fn(),
    unlockVault: vi.fn(),
    createRegistration: vi.fn(),
    unlockRecovery: vi.fn(),
    rewrapPassword: vi.fn()
  }
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

async function renderAuth(config: { allowRegistration: boolean; bootstrapAllowed: boolean } | Error) {
  localStorage.setItem("webmd-notes-language", "zh-CN");
  if (config instanceof Error) vi.mocked(api).mockRejectedValueOnce(config);
  else vi.mocked(api).mockResolvedValueOnce(config);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => { root.render(<I18nProvider><AuthScreen onUnlocked={vi.fn()} /></I18nProvider>); });
  await act(async () => { await Promise.resolve(); });
  return container;
}

function button(container: HTMLElement, label: string) {
  const match = [...container.querySelectorAll("button")].find((entry) => entry.textContent === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

async function click(target: HTMLButtonElement) {
  await act(async () => { target.click(); });
  await act(async () => { await Promise.resolve(); });
}

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("AuthScreen account entry points", () => {
  it("shows the simplified login page", async () => {
    const container = await renderAuth({ allowRegistration: true, bootstrapAllowed: false });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/icon.svg");
    expect(container.querySelector("h1")?.textContent).toBe("Mint Notes");
    expect(container.textContent).not.toContain("笔记在浏览器中解密");
    expect(button(container, "登录")).toBeTruthy();
    expect(button(container, "注册")).toBeTruthy();
    expect(button(container, "忘记密码")).toBeTruthy();
  });

  it("submits the login form when Enter is pressed in the password field", async () => {
    const container = await renderAuth({ allowRegistration: true, bootstrapAllowed: false });
    const password = container.querySelector("input[type='password']") as HTMLInputElement;
    const submit = button(container, "登录");
    const requestSubmit = vi.spyOn(password.form!, "requestSubmit").mockImplementation(() => undefined);

    await act(async () => password.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));

    expect(password.getAttribute("enterkeyhint")).toBe("done");
    expect(submit.type).toBe("submit");
    expect(requestSubmit).toHaveBeenCalledWith(submit);
  });

  it("switches the login interface language immediately", async () => {
    const container = await renderAuth({ allowRegistration: true, bootstrapAllowed: false });
    const language = container.querySelector("select[aria-label='界面语言']") as HTMLSelectElement;
    await act(async () => {
      language.value = "en";
      language.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(button(container, "Log in")).toBeTruthy();
    expect(button(container, "Forgot password")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("webmd-notes-language")).toBe("en");
  });

  it("offers activation-code registration from public registration", async () => {
    const container = await renderAuth({ allowRegistration: true, bootstrapAllowed: false });
    await click(button(container, "注册"));
    expect(container.querySelector("h1")?.textContent).toBe("创建加密账户");
    expect(container.textContent).toContain("显示名称");
    await click(button(container, "使用激活码注册"));
    expect(container.querySelector("h1")?.textContent).toBe("使用激活码注册");
    expect(container.textContent).toContain("激活码");
    expect(button(container, "普通注册")).toBeTruthy();
  });

  it("routes closed public registration directly to activation", async () => {
    const container = await renderAuth({ allowRegistration: false, bootstrapAllowed: false });
    await click(button(container, "注册"));
    expect(container.querySelector("h1")?.textContent).toBe("使用激活码注册");
    expect(container.textContent).toContain("已关闭公开注册，请向管理员申请注册激活码。");
    expect(container.textContent).not.toContain("显示名称");
  });

  it("preserves first-account administrator registration", async () => {
    const container = await renderAuth({ allowRegistration: false, bootstrapAllowed: true });
    await click(button(container, "注册"));
    expect(container.querySelector("h1")?.textContent).toBe("创建加密账户");
    expect(container.textContent).toContain("这是服务器上的首个账户，创建后将成为管理员。");
    expect(container.textContent).not.toContain("使用激活码注册");
  });

  it("explains recovery-key password reset", async () => {
    const container = await renderAuth({ allowRegistration: true, bootstrapAllowed: false });
    await click(button(container, "忘记密码"));
    expect(container.querySelector("h1")?.textContent).toBe("找回密码");
    expect(container.textContent).toContain("可使用恢复密钥重置主密码，如果恢复密钥也丢失，则数据无法再找回。");
    expect(container.textContent).toContain("恢复密钥");
  });

  it("stays on login and retries a failed registration config request", async () => {
    const container = await renderAuth(new Error("offline"));
    expect(container.querySelector("h1")?.textContent).toBe("Mint Notes");
    expect(container.textContent).toContain("无法获取注册配置，点击“注册”重试。");
    vi.mocked(api).mockResolvedValueOnce({ allowRegistration: true, bootstrapAllowed: false });
    await click(button(container, "注册"));
    expect(container.querySelector("h1")?.textContent).toBe("创建加密账户");
  });
});
