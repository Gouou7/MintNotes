import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { cryptoClient } from "../crypto/client";
import { getDeviceUnlock, removeDevicePin, setAutoLockMinutes, setDevicePin } from "../crypto/deviceUnlock";
import { I18nProvider } from "../i18n";
import type { HistorySettings, OpenDocument, UiPreferences, User } from "../types";
import { APP_VERSION } from "../version";
import { SettingsPanel } from "./SettingsPanel";

vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../crypto/client", () => ({
  createVaultEnvelopeBinding: vi.fn(() => ({ version: 2, context: "abcdefghijklmnopqrstuv" })),
  cryptoClient: { prepareLogin: vi.fn(), discardPendingLogin: vi.fn(), rotateRecoveryKey: vi.fn(), rewrapPasswordEnvelope: vi.fn(), rewrapVaultEnvelopes: vi.fn(), encryptProfileAvatar: vi.fn(), decryptProfileAvatar: vi.fn(), rewrapPassword: vi.fn() }
}));
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
const preferences: UiPreferences = {
  workspaceVersion: 1,
  activeNoteId: null,
  openNoteIds: [],
  editorMode: "live",
  editorReadOnly: false,
  theme: "system",
  fontSize: 14,
  wrapCodeBlocks: true,
  language: "zh-CN",
  sortMode: "alphabetical",
  treeCollapsed: false,
  outlineCollapsed: false,
  treeWidth: 272,
  outlineWidth: 236,
  rightPanelTab: "outline"
};
const storageStatus = { localReady: true, usage: null, local: { bytes: 0, objects: 2, attachments: 1, history: 3 }, lastSync: null, unsaved: 1,
 estimate: null, persistence: "unsupported" as const, failed: false, refreshing: false, stale: false, refresh: vi.fn(), requestPersistence: vi.fn() };
const historySettings: HistorySettings = { enabled: true, intervalMinutes: 10, retentionDays: 90, count: 3, usedBytes: 4096, quotaBytes: 256 * 1024 * 1024, clearedBefore: null };
const admin: User = { id: "admin-id", username: "admin", displayName: "Administrator", role: "admin" };
const deletedAt = "2026-07-20T12:00:00.000Z";
const trashItems: OpenDocument[] = [
  { objectId: "folder", kind: "folder", title: "Deleted folder", markdown: "", parentId: null, tags: [], favorite: false, locked: false, deleted: true, createdAt: deletedAt, updatedAt: deletedAt, manualOrder: 0, attachmentIds: [], schemaVersion: 2, serverRevision: 1, dirty: false },
  { objectId: "note", kind: "note", title: "Nested note", markdown: "", parentId: "folder", tags: [], favorite: false, locked: false, deleted: true, createdAt: deletedAt, updatedAt: deletedAt, manualOrder: 0, attachmentIds: [], schemaVersion: 2, serverRevision: 1, dirty: false }
];

