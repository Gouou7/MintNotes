import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import packageMetadata from "../../package.json";
import { api } from "../api";
import { setAutoLockMinutes } from "../crypto/deviceUnlock";
import { I18nProvider } from "../i18n";
import type { HistorySettings, OpenDocument, UiPreferences, User } from "../types";
import { SettingsPanel } from "./SettingsPanel";

vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../crypto/client", () => ({ cryptoClient: { prepareLogin: vi.fn(), discardPendingLogin: vi.fn(), rotateRecoveryKey: vi.fn(), encryptProfileAvatar: vi.fn(), decryptProfileAvatar: vi.fn(), rewrapPassword: vi.fn() } }));
vi.mock("../crypto/deviceUnlock", () => ({
  getDeviceUnlock: vi.fn(),
  hasDevicePin: (credential: { version?: number; protection?: string; pinVerifier?: string } | null) => Boolean(
    credential && ((credential.version === 3 && credential.protection === "pin") || credential.pinVerifier)
  ),
  removeDevicePin: vi.fn(),
  setAutoLockMinutes: vi.fn(),
  setDevicePin: vi.fn()
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
const preferences: UiPreferences = { theme: "system", fontSize: "standard", language: "zh-CN", sortMode: "alphabetical", treeCollapsed: false, outlineCollapsed: false, treeWidth: 272, outlineWidth: 236, rightPanelTab: "outline" };
const historySettings: HistorySettings = { enabled: true, intervalMinutes: 10, retentionDays: 90, count: 3, usedBytes: 4096, quotaBytes: 256 * 1024 * 1024, clearedBefore: null };
const admin: User = { id: "admin-id", username: "admin", displayName: "Administrator", role: "admin" };
const deletedAt = "2026-07-20T12:00:00.000Z";
const trashItems: OpenDocument[] = [
  { objectId: "folder", kind: "folder", title: "Deleted folder", markdown: "", parentId: null, tags: [], favorite: false, deleted: true, createdAt: deletedAt, updatedAt: deletedAt, manualOrder: 0, attachmentIds: [], schemaVersion: 2, serverRevision: 1, dirty: false },
  { objectId: "note", kind: "note", title: "Nested note", markdown: "", parentId: "folder", tags: [], favorite: false, deleted: true, createdAt: deletedAt, updatedAt: deletedAt, manualOrder: 0, attachmentIds: [], schemaVersion: 2, serverRevision: 1, dirty: false }
];

function mockApi() {
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path === "/api/account/trash-retention" && !init?.method) return { days: 30 } as never;
    if (path === "/api/account/trash-retention") return { days: JSON.parse(String(init?.body)).days } as never;
    if (path === "/api/account/endpoints") return {
      canRevokeOthers: true,
      revokeEligibleAt: deletedAt,
      endpoints: [{
        id: "remote-endpoint",
        deviceName: "Firefox · macOS",
        ipAddress: "127.0.0.1",
        firstSeenAt: deletedAt,
        lastLoginAt: deletedAt,
        lastSeenAt: deletedAt,
        loginCount: 1,
        remembered: false,
        revokedAt: null,
        current: false,
        active: true
      }]
    } as never;
    if (path === "/api/admin/users") return { users: [], setups: [] } as never;
    return {} as never;
  });
}

async function renderSettings(user: User = admin, onNotify = vi.fn(), onPreferences = vi.fn(), onLogout = vi.fn()) {
  localStorage.setItem("webmd-notes-language", "zh-CN");
  mockApi();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<I18nProvider><SettingsPanel user={user} endpoint={{ id: "endpoint", remembered: false }} credential={null} onCredentialChange={vi.fn()} preferences={preferences} onPreferences={onPreferences} onClose={vi.fn()} onLogout={onLogout} onImport={vi.fn()} onExport={vi.fn()} onDisplayName={vi.fn()} avatarUrl={null} onAvatarChange={vi.fn()} trashItems={trashItems} purging={false} onRestoreTrash={vi.fn()} onPurgeTrash={vi.fn()} onClearTrash={vi.fn()} historySettings={historySettings} onHistorySettings={vi.fn()} onRefreshHistorySettings={vi.fn().mockResolvedValue(historySettings)} onClearHistory={vi.fn()} onNotify={onNotify} /></I18nProvider>));
  await act(async () => { await Promise.resolve(); });
  return container;
}