function mockApi() {
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path === "/api/account/application-connections") return { connections: [] } as never;
    if (path === "/api/account/trash-retention" && !init?.method) return { days: 30 } as never;
    if (path === "/api/account/trash-retention") return { days: JSON.parse(String(init?.body)).days } as never;
    if (path === "/api/account/endpoints") return {
      canRevokeOthers: true,
      revokeEligibleAt: deletedAt,
      inactiveRetentionDays: 30,
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

async function renderSettings(user: User = admin, onNotify = vi.fn(), onPreferences = vi.fn(), onLogout = vi.fn(), onUsername = vi.fn(), credential: Parameters<typeof SettingsPanel>[0]["credential"] = null, onDisplayName = vi.fn(), avatarUrl: string | null = null, onClose = vi.fn()) {
  localStorage.setItem("webmd-notes-language", "zh-CN");
  mockApi();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<I18nProvider><SettingsPanel storageStatus={storageStatus} user={user} endpoint={{ id: "endpoint", remembered: false }} credential={credential} serverSessionVerified onCredentialChange={vi.fn()} preferences={preferences} onPreferences={onPreferences} onClose={onClose} onLogout={onLogout} onImport={vi.fn()} onExport={vi.fn()} onDisplayName={onDisplayName} onUsername={onUsername} avatarUrl={avatarUrl} onAvatarChange={vi.fn()} trashItems={trashItems} purging={false} onRestoreTrash={vi.fn()} onPurgeTrash={vi.fn()} onClearTrash={vi.fn()} historySettings={historySettings} onHistorySettings={vi.fn()} onRefreshHistorySettings={vi.fn().mockResolvedValue(historySettings)} onClearHistory={vi.fn()} onNotify={onNotify} /></I18nProvider>));
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
  it("keeps appearance controls separate from the account profile", async () => {
    const container = await renderSettings();
    expect(container.querySelector(".profile-summary")).toBeNull();
    expect(container.querySelector(".settings-section > h3")?.textContent).toBe("外观");
    expect(container.textContent).toContain("字体大小");
    expect(container.textContent).toContain("编辑器代码块自动换行");
    expect(container.textContent).toContain("语言");
    expect(container.textContent).not.toContain("文件排序");
    expect(container.textContent).not.toContain("恢复两侧栏");
    await act(async () => button(container, "用户和安全").click());
    expect(container.querySelector(".security-settings")?.firstElementChild?.classList.contains("profile-summary")).toBe(true);
    expect(container.querySelector(".profile-summary")?.textContent).toContain("Administrator@admin");
    expect(container.textContent).not.toContain("上传头像");
    await act(async () => button(container, "编辑资料").click());
    expect(container.querySelectorAll(".profile-edit-dialog form input")).toHaveLength(2);
    expect(container.querySelectorAll(".profile-edit-dialog > .compact-form")).toHaveLength(2);
    expect(container.querySelector(".profile-avatar-editor")?.textContent).toContain("头像上传头像");
    expect(container.querySelector(".profile-field-form label")?.textContent).toContain("名称");
    expect(button(container, "修改名称").classList).toContain("profile-action-button");
    expect((button(container, "修改名称") as HTMLButtonElement).disabled).toBe(true);
    expect(button(container, "修改用户名").classList).toContain("profile-action-button");
    expect((button(container, "修改用户名") as HTMLButtonElement).disabled).toBe(true);
    expect(button(container, "关闭").classList).toContain("profile-action-button");
  });

  it("enables code block wrapping by default and saves explicit changes", async () => {
    const onPreferences = vi.fn();
    const container = await renderSettings(admin, vi.fn(), onPreferences);
    const toggle = container.querySelector("[role='switch'][aria-label='代码块自动换行']") as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    await act(async () => toggle.click());

    expect(onPreferences).toHaveBeenCalledWith(expect.objectContaining({ wrapCodeBlocks: false }));
  });

  it("offers seven font sizes with localized small, default and large labels", async () => {
    const onPreferences = vi.fn();
    const container = await renderSettings(admin, vi.fn(), onPreferences);
    const select = container.querySelector(".font-size-setting select") as HTMLSelectElement;
    expect([...select.options].map(option => option.textContent)).toEqual(["11（小）", "12", "13", "14（默认）", "15", "16", "17（大）"]);
    expect(select.value).toBe("14");
    expect(container.querySelector(".font-size-reset")).toBeNull();
    for (const size of [11, 17, 14]) {
      await act(async () => { select.value = String(size); select.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(onPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: size }));
    }
  });

  it("keeps explicit avatar actions inside the profile editor", async () => {
    const container = await renderSettings(admin, vi.fn(), vi.fn(), vi.fn(), vi.fn(), null, vi.fn(), "blob:avatar");
    await act(async () => button(container, "用户和安全").click());
    expect(container.textContent).not.toContain("更换头像");
    expect(container.textContent).not.toContain("移除头像");
    await act(async () => button(container, "编辑资料").click());
    expect(button(container, "更换头像").classList).toContain("profile-action-button");
    expect(button(container, "移除头像").classList).toContain("profile-action-button");
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
    expect(container.textContent).toContain("使用者與安全");
    expect(localStorage.getItem("webmd-notes-language")).toBe("zh-TW");
  });

  it("edits the display name only after opening the profile dialog", async () => {
    const onDisplayName = vi.fn();
    const onNotify = vi.fn();
    const container = await renderSettings(admin, onNotify, vi.fn(), vi.fn(), vi.fn(), null, onDisplayName);
    await act(async () => button(container, "用户和安全").click());
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === "/api/account/profile") return { user: { ...admin, displayName: JSON.parse(String(init?.body)).displayName } } as never;
      return {} as never;
    });
    await act(async () => button(container, "编辑资料").click());
    const form = container.querySelector(".profile-edit-dialog form")!;
    const input = form.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "New name");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(api).toHaveBeenCalledWith("/api/account/profile", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ displayName: "New name" }) }));
    expect(onDisplayName).toHaveBeenCalledWith("New name");
    expect(onNotify).toHaveBeenCalledWith("名称已更新", "info");
  });

  it("changes the username only after rewrapping both vault envelopes", async () => {
    const onUsername = vi.fn();
    const onNotify = vi.fn();
    const container = await renderSettings(admin, onNotify, vi.fn(), vi.fn(), onUsername);
    await act(async () => button(container, "用户和安全").click());
    vi.mocked(api).mockImplementation(async (path) => {
      if (String(path).startsWith("/api/auth/parameters/")) return {
        kdfSalt: "salt",
        kdfParams: { algorithm: "argon2id", opsLimit: 3, memLimit: 64, version: 1 },
        recoveryWrappedVaultKey: "recovery",
        recoveryWrappedVaultNonce: "nonce",
        envelopeBinding: { version: 1, context: "admin" }
      } as never;
      if (path === "/api/account/username") return { user: { ...admin, username: "renamed-admin" } } as never;
      return {} as never;
    });
    vi.mocked(cryptoClient.prepareLogin).mockResolvedValue({ authSecret: "auth-secret" });
    vi.mocked(cryptoClient.discardPendingLogin).mockResolvedValue({ discarded: true });
    vi.mocked(cryptoClient.rewrapVaultEnvelopes).mockResolvedValue({
      wrappedVaultKey: "wrapped",
      wrappedVaultNonce: "wrapped-nonce",
      recoveryAuthSecret: "recovery-auth",
      recoveryWrappedVaultKey: "recovery-wrapped",
      recoveryWrappedVaultNonce: "recovery-nonce"
    });
    const setValue = (input: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    expect(container.querySelector(".username-change-dialog")).toBeNull();
    await act(async () => button(container, "编辑资料").click());
    const profileForm = container.querySelectorAll(".profile-edit-dialog form")[1]!;
    const profileInput = profileForm.querySelector("input")!;
    await act(async () => setValue(profileInput, "renamed-admin"));
    await act(async () => profileForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const dialog = container.querySelector(".username-change-dialog")!;
    const dialogInputs = [...dialog.querySelectorAll("input")] as HTMLInputElement[];
    expect(dialogInputs).toHaveLength(2);
    await act(async () => {
      setValue(dialogInputs[0]!, "current-password");
      setValue(dialogInputs[1]!, "current-recovery-key");
    });
    await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(cryptoClient.rewrapVaultEnvelopes).toHaveBeenCalledWith(
      { version: 2, context: "abcdefghijklmnopqrstuv" },
      "current-recovery-key"
    );
    expect(api).toHaveBeenCalledWith("/api/account/username", expect.objectContaining({ method: "PATCH" }));
    expect(onUsername).toHaveBeenCalledWith("renamed-admin");
    expect(onNotify).toHaveBeenCalledWith("用户名已更新。其他设备需重新登录。", "info");
  });

  it("resets a missing recovery key before committing the username change", async () => {
    const onUsername = vi.fn();
    const onNotify = vi.fn();
    const container = await renderSettings(admin, onNotify, vi.fn(), vi.fn(), onUsername);
    await act(async () => button(container, "用户和安全").click());
    vi.mocked(api).mockImplementation(async (path) => {
      if (String(path).startsWith("/api/auth/parameters/")) return {
        kdfSalt: "salt",
        kdfParams: { algorithm: "argon2id", opsLimit: 3, memLimit: 64, version: 1 },
        recoveryWrappedVaultKey: "recovery",
        recoveryWrappedVaultNonce: "nonce",
        envelopeBinding: { version: 1, context: "admin" }
      } as never;
      if (path === "/api/account/username") return { user: { ...admin, username: "renamed-admin" } } as never;
      return {} as never;
    });
    vi.mocked(cryptoClient.prepareLogin).mockResolvedValue({ authSecret: "auth-secret" });
    vi.mocked(cryptoClient.discardPendingLogin).mockResolvedValue({ discarded: true });
    vi.mocked(cryptoClient.rotateRecoveryKey).mockResolvedValue({
      recoveryAuthSecret: "replacement-recovery-auth",
      recoveryWrappedVaultKey: "replacement-recovery-wrapped",
      recoveryWrappedVaultNonce: "replacement-recovery-nonce",
      recoveryCode: "replacement-recovery-code"
    });
    vi.mocked(cryptoClient.rewrapPasswordEnvelope).mockResolvedValue({ wrappedVaultKey: "wrapped", wrappedVaultNonce: "wrapped-nonce" });
    const setValue = (input: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => button(container, "编辑资料").click());
    const profileForm = container.querySelectorAll(".profile-edit-dialog form")[1]!;
    const profileInput = profileForm.querySelector("input")!;
    await act(async () => setValue(profileInput, "renamed-admin"));
    await act(async () => profileForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const dialog = container.querySelector(".username-change-dialog")!;
    await act(async () => setValue(dialog.querySelector("input[type='password']")!, "current-password"));
    await act(async () => button(container, "重置恢复密钥并继续").click());
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector(".username-change-dialog textarea")?.textContent).toBe("replacement-recovery-code");
    const confirm = container.querySelector(".username-change-dialog input[type='checkbox']") as HTMLInputElement;
    await act(async () => confirm.click());
    await act(async () => button(container, "完成用户名修改").click());
    await act(async () => { await Promise.resolve(); });
    const usernameCall = vi.mocked(api).mock.calls.find(([path]) => path === "/api/account/username")!;
    expect(JSON.parse(String(usernameCall[1]?.body))).toMatchObject({
      username: "renamed-admin",
      replacementRecoveryAuthSecret: "replacement-recovery-auth"
    });
    expect(onUsername).toHaveBeenCalledWith("renamed-admin");
    expect(onNotify).toHaveBeenCalledWith("用户名和恢复密钥已更新。其他设备需重新登录。", "info");
  });

  it("keeps deleted folders collapsed, reveals matching paths, and auto-saves retention", async () => {
    const container = await renderSettings();
    await act(async () => button(container, "笔记和存储").click());
    expect(container.textContent).toContain("回收站内容将在保留期满后永久删除。");
    expect(container.textContent).toContain("1 个删除项目 · 共 2 项");
    expect(container.textContent).toContain("包含 1 项");
    expect(container.querySelector(".trash-children")).toBeNull();
    await act(async () => (container.querySelector("button[aria-label='展开 Deleted folder']") as HTMLButtonElement).click());
    expect(container.querySelector(".trash-children")?.textContent).toContain("Nested note");
    expect(button(container, "全部收起")).toBeTruthy();
    await act(async () => button(container, "全部收起").click());
    expect(container.querySelector(".trash-children")).toBeNull();

    const search = container.querySelector("input[aria-label='搜索回收站']") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "Nested");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector(".trash-children")?.textContent).toContain("Nested note");
    expect(container.textContent).toContain("1 个匹配项");
    expect((container.querySelector("select[aria-label='排序已删除项目']") as HTMLSelectElement).value).toBe("deleted-desc");
    expect(container.querySelectorAll("button[aria-label^='恢复']")).toHaveLength(1);
    expect(button(container, "永久删除")).toBeTruthy();
    const select = container.querySelector(".trash-settings .settings-control-row select") as HTMLSelectElement;
    await act(async () => { select.value = "90"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(vi.mocked(api)).toHaveBeenCalledWith("/api/account/trash-retention", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ days: 90 }) }));
  });

  it("keeps About last and hides administration for ordinary users", async () => {
    const container = await renderSettings({ ...admin, role: "user" });
    expect([...container.querySelectorAll(".settings-tabs button")].map(entry => entry.textContent?.trim()))
      .toEqual(["外观", "用户和安全", "笔记和存储", "关于"]);
    expect(container.querySelector(".admin-tab")).toBeNull();
  });

  it("orders icon tabs and exposes PIN setup independently from automatic locking", async () => {
    const onNotify = vi.fn();
    const container = await renderSettings(admin, onNotify);
    const tabs = [...container.querySelectorAll(".settings-tabs button")];
    expect(tabs.map((entry) => entry.textContent?.trim())).toEqual(["外观", "用户和安全", "笔记和存储", "管理员设置", "关于"]);
    expect(tabs.slice(0, 6).every((entry) => Boolean(entry.querySelector("svg")))).toBe(true);
    await act(async () => button(container, "用户和安全").click());
    expect(container.textContent).toContain("管理登录设备并移除失效记录。");
    expect(container.textContent).toContain("已登出和已过期的设备记录将在 30 天后自动移除");
    const headings = [...container.querySelectorAll(".settings-section h3")].map((entry) => entry.textContent?.trim());
    expect(headings.slice(0, 5)).toEqual(["本机 PIN", "自动锁定", "登录设备", "应用连接", "账户凭据"]);
    expect(button(container, "设置 PIN")).toBeTruthy();
    expect(container.querySelector("input[placeholder='至少 4 个字符']")).toBeNull();
    await act(async () => button(container, "设置 PIN").click());
    const dialog = container.querySelector(".pin-change-dialog")!;
    const pinInput = dialog.querySelector("input[placeholder='至少 4 个字符']") as HTMLInputElement;
    expect(pinInput.minLength).toBe(4);
    expect(pinInput.pattern).toBe("");
    expect(pinInput.inputMode).toBe("");
    expect(pinInput.getAttribute("enterkeyhint")).toBe("done");
    const pinSubmit = [...dialog.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === "设置 PIN")!;
    const requestSubmit = vi.spyOn(pinInput.form!, "requestSubmit").mockImplementation(() => undefined);
    await act(async () => pinInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(requestSubmit).toHaveBeenCalledWith(pinSubmit);
    await act(async () => (dialog.querySelector("button[aria-label='关闭']") as HTMLButtonElement).click());
    expect(container.querySelector(".pin-change-dialog")).toBeNull();
    const autoLockSelect = container.querySelector(".settings-section select") as HTMLSelectElement;
    await act(async () => { autoLockSelect.value = "5"; autoLockSelect.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(vi.mocked(setAutoLockMinutes)).not.toHaveBeenCalled();
    expect(onNotify).toHaveBeenCalledWith("开启自动锁定前请先设置本机 PIN", "warning");
    expect(container.querySelector(".notice")).toBeNull();
    expect(container.textContent).not.toContain("本机 PIN 与自动锁定");
    expect(container.textContent).not.toContain("保存自动锁定设置");
    expect(container.textContent).toContain("设置后每次启动应用均需输入 PIN。PIN 仅适用于当前设备。");
    expect(container.textContent).toContain("重置恢复密钥");
  });

  it("opens action-specific dialogs to set, change, and remove the device PIN", async () => {
    const setValue = (input: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    vi.mocked(api).mockImplementation(async (path) => {
      if (String(path).startsWith("/api/auth/parameters/")) return {
        kdfSalt: "salt",
        kdfParams: { algorithm: "argon2id", opsLimit: 3, memLimit: 64, version: 1 },
        recoveryWrappedVaultKey: "recovery",
        recoveryWrappedVaultNonce: "nonce",
        envelopeBinding: { version: 2, context: "abcdefghijklmnopqrstuv" }
      } as never;
      return {} as never;
    });
    vi.mocked(cryptoClient.prepareLogin).mockResolvedValue({ authSecret: "auth-secret" });
    vi.mocked(cryptoClient.discardPendingLogin).mockResolvedValue({ discarded: true });
    vi.mocked(getDeviceUnlock).mockResolvedValue(undefined);

    const unconfigured = await renderSettings();
    await act(async () => button(unconfigured, "用户和安全").click());
    await act(async () => button(unconfigured, "设置 PIN").click());
    let dialog = unconfigured.querySelector(".pin-change-dialog")!;
    let inputs = [...dialog.querySelectorAll("input")] as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    await act(async () => { setValue(inputs[0]!, "master-password"); setValue(inputs[1]!, "new-pin"); });
    await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(setDevicePin).toHaveBeenCalledWith("admin-id", "endpoint", "new-pin");
    expect(unconfigured.querySelector(".pin-change-dialog")).toBeNull();

    const configured = await renderSettings(admin, vi.fn(), vi.fn(), vi.fn(), vi.fn(), { version: 3, protection: "pin", autoLockMinutes: 5 } as never);
    await act(async () => button(configured, "用户和安全").click());
    expect(configured.querySelector("input[placeholder='至少 4 个字符']")).toBeNull();
    await act(async () => button(configured, "更改 PIN").click());
    dialog = configured.querySelector(".pin-change-dialog")!;
    expect(dialog.querySelectorAll("input")).toHaveLength(2);
    await act(async () => (dialog.querySelector("button[aria-label='关闭']") as HTMLButtonElement).click());
    await act(async () => button(configured, "移除 PIN").click());
    dialog = configured.querySelector(".pin-change-dialog")!;
    inputs = [...dialog.querySelectorAll("input")] as HTMLInputElement[];
    expect(inputs).toHaveLength(1);
    await act(async () => setValue(inputs[0]!, "master-password"));
    await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(setAutoLockMinutes).toHaveBeenCalledWith("admin-id", "endpoint", 0);
    expect(removeDevicePin).toHaveBeenCalledWith("admin-id", "endpoint");
  });

  it("opens separate dialogs for master-password changes and recovery-key resets", async () => {
    const setValue = (input: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const onClose = vi.fn();
    const container = await renderSettings(admin, vi.fn(), vi.fn(), vi.fn(), vi.fn(), null, vi.fn(), null, onClose);
    vi.mocked(api).mockImplementation(async (path) => {
      if (String(path).startsWith("/api/auth/parameters/")) return {
        kdfSalt: "salt",
        kdfParams: { algorithm: "argon2id", opsLimit: 3, memLimit: 64, version: 1 },
        recoveryWrappedVaultKey: "recovery",
        recoveryWrappedVaultNonce: "nonce",
        envelopeBinding: { version: 2, context: "abcdefghijklmnopqrstuv" }
      } as never;
      if (path === "/api/account/endpoints") return { canRevokeOthers: true, revokeEligibleAt: deletedAt, inactiveRetentionDays: 30, endpoints: [] } as never;
      return {} as never;
    });
    vi.mocked(cryptoClient.prepareLogin).mockResolvedValue({ authSecret: "current-auth" });
    vi.mocked(cryptoClient.discardPendingLogin).mockResolvedValue({ discarded: true });
    vi.mocked(cryptoClient.rewrapPassword).mockResolvedValue({
      authSecret: "new-auth",
      kdfSalt: "new-salt",
      kdfParams: { algorithm: "argon2id", opsLimit: 3, memLimit: 64, version: 1 },
      wrappedVaultKey: "new-wrapped",
      wrappedVaultNonce: "new-nonce"
    });
    vi.mocked(cryptoClient.rotateRecoveryKey).mockResolvedValue({
      recoveryAuthSecret: "new-recovery-auth",
      recoveryWrappedVaultKey: "new-recovery-wrapped",
      recoveryWrappedVaultNonce: "new-recovery-nonce",
      recoveryCode: "new-recovery-code"
    });

    await act(async () => button(container, "用户和安全").click());
    expect(container.querySelector(".account-credential-dialog")).toBeNull();
    expect(container.querySelector("input[type='password']")).toBeNull();

    await act(async () => button(container, "修改主密码").click());
    let dialog = container.querySelector(".account-credential-dialog")!;
    let inputs = [...dialog.querySelectorAll("input")] as HTMLInputElement[];
    expect(inputs).toHaveLength(3);
    await act(async () => {
      setValue(inputs[0]!, "current-password");
      setValue(inputs[1]!, "replacement-password");
      setValue(inputs[2]!, "replacement-password");
    });
    await act(async () => { dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    expect(api).toHaveBeenCalledWith("/api/auth/password", expect.objectContaining({ method: "POST" }));
    expect(container.querySelector(".account-credential-dialog")).toBeNull();

    await act(async () => button(container, "重置恢复密钥").click());
    dialog = container.querySelector(".account-credential-dialog")!;
    inputs = [...dialog.querySelectorAll("input")] as HTMLInputElement[];
    expect(inputs).toHaveLength(1);
    await act(async () => setValue(inputs[0]!, "current-password"));
    await act(async () => { dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    expect(api).toHaveBeenCalledWith("/api/account/recovery-key", expect.objectContaining({ method: "POST" }));
    expect(dialog.querySelector("textarea")?.textContent).toBe("new-recovery-code");
    expect(dialog.querySelector("button[aria-label='关闭']")).toBeNull();
    expect((button(container, "我已保存") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => (container.querySelector(".modal-backdrop") as HTMLDivElement).click());
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => (dialog.querySelector(".recovery-confirm input") as HTMLInputElement).click());
    await act(async () => button(container, "我已保存").click());
    expect(container.querySelector(".account-credential-dialog")).toBeNull();
  });

  it("uses an accessible sliding switch for automatic note history", async () => {
    const container = await renderSettings();
    await act(async () => button(container, "笔记和存储").click());
    const toggle = container.querySelector("[role='switch'][aria-label='自动保存历史']") as HTMLInputElement;
    expect(toggle).toBeTruthy();
    expect(toggle.checked).toBe(true);
    expect(toggle.nextElementSibling?.classList.contains("settings-switch-track")).toBe(true);
  });

  it("lets the user remove only the separate history budget", async () => {
    const container = await renderSettings();
    await act(async () => button(container, "笔记和存储").click());
    const mode = container.querySelector(".history-budget select") as HTMLSelectElement;
    await act(async () => { mode.value = "unlimited"; mode.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelector(".history-budget button")).toBeNull();
    expect(api).toHaveBeenCalledWith("/api/account/note-history-settings", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ quotaBytes: null }) }));
    expect(container.textContent).toContain("历史计入总配额");
  });

  it("separates administrator settings and removes the encrypted snapshot", async () => {
    const container = await renderSettings();
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === "/api/admin/users") return {
        users: [
          { id: "admin-id", username: "admin", displayName: "Administrator", role: "admin", disabled: false, objectCount: 58, encryptedBytes: 2.7 * 1024 * 1024 },
          { id: "user-id", username: "eros", displayName: "Eros", role: "user", disabled: false, objectCount: 79, encryptedBytes: 1.4 * 1024 * 1024 }
        ],
        setups: []
      } as never;
      return {} as never;
    });
    expect(container.querySelector(".admin-tab")?.textContent).toContain("管理员设置");
    await act(async () => button(container, "管理员设置").click());
    await act(async () => { await Promise.resolve(); });
    const management = container.querySelector(".admin-user-management");
    expect(management?.firstElementChild?.textContent).toBe("用户管理");
    expect([...management!.querySelectorAll(".admin-subsection h4")].map((heading) => heading.textContent)).toEqual(["新增用户", "现有用户"]);
    expect(container.textContent).not.toContain("创建待激活用户");
    expect(button(container, "禁用").querySelector(".lucide-user-round-x")).toBeTruthy();
    expect(button(container, "删除").querySelector(".lucide-trash-2")).toBeTruthy();
    await act(async () => button(container, "笔记和存储").click());
    expect(container.querySelector(".note-storage-settings > .storage-migration > h3")?.textContent).toBe("笔记迁移");
    expect([...container.querySelectorAll(".note-storage-settings h3")].map((node) => node.textContent).filter((text) => ["存储用量", "笔记历史", "回收站", "笔记迁移"].includes(text ?? ""))).toEqual(["存储用量", "笔记历史", "回收站", "笔记迁移"]);
    expect(container.textContent).not.toContain("可移植数据");
    expect(container.textContent).not.toContain("密文快照");
    const userContainer = await renderSettings({ ...admin, role: "user" });
    expect(userContainer.textContent).not.toContain("管理员设置");
  });

  it("shows project attribution and the build version in About", async () => {
    const container = await renderSettings();
    await act(async () => button(container, "关于").click());
    expect(container.querySelector(".about-product")?.textContent).toContain(`Mint Notes版本 ${APP_VERSION}`);
    expect(container.querySelector(".about-introduction")?.textContent).toBe("Mint Notes 是一款轻量的自托管 Markdown 笔记应用。支持多用户、PWA 离线编辑和跨设备同步。");
    expect(container.querySelector(".about-feedback")).toBeNull();
    expect(container.textContent).not.toContain("如果你发现 Bug 或者有功能建议");
    expect(container.textContent).toContain("致谢");
    expect([...container.querySelectorAll(".about-credits li")].map((item) => item.textContent)).toEqual([
      "typora-web编辑器核心的上游项目",
      "KaTeX用于渲染数学公式",
      "Mermaid用于渲染图表",
      "Lucide React用于界面图标"
    ]);
    expect(container.querySelector(".about-credits")?.textContent).not.toContain("许可证");
    expect(container.querySelector(".about-list")).toBeNull();
    expect(container.querySelector("a[href='https://github.com/Yuyz0112/typora-web']")).toBeTruthy();
    expect(container.querySelector("a[href='https://katex.org/']")).toBeTruthy();
    expect(container.querySelector("a[href='https://mermaid.js.org/']")).toBeTruthy();
    expect(container.querySelector("a[href='https://lucide.dev']")).toBeTruthy();
  });

  it("shows logout only at the bottom of Account and security and requires confirmation", async () => {
    const onLogout = vi.fn();
    const container = await renderSettings(admin, vi.fn(), vi.fn(), onLogout);
    expect(container.querySelector(".settings-logout-section")).toBeNull();
    await act(async () => button(container, "用户和安全").click());
    const logoutSection = container.querySelector(".settings-logout-section");
    expect(logoutSection).toBeTruthy();
    expect(logoutSection?.parentElement).toBe(container.querySelector(".settings-content"));
    await act(async () => button(container, "外观").click());
    expect(container.querySelector(".settings-logout-section")).toBeNull();
    await act(async () => button(container, "用户和安全").click());
    await act(async () => (container.querySelector(".settings-logout-section button") as HTMLButtonElement).click());
    expect(onLogout).not.toHaveBeenCalled();
    expect(container.querySelector(".logout-confirm")?.textContent).toContain("确认从当前设备登出？");
    expect(container.querySelector(".logout-confirm")?.textContent).toContain("未同步数据将无法恢复");
    expect([...container.querySelectorAll(".logout-confirm .storage-pending-item")].map((item) => item.textContent)).toEqual(["对象 2", "附件 1", "笔记历史 3"]);
    expect(container.querySelector(".logout-confirm")?.textContent).toContain("本地待保存1篇");
    expect(container.querySelector(".logout-confirm")?.textContent).toContain("已同步至服务器的数据不受影响");
    await act(async () => (container.querySelector(".logout-confirm .settings-action-button.danger") as HTMLButtonElement).click());
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("closes settings only when the backdrop itself is clicked", async () => {
    const onClose = vi.fn();
    const container = await renderSettings(admin, vi.fn(), vi.fn(), vi.fn(), vi.fn(), null, vi.fn(), null, onClose);
    const backdrop = container.querySelector(".modal-backdrop") as HTMLDivElement;
    const modal = container.querySelector(".settings-modal") as HTMLElement;
    await act(async () => modal.click());
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => backdrop.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("routes device sign-out feedback through the shared toast callback", async () => {
    const onNotify = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const container = await renderSettings(admin, onNotify);
    await act(async () => button(container, "用户和安全").click());
    await act(async () => { await Promise.resolve(); });
    const signOutButton = button(container, "登出");
    expect(signOutButton.classList).toContain("session-revoke");
    await act(async () => signOutButton.click());
    await act(async () => { await Promise.resolve(); });
    expect(onNotify).toHaveBeenCalledWith("Firefox · macOS 已登出", "info");
    expect(container.querySelector(".notice")).toBeNull();
    confirm.mockRestore();
  });

  it("offers immediate removal for signed-out and expired device records", async () => {
    const onNotify = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const container = await renderSettings(admin, onNotify);
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === "/api/account/endpoints") return {
        canRevokeOthers: false,
        revokeEligibleAt: "2026-08-10T12:00:00.000Z",
        inactiveRetentionDays: 30,
        endpoints: [{
          id: "inactive-endpoint",
          deviceName: "Firefox · Windows",
          ipAddress: "127.0.0.1",
          firstSeenAt: deletedAt,
          lastLoginAt: deletedAt,
          lastSeenAt: deletedAt,
          loginCount: 1,
          remembered: false,
          revokedAt: deletedAt,
          current: false,
          active: false
        }]
      } as never;
      return {} as never;
    });
    await act(async () => button(container, "用户和安全").click());
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).not.toContain("可在 2026");
    const removeButton = button(container, "移除");
    expect(removeButton.classList).toContain("session-remove");
    expect(removeButton.classList).not.toContain("session-revoke");
    await act(async () => removeButton.click());
    await act(async () => { await Promise.resolve(); });
    expect(api).toHaveBeenCalledWith("/api/account/endpoints/inactive-endpoint", { method: "DELETE" });
    expect(onNotify).toHaveBeenCalledWith("已移除 Firefox · Windows", "info");
    confirm.mockRestore();
  });
});