function button(container: HTMLElement, label: string) {
  const result = [...container.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button ${label}`);
  return result;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren(); vi.clearAllMocks();
  localStorage.clear();
});

describe("SettingsPanel", () => {
  it("uses compact profile controls and removes duplicate appearance settings", async () => {
    const container = await renderSettings();
    expect(container.querySelector(".settings-control-row input")?.closest("form")?.textContent).toContain("保存");
    expect(container.textContent).toContain("文字大小");
    expect(container.textContent).toContain("语言");
    expect(container.textContent).not.toContain("文件排序");
    expect(container.textContent).not.toContain("恢复两侧栏");
  });

  it("saves an explicit language and updates the interface immediately", async () => {
    const onPreferences = vi.fn();
    const container = await renderSettings(admin, vi.fn(), onPreferences);
    const language = container.querySelector("select[aria-label='界面语言']") as HTMLSelectElement;
    await act(async () => {
      language.value = "zh-TW";
      language.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onPreferences).toHaveBeenCalledWith(expect.objectContaining({ language: "zh-TW" }));
    expect(container.textContent).toContain("個人資料");
    expect(localStorage.getItem("webmd-notes-language")).toBe("zh-TW");
  });

  it("shows deleted content as a hierarchy and auto-saves retention", async () => {
    const container = await renderSettings();
    await act(async () => button(container, "回收站").click());
    expect(container.textContent).toContain("回收站的内容会在到达设置的自动删除时间后自动删除。");
    expect(container.querySelector(".trash-children")?.textContent).toContain("Nested note");
    expect(container.querySelectorAll("button[aria-label^='恢复']")).toHaveLength(1);
    const select = container.querySelector(".trash-settings select") as HTMLSelectElement;
    await act(async () => { select.value = "90"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(vi.mocked(api)).toHaveBeenCalledWith("/api/account/trash-retention", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ days: 90 }) }));
  });

  it("orders icon tabs and exposes PIN setup independently from automatic locking", async () => {
    const onNotify = vi.fn();
    const container = await renderSettings(admin, onNotify);
    const tabs = [...container.querySelectorAll(".settings-tabs button")];
    expect(tabs.slice(0, 6).map((entry) => entry.textContent?.trim())).toEqual(["常规", "安全", "笔记历史", "回收站", "数据迁移", "关于"]);
    expect(tabs.slice(0, 6).every((entry) => Boolean(entry.querySelector("svg")))).toBe(true);
    await act(async () => button(container, "安全").click());
    expect(container.textContent).toContain("查看已登录的设备，并可登出不再使用的设备。");
    const headings = [...container.querySelectorAll(".settings-section h3")].map((entry) => entry.textContent?.trim());
    expect(headings.slice(0, 4)).toEqual(["设置 PIN", "自动锁定", "登录设备", "修改主密码"]);
    expect(button(container, "设置 PIN")).toBeTruthy();
    const pinInput = container.querySelector("input[placeholder='至少 4 个字符']") as HTMLInputElement;
    expect(pinInput.minLength).toBe(4);
    expect(pinInput.pattern).toBe("");
    expect(pinInput.inputMode).toBe("");
    expect(pinInput.getAttribute("enterkeyhint")).toBe("done");
    const pinSubmit = button(container, "设置 PIN");
    const requestSubmit = vi.spyOn(pinInput.form!, "requestSubmit").mockImplementation(() => undefined);
    await act(async () => pinInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(requestSubmit).toHaveBeenCalledWith(pinSubmit);
    const autoLockSelect = container.querySelector(".settings-section select") as HTMLSelectElement;
    await act(async () => { autoLockSelect.value = "5"; autoLockSelect.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(vi.mocked(setAutoLockMinutes)).not.toHaveBeenCalled();
    expect(onNotify).toHaveBeenCalledWith("请先在上方设置本机 PIN，再开启自动锁定", "warning");
    expect(container.querySelector(".notice")).toBeNull();
    expect(container.textContent).not.toContain("本机 PIN 与自动锁定");
    expect(container.textContent).not.toContain("保存自动锁定设置");
    expect(container.textContent).toContain("重置恢复密钥");
  });

  it("uses an accessible sliding switch for automatic note history", async () => {
    const container = await renderSettings();
    await act(async () => button(container, "笔记历史").click());
    const toggle = container.querySelector("[role='switch'][aria-label='自动保存历史']") as HTMLInputElement;
    expect(toggle).toBeTruthy();
    expect(toggle.checked).toBe(true);
    expect(toggle.nextElementSibling?.classList.contains("settings-switch-track")).toBe(true);
  });

  it("separates administrator settings and removes the encrypted snapshot", async () => {
    const container = await renderSettings();
    expect(container.querySelector(".admin-tab")?.textContent).toContain("管理员设置");
    await act(async () => button(container, "数据迁移").click());
    expect(container.textContent).not.toContain("密文快照");
    const userContainer = await renderSettings({ ...admin, role: "user" });
    expect(userContainer.textContent).not.toContain("管理员设置");
  });

  it("shows project attribution and the package version in About", async () => {
    const container = await renderSettings();
    await act(async () => button(container, "关于").click());
    expect(container.querySelector(".about-product")?.textContent).toContain(`Mint Notes版本 ${packageMetadata.displayVersion}`);
    expect(container.querySelector(".about-introduction")?.textContent).toContain("Mint Notes 是一款使用 AI 开发的玩具级项目");
    expect(container.querySelector(".about-feedback")?.textContent).toBe("如果你发现 Bug 或者有功能建议，请不要向我提，向你的 AI 提！");
    expect(container.textContent).toContain("致谢");
    expect(container.querySelector(".about-credits")?.textContent).toContain("typora-webMarkdown 编辑器");
    expect(container.querySelector(".about-credits")?.textContent).toContain("Lucide React图标包");
    expect(container.querySelector(".about-list")).toBeNull();
    expect(container.querySelector("a[href='https://github.com/Yuyz0112/typora-web']")).toBeTruthy();
    expect(container.querySelector("a[href='https://lucide.dev']")).toBeTruthy();
  });

  it("places logout at the bottom of settings and requires confirmation", async () => {
    const onLogout = vi.fn();
    const container = await renderSettings(admin, vi.fn(), vi.fn(), onLogout);
    const logoutSection = container.querySelector(".settings-logout-section");
    expect(logoutSection).toBeTruthy();
    expect(logoutSection?.parentElement).toBe(container.querySelector(".settings-content"));
    await act(async () => (logoutSection?.querySelector("button") as HTMLButtonElement).click());
    expect(onLogout).not.toHaveBeenCalled();
    expect(container.querySelector(".logout-confirm")?.textContent).toContain("确认从当前设备登出？");
    expect(container.querySelector(".logout-confirm")?.textContent).toContain("未同步数据将无法恢复");
    expect(container.querySelector(".logout-confirm")?.textContent).toContain("已同步到服务器的数据不会被删除");
    await act(async () => (container.querySelector(".logout-confirm .danger-solid") as HTMLButtonElement).click());
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("routes device sign-out feedback through the shared toast callback", async () => {
    const onNotify = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const container = await renderSettings(admin, onNotify);
    await act(async () => button(container, "安全").click());
    await act(async () => { await Promise.resolve(); });
    await act(async () => button(container, "登出").click());
    await act(async () => { await Promise.resolve(); });
    expect(onNotify).toHaveBeenCalledWith("Firefox · macOS 已登出", "info");
    expect(container.querySelector(".notice")).toBeNull();
    confirm.mockRestore();
  });
});
