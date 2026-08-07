import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { LanguagePreference } from "../types";

export const SUPPORTED_LOCALES = ["en", "zh-CN", "zh-TW"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type { LanguagePreference } from "../types";
export type TranslationValues = Record<string, string | number>;

const LANGUAGE_STORAGE_KEY = "webmd-notes-language";

const messages = {
  "common.close": { en: "Close", "zh-CN": "关闭", "zh-TW": "關閉" },
  "common.cancel": { en: "Cancel", "zh-CN": "取消", "zh-TW": "取消" },
  "common.copy": { en: "Copy", "zh-CN": "复制", "zh-TW": "複製" },
  "editor.copyCode": { en: "Copy code", "zh-CN": "复制代码", "zh-TW": "複製程式碼" },
  "editor.codeCopied": { en: "Code copied", "zh-CN": "代码已复制", "zh-TW": "程式碼已複製" },
  "editor.codeCopyFailed": { en: "Could not copy code", "zh-CN": "无法复制代码", "zh-TW": "無法複製程式碼" },
  "common.download": { en: "Download", "zh-CN": "下载", "zh-TW": "下載" },
  "common.upload": { en: "Upload", "zh-CN": "上传", "zh-TW": "上傳" },
  "common.replace": { en: "Replace", "zh-CN": "更换", "zh-TW": "更換" },
  "common.remove": { en: "Remove", "zh-CN": "移除", "zh-TW": "移除" },
  "common.save": { en: "Save", "zh-CN": "保存", "zh-TW": "儲存" },
  "common.unknown": { en: "Unknown", "zh-CN": "未知", "zh-TW": "未知" },
  "common.default": { en: "default", "zh-CN": "默认", "zh-TW": "預設" },
  "language.label": { en: "Language", "zh-CN": "语言", "zh-TW": "語言" },
  "language.selector": { en: "Interface language", "zh-CN": "界面语言", "zh-TW": "介面語言" },
  "language.system": { en: "Follow browser", "zh-CN": "跟随浏览器", "zh-TW": "跟隨瀏覽器" },
  "pwa.update.confirm": {
    en: "A new version is available. Confirm that your notes are saved locally, then update.",
    "zh-CN": "应用有新版本。请确认笔记已保存到本地，然后更新。",
    "zh-TW": "應用程式有新版本。請確認筆記已儲存在本機，然後更新。"
  },

  "auth.recovery.title": { en: "Save your recovery key", "zh-CN": "保存恢复密钥", "zh-TW": "儲存復原金鑰" },
  "auth.recovery.description": {
    en: "The server cannot recover your notes for you. Store this recovery key in a password manager or another secure offline location.",
    "zh-CN": "服务器无法替你恢复笔记。请把下面的恢复密钥保存在密码管理器或离线安全位置。",
    "zh-TW": "伺服器無法替你復原筆記。請將下方的復原金鑰儲存在密碼管理器或離線安全位置。"
  },
  "auth.recovery.copy": { en: "Copy recovery key", "zh-CN": "复制恢复密钥", "zh-TW": "複製復原金鑰" },
  "auth.recovery.copied": { en: "Recovery key copied", "zh-CN": "恢复密钥已复制", "zh-TW": "復原金鑰已複製" },
  "auth.recovery.copyFailed": {
    en: "The recovery key could not be copied. Select it above and copy it manually.",
    "zh-CN": "无法复制恢复密钥。请选中上方密钥并手动复制。",
    "zh-TW": "無法複製復原金鑰。請選取上方金鑰並手動複製。"
  },
  "auth.recovery.download": { en: "Download recovery key", "zh-CN": "下载恢复密钥", "zh-TW": "下載復原金鑰" },
  "auth.recovery.confirm": {
    en: "I confirm that I stored the recovery key in a secure location.",
    "zh-CN": "我确认已将恢复密钥保存在安全位置。",
    "zh-TW": "我確認已將復原金鑰儲存在安全位置。"
  },
  "auth.recovery.saved": { en: "I have stored it safely", "zh-CN": "我已经安全保存", "zh-TW": "我已安全儲存" },
  "auth.register.title": { en: "Create encrypted account", "zh-CN": "创建加密账户", "zh-TW": "建立加密帳戶" },
  "auth.activate.title": { en: "Register with activation code", "zh-CN": "使用激活码注册", "zh-TW": "使用啟用碼註冊" },
  "auth.recover.title": { en: "Recover account", "zh-CN": "找回密码", "zh-TW": "找回密碼" },
  "auth.bootstrap.guidance": {
    en: "This is the first account on the server. It will become the administrator.",
    "zh-CN": "这是服务器上的首个账户，创建后将成为管理员。",
    "zh-TW": "這是伺服器上的第一個帳戶，建立後將成為管理員。"
  },
  "auth.registration.closed": {
    en: "Public registration is closed. Ask an administrator for an activation code.",
    "zh-CN": "已关闭公开注册，请向管理员申请注册激活码。",
    "zh-TW": "公開註冊已關閉，請向管理員申請註冊啟用碼。"
  },
  "auth.recover.guidance": {
    en: "Use your recovery key to reset the master password. If the recovery key is also lost, the data cannot be recovered.",
    "zh-CN": "可使用恢复密钥重置主密码，如果恢复密钥也丢失，则数据无法再找回。",
    "zh-TW": "可使用復原金鑰重設主密碼；若復原金鑰也遺失，資料將無法復原。"
  },
  "auth.username": { en: "Username", "zh-CN": "用户名", "zh-TW": "使用者名稱" },
  "auth.displayName": { en: "Display name", "zh-CN": "显示名称", "zh-TW": "顯示名稱" },
  "auth.activationCode": { en: "Activation code", "zh-CN": "激活码", "zh-TW": "啟用碼" },
  "auth.recoveryKey": { en: "Recovery key", "zh-CN": "恢复密钥", "zh-TW": "復原金鑰" },
  "auth.masterPassword": { en: "Master password", "zh-CN": "主密码", "zh-TW": "主密碼" },
  "auth.newMasterPassword": { en: "New master password", "zh-CN": "新主密码", "zh-TW": "新主密碼" },
  "auth.confirmPassword": { en: "Confirm password", "zh-CN": "确认密码", "zh-TW": "確認密碼" },
  "auth.confirmNewPassword": { en: "Confirm new master password", "zh-CN": "确认新主密码", "zh-TW": "確認新主密碼" },
  "auth.currentPassword": { en: "Current master password", "zh-CN": "当前主密码", "zh-TW": "目前主密碼" },
  "auth.rememberDevice": { en: "Remember this device", "zh-CN": "记住本设备", "zh-TW": "記住此裝置" },
  "auth.processingKeys": { en: "Processing security keys…", "zh-CN": "正在处理安全密钥…", "zh-TW": "正在處理安全金鑰…" },
  "auth.login": { en: "Log in", "zh-CN": "登录", "zh-TW": "登入" },
  "auth.register": { en: "Register", "zh-CN": "注册", "zh-TW": "註冊" },
  "auth.createAccount": { en: "Create account", "zh-CN": "创建账户", "zh-TW": "建立帳戶" },
  "auth.activateCreate": { en: "Activate and create keys", "zh-CN": "激活并创建密钥", "zh-TW": "啟用並建立金鑰" },
  "auth.resetPassword": { en: "Reset password", "zh-CN": "重设密码", "zh-TW": "重設密碼" },
  "auth.backToLogin": { en: "Back to login", "zh-CN": "返回登录", "zh-TW": "返回登入" },
  "auth.forgotPassword": { en: "Forgot password", "zh-CN": "忘记密码", "zh-TW": "忘記密碼" },
  "auth.normalRegistration": { en: "Standard registration", "zh-CN": "普通注册", "zh-TW": "一般註冊" },
  "auth.configError": {
    en: "Registration settings could not be loaded. Select “Register” to retry.",
    "zh-CN": "无法获取注册配置，点击“注册”重试。",
    "zh-TW": "無法取得註冊設定，點選「註冊」重試。"
  },
  "auth.offlineUnavailable": {
    en: "Offline access is available only on a remembered device that has completed one online verification with this version.",
    "zh-CN": "离线访问仅适用于已记住、且已使用当前版本完成过一次在线验证的设备。",
    "zh-TW": "離線存取僅適用於已記住、且已使用目前版本完成過一次線上驗證的裝置。"
  },
  "auth.passwordMin": {
    en: "The master password must contain at least 10 characters",
    "zh-CN": "主密码至少需要 10 个字符",
    "zh-TW": "主密碼至少需要 10 個字元"
  },
  "auth.newPasswordMin": {
    en: "The new master password must contain at least 10 characters",
    "zh-CN": "新主密码至少需要 10 个字符",
    "zh-TW": "新主密碼至少需要 10 個字元"
  },
  "auth.passwordMismatch": { en: "The passwords do not match", "zh-CN": "两次输入的密码不一致", "zh-TW": "兩次輸入的密碼不一致" },
  "auth.newPasswordMismatch": {
    en: "The new passwords do not match",
    "zh-CN": "两次输入的新密码不一致",
    "zh-TW": "兩次輸入的新密碼不一致"
  },
  "auth.passwordReset": { en: "Password reset. Log in again.", "zh-CN": "密码已重设，请重新登录", "zh-TW": "密碼已重設，請重新登入" },
  "auth.operationFailed": { en: "The operation failed", "zh-CN": "操作失败", "zh-TW": "操作失敗" },

  "lock.restoring": {
    en: "Restoring this device's encrypted vault…",
    "zh-CN": "正在恢复本设备的加密保险箱…",
    "zh-TW": "正在復原此裝置的加密保險箱…"
  },
  "lock.title": { en: "Notes locked", "zh-CN": "笔记已锁定", "zh-TW": "筆記已鎖定" },
  "lock.offline": {
    en: "Offline mode · enter the local PIN to open cached notes. Master-password unlock requires the server.",
    "zh-CN": "离线模式 · 输入本机 PIN 可打开缓存笔记；主密码解锁需要连接服务器。",
    "zh-TW": "離線模式 · 輸入本機 PIN 可開啟快取筆記；主密碼解鎖需要連線伺服器。"
  },
  "lock.devicePin": { en: "Device PIN", "zh-CN": "本机 PIN", "zh-TW": "本機 PIN" },
  "lock.unlocking": { en: "Unlocking…", "zh-CN": "正在解锁…", "zh-TW": "正在解鎖…" },
  "lock.unlockWithPin": { en: "Unlock with PIN", "zh-CN": "使用 PIN 解锁", "zh-TW": "使用 PIN 解鎖" },
  "lock.usePassword": { en: "Use master password", "zh-CN": "改用主密码", "zh-TW": "改用主密碼" },
  "lock.verifying": { en: "Verifying…", "zh-CN": "正在验证…", "zh-TW": "正在驗證…" },
  "lock.unlockWithPassword": { en: "Unlock with master password", "zh-CN": "使用主密码解锁", "zh-TW": "使用主密碼解鎖" },
  "lock.backToPin": { en: "Back to PIN unlock", "zh-CN": "返回 PIN 解锁", "zh-TW": "返回 PIN 解鎖" },
  "lock.logout": { en: "Log out", "zh-CN": "退出登录", "zh-TW": "登出" },
  "lock.invalidPin": { en: "Incorrect PIN", "zh-CN": "PIN 不正确", "zh-TW": "PIN 不正確" },
  "lock.cannotUnlock": { en: "Unable to unlock", "zh-CN": "无法解锁", "zh-TW": "無法解鎖" },
  "lock.invalidPassword": { en: "Incorrect master password", "zh-CN": "主密码不正确", "zh-TW": "主密碼不正確" },

  "settings.title": { en: "Settings", "zh-CN": "设置", "zh-TW": "設定" },
  "settings.localOnly": {
    en: "Local-only mode · server account and synchronization controls will be available after the session is verified.",
    "zh-CN": "仅本地模式 · 会话重新验证后，服务器账户和同步控制才会恢复。",
    "zh-TW": "僅本機模式 · 工作階段重新驗證後，伺服器帳戶與同步控制才會恢復。"
  },
  "settings.close": { en: "Close settings", "zh-CN": "关闭设置", "zh-TW": "關閉設定" },
  "settings.general": { en: "General", "zh-CN": "常规", "zh-TW": "一般" },
  "settings.security": { en: "Security", "zh-CN": "安全", "zh-TW": "安全性" },
  "settings.trash": { en: "Trash", "zh-CN": "回收站", "zh-TW": "垃圾桶" },
  "settings.data": { en: "Data migration", "zh-CN": "数据迁移", "zh-TW": "資料移轉" },
  "settings.about": { en: "About", "zh-CN": "关于", "zh-TW": "關於" },
  "settings.admin": { en: "Administrator settings", "zh-CN": "管理员设置", "zh-TW": "管理員設定" },
  "settings.logoutTitle": { en: "Log out of this device?", "zh-CN": "确认从当前设备登出？", "zh-TW": "確認從目前裝置登出？" },
  "settings.logoutWarning": {
    en: "Logging out deletes all local data for this account from this browser, including unsynchronized notes, attachments, and changes. Unsynchronized data cannot be recovered. Data already synchronized to the server is not deleted.",
    "zh-CN": "登出会删除此浏览器中当前账户的全部本地数据，包括尚未同步的笔记、附件和更改；未同步数据将无法恢复。已同步到服务器的数据不会被删除。",
    "zh-TW": "登出會刪除此瀏覽器中目前帳戶的全部本機資料，包括尚未同步的筆記、附件和變更；未同步資料將無法復原。已同步到伺服器的資料不會被刪除。"
  },
  "settings.profile": { en: "Profile", "zh-CN": "个人资料", "zh-TW": "個人資料" },
  "settings.changeUsername": { en: "Change username", "zh-CN": "修改用户名", "zh-TW": "變更使用者名稱" },
  "settings.newUsername": { en: "New username", "zh-CN": "新用户名", "zh-TW": "新使用者名稱" },
  "settings.changeUsernameHelp": {
    en: "Change the login name for this account. Other devices will need to log in again with the new username.",
    "zh-CN": "修改此账户的登录名称。修改后，其他设备需要使用新用户名重新登录。",
    "zh-TW": "變更此帳戶的登入名稱。變更後，其他裝置需要使用新使用者名稱重新登入。"
  },
  "settings.verifyUsernameChange": { en: "Verify username change", "zh-CN": "验证用户名修改", "zh-TW": "驗證使用者名稱變更" },
  "settings.usernameVerificationHelp": {
    en: "Enter your master password and existing recovery key. If the recovery key is unavailable, reset it and continue.",
    "zh-CN": "请输入当前主密码和现有恢复密钥。如果找不到恢复密钥，可以重置后继续。",
    "zh-TW": "請輸入目前主密碼和現有復原金鑰。如果找不到復原金鑰，可以重設後繼續。"
  },
  "settings.resetRecoveryAndContinue": { en: "Reset recovery key and continue", "zh-CN": "重置恢复密钥并继续", "zh-TW": "重設復原金鑰並繼續" },
  "settings.confirmUsernameChange": { en: "Confirm change", "zh-CN": "确认修改", "zh-TW": "確認變更" },
  "settings.saveReplacementRecovery": { en: "Save the new recovery key", "zh-CN": "保存新的恢复密钥", "zh-TW": "儲存新的復原金鑰" },
  "settings.replacementRecoveryHelp": {
    en: "Save this replacement key before finishing. The old recovery key becomes invalid only after the username change succeeds.",
    "zh-CN": "完成修改前请先保存这个新密钥。只有用户名修改成功后，旧恢复密钥才会失效。",
    "zh-TW": "完成變更前請先儲存這個新金鑰。只有使用者名稱變更成功後，舊復原金鑰才會失效。"
  },
  "settings.finishUsernameChange": { en: "Finish username change", "zh-CN": "完成用户名修改", "zh-TW": "完成使用者名稱變更" },
  "settings.avatar": { en: "Avatar", "zh-CN": "头像", "zh-TW": "頭像" },
  "settings.currentAvatar": { en: "Current avatar", "zh-CN": "当前头像", "zh-TW": "目前頭像" },
  "settings.appearance": { en: "Appearance", "zh-CN": "外观", "zh-TW": "外觀" },
  "settings.theme": { en: "Theme", "zh-CN": "主题", "zh-TW": "主題" },
  "settings.themeSystem": { en: "Follow system", "zh-CN": "跟随系统", "zh-TW": "跟隨系統" },
  "settings.themeLight": { en: "Light", "zh-CN": "浅色", "zh-TW": "淺色" },
  "settings.themeDark": { en: "Dark", "zh-CN": "深色", "zh-TW": "深色" },
  "settings.fontSize": { en: "Text size", "zh-CN": "文字大小", "zh-TW": "文字大小" },
  "settings.fontSmall": { en: "Small", "zh-CN": "小", "zh-TW": "小" },
  "settings.fontStandard": { en: "Standard", "zh-CN": "标准", "zh-TW": "標準" },
  "settings.fontLarge": { en: "Large", "zh-CN": "大", "zh-TW": "大" },
  "settings.trashHelp": {
    en: "Items in trash are automatically deleted after the selected retention period.",
    "zh-CN": "回收站的内容会在到达设置的自动删除时间后自动删除。",
    "zh-TW": "垃圾桶中的內容會在到達設定的自動刪除時間後自動刪除。"
  },
  "settings.autoDelete": { en: "Automatically delete after", "zh-CN": "自动删除时间", "zh-TW": "自動刪除時間" },
  "settings.days": { en: "{count} days", "zh-CN": "{count} 天", "zh-TW": "{count} 天" },
  "settings.daysDefault": { en: "{count} days (default)", "zh-CN": "{count} 天（默认）", "zh-TW": "{count} 天（預設）" },
  "settings.keepForever": { en: "Keep forever", "zh-CN": "永久保存", "zh-TW": "永久保留" },
  "settings.deletedItems": { en: "Deleted items", "zh-CN": "已删除项目", "zh-TW": "已刪除項目" },
  "settings.clearingTrash": { en: "Clearing…", "zh-CN": "正在清空…", "zh-TW": "正在清空…" },
  "settings.clearTrash": { en: "Clear trash", "zh-CN": "清空回收站", "zh-TW": "清空垃圾桶" },
  "settings.trashEmpty": { en: "Trash is empty", "zh-CN": "回收站为空", "zh-TW": "垃圾桶是空的" },
  "settings.untitled": { en: "Untitled note", "zh-CN": "无标题笔记", "zh-TW": "無標題筆記" },
  "settings.folder": { en: "Folder", "zh-CN": "文件夹", "zh-TW": "資料夾" },
  "settings.note": { en: "Note", "zh-CN": "笔记", "zh-TW": "筆記" },
  "settings.deletedAt": { en: "deleted {date}", "zh-CN": "删除于 {date}", "zh-TW": "刪除於 {date}" },
  "settings.restore": { en: "Restore", "zh-CN": "恢复", "zh-TW": "復原" },
  "settings.restoreItem": { en: "Restore {title}", "zh-CN": "恢复 {title}", "zh-TW": "復原 {title}" },
  "settings.permanentDelete": { en: "Permanently delete", "zh-CN": "永久删除", "zh-TW": "永久刪除" },
  "settings.permanentDeleteItem": { en: "Permanently delete {title}", "zh-CN": "永久删除 {title}", "zh-TW": "永久刪除 {title}" },
  "settings.devicePin": { en: "Device PIN", "zh-CN": "本机 PIN", "zh-TW": "本機 PIN" },
  "settings.setPin": { en: "Set PIN", "zh-CN": "设置 PIN", "zh-TW": "設定 PIN" },
  "settings.pinHelp": {
    en: "After you set a PIN, it will be required each time the app starts. The PIN applies only to this device.",
    "zh-CN": "设置 PIN 之后，每次启动将要求输入 PIN；PIN 只应用于当前设备。",
    "zh-TW": "設定 PIN 之後，每次啟動將要求輸入 PIN；PIN 只套用於目前裝置。"
  },
  "settings.pinConfiguredHelp": {
    en: "A PIN is configured for this device. Change or remove it only when needed.",
    "zh-CN": "当前设备已设置 PIN；需要时可更改或移除。",
    "zh-TW": "目前裝置已設定 PIN；需要時可變更或移除。"
  },
  "settings.pinVerificationHelp": {
    en: "Enter the current master password and the new PIN to continue.",
    "zh-CN": "请输入当前主密码和新 PIN 后继续。",
    "zh-TW": "請輸入目前主密碼和新 PIN 後繼續。"
  },
  "settings.removePinHelp": {
    en: "Enter the current master password to remove this device's PIN. Automatic locking will also be disabled.",
    "zh-CN": "请输入当前主密码以移除本机 PIN；自动锁定也会同时关闭。",
    "zh-TW": "請輸入目前主密碼以移除本機 PIN；自動鎖定也會同時關閉。"
  },
  "settings.newPin": { en: "New PIN", "zh-CN": "新 PIN", "zh-TW": "新 PIN" },
  "settings.pinMin": { en: "At least 4 characters", "zh-CN": "至少 4 个字符", "zh-TW": "至少 4 個字元" },
  "settings.changePin": { en: "Change PIN", "zh-CN": "更改 PIN", "zh-TW": "變更 PIN" },
  "settings.removePin": { en: "Remove PIN", "zh-CN": "移除 PIN", "zh-TW": "移除 PIN" },
  "settings.autoLock": { en: "Automatic locking", "zh-CN": "自动锁定", "zh-TW": "自動鎖定" },
  "settings.autoLockHelp": {
    en: "When enabled, the app locks after a period of inactivity. Unlock it with this device's PIN or the master password.",
    "zh-CN": "开启后，长时间未操作时会自动锁定应用。可使用当前设备的 PIN 快速解锁，也可以使用主密码。",
    "zh-TW": "開啟後，長時間未操作時會自動鎖定應用程式。可使用目前裝置的 PIN 快速解鎖，或使用主密碼。"
  },
  "settings.autoLockAfter": { en: "Lock after inactivity", "zh-CN": "无操作后自动锁定", "zh-TW": "閒置後自動鎖定" },
  "settings.offDefault": { en: "Off (default)", "zh-CN": "关闭（默认）", "zh-TW": "關閉（預設）" },
  "settings.minutes": { en: "{count} minutes", "zh-CN": "{count} 分钟", "zh-TW": "{count} 分鐘" },
  "settings.minute": { en: "1 minute", "zh-CN": "1 分钟", "zh-TW": "1 分鐘" },
  "settings.loginDevices": { en: "Login devices", "zh-CN": "登录设备", "zh-TW": "登入裝置" },
  "settings.loginDevicesHelp": {
    en: "Review signed-in devices and sign out devices you no longer use. A new device must be signed in for 24 hours before it can sign out other devices.",
    "zh-CN": "查看已登录的设备，并可登出不再使用的设备。为保护账户安全，新设备登录 24 小时后才能登出其他设备。",
    "zh-TW": "查看已登入的裝置，並可登出不再使用的裝置。為保護帳戶安全，新裝置登入 24 小時後才能登出其他裝置。"
  },
  "settings.loadingDevices": { en: "Loading login devices…", "zh-CN": "正在加载登录设备…", "zh-TW": "正在載入登入裝置…" },
  "settings.revokeAfter": { en: "Other devices can be signed out after {date}.", "zh-CN": "可在 {date} 后登出其他设备。", "zh-TW": "可在 {date} 後登出其他裝置。" },
  "settings.currentDevice": { en: "Current device", "zh-CN": "当前设备", "zh-TW": "目前裝置" },
  "settings.remembered": { en: "Remembered", "zh-CN": "已记住", "zh-TW": "已記住" },
  "settings.lastOnline": { en: "Last online: {date}", "zh-CN": "上次上线：{date}", "zh-TW": "上次上線：{date}" },
  "settings.deviceDetails": {
    en: "First login: {first} · Recent login: {last} · {count} logins · IP {ip} · {status}",
    "zh-CN": "首次登录：{first} · 最近登录：{last} · 共 {count} 次 · IP {ip} · {status}",
    "zh-TW": "首次登入：{first} · 最近登入：{last} · 共 {count} 次 · IP {ip} · {status}"
  },
  "settings.deviceActive": { en: "Active", "zh-CN": "有效", "zh-TW": "有效" },
  "settings.deviceSignedOut": { en: "Signed out", "zh-CN": "已登出", "zh-TW": "已登出" },
  "settings.deviceExpired": { en: "Expired", "zh-CN": "已过期", "zh-TW": "已過期" },
  "settings.signOut": { en: "Sign out", "zh-CN": "登出", "zh-TW": "登出" },
  "settings.accountCredentials": { en: "Account credentials", "zh-CN": "账户凭据", "zh-TW": "帳戶憑證" },
  "settings.accountCredentialsHelp": {
    en: "Change the master password or replace the recovery key only when needed. Verification fields open after you choose an action.",
    "zh-CN": "需要时可修改主密码或重置恢复密钥；选择操作后才会显示验证输入框。",
    "zh-TW": "需要時可變更主密碼或重設復原金鑰；選擇操作後才會顯示驗證輸入框。"
  },
  "settings.changePassword": { en: "Change master password", "zh-CN": "修改主密码", "zh-TW": "變更主密碼" },
  "settings.changePasswordHelp": {
    en: "After changing the master password, other devices must log in again. The recovery key is unaffected.",
    "zh-CN": "修改主密码后，其他设备需要重新登录；恢复密钥不受影响。",
    "zh-TW": "變更主密碼後，其他裝置需要重新登入；復原金鑰不受影響。"
  },
  "settings.recoveryHelp": {
    en: "The recovery key can reset a forgotten master password. Replacing it immediately invalidates the old key, so save the new key at once.",
    "zh-CN": "恢复密钥可在忘记主密码时重置密码。重置后旧恢复密钥将立即失效，请马上保存新密钥。",
    "zh-TW": "復原金鑰可在忘記主密碼時重設密碼。重設後舊復原金鑰將立即失效，請立即儲存新金鑰。"
  },
  "settings.resetRecovery": { en: "Reset recovery key", "zh-CN": "重置恢复密钥", "zh-TW": "重設復原金鑰" },
  "settings.recoveryShownOnce": { en: "The new recovery key is shown only once", "zh-CN": "新的恢复密钥仅在本次显示", "zh-TW": "新的復原金鑰僅在本次顯示" },
  "settings.savedRecovery": { en: "I have saved it", "zh-CN": "我已保存", "zh-TW": "我已儲存" },
  "settings.portableData": { en: "Portable data", "zh-CN": "可移植数据", "zh-TW": "可攜式資料" },
  "settings.portableHelp": {
    en: "Markdown ZIP files contain readable plaintext. Store them in a trusted location. ZIP exports retain folders, empty directories, and attachments.",
    "zh-CN": "Markdown ZIP 是可读的明文，请保存到可信位置。ZIP 会保留文件夹、空目录和附件。",
    "zh-TW": "Markdown ZIP 是可讀的明文，請儲存到可信任的位置。ZIP 會保留資料夾、空目錄和附件。"
  },
  "settings.import": { en: "Import Markdown / ZIP", "zh-CN": "导入 Markdown / ZIP", "zh-TW": "匯入 Markdown / ZIP" },
  "settings.export": { en: "Export complete ZIP", "zh-CN": "导出完整 ZIP", "zh-TW": "匯出完整 ZIP" },
  "settings.aboutHelp": {
    en: "Thanks to the following open-source projects.",
    "zh-CN": "感谢以下开源项目。",
    "zh-TW": "感謝以下開源專案。"
  },
  "settings.version": { en: "Version", "zh-CN": "版本", "zh-TW": "版本" },
  "settings.aboutDescription": {
    en: "Mint Notes is a toy-grade project developed with AI. Its goal is to provide a note-taking experience that is lightweight to deploy, secure to store, and simple to use. It supports responsive PWA layouts and end-to-end encryption, so you can safely deploy your notes service on a remote server and edit notes using the Markdown syntax you know.",
    "zh-CN": "Mint Notes 是一款使用 AI 开发的玩具级项目。目标是提供轻量部署、安全储存、简单使用的笔记体验。本项目支持 PWA 自适应布局，采用端到端加密，你可以安全地将笔记服务部署在远程服务器，并使用你熟悉的 Markdown 语法进行笔记编辑。",
    "zh-TW": "Mint Notes 是一款使用 AI 開發的玩具級專案。目標是提供輕量部署、安全儲存、簡單使用的筆記體驗。本專案支援 PWA 自適應版面配置，採用端對端加密，你可以安全地將筆記服務部署在遠端伺服器，並使用你熟悉的 Markdown 語法進行筆記編輯。"
  },
  "settings.acknowledgements": { en: "Acknowledgements", "zh-CN": "致谢", "zh-TW": "致謝" },
  "settings.editorCoreOrigin": { en: "Editor core origin", "zh-CN": "编辑器核心来源", "zh-TW": "編輯器核心來源" },
  "settings.iconLibrary": { en: "Icon library", "zh-CN": "图标包", "zh-TW": "圖示套件" },

  "notice.loadDevicesFailed": { en: "Unable to load device sessions", "zh-CN": "无法加载设备会话", "zh-TW": "無法載入裝置工作階段" },
  "notice.loadTrashRetentionFailed": { en: "Unable to load trash retention settings", "zh-CN": "无法加载回收站保留设置", "zh-TW": "無法載入垃圾桶保留設定" },
  "notice.trashForever": { en: "Trash items will be kept forever", "zh-CN": "回收站内容将永久保留", "zh-TW": "垃圾桶內容將永久保留" },
  "notice.trashDeleteAfter": { en: "Trash items will be automatically deleted after {count} days", "zh-CN": "回收站内容将在 {count} 天后自动删除", "zh-TW": "垃圾桶內容將在 {count} 天後自動刪除" },
  "notice.settingRestored": { en: "{message}. The previous setting was restored.", "zh-CN": "{message}，已恢复原设置", "zh-TW": "{message}，已復原原設定" },
  "notice.saveTrashFailed": { en: "Unable to save trash settings. The previous setting was restored.", "zh-CN": "无法保存回收站设置，已恢复原设置", "zh-TW": "無法儲存垃圾桶設定，已復原原設定" },
  "notice.displayNameUpdated": { en: "Display name updated", "zh-CN": "显示名称已更新", "zh-TW": "顯示名稱已更新" },
  "notice.displayNameFailed": { en: "Unable to update display name", "zh-CN": "无法更新显示名称", "zh-TW": "無法更新顯示名稱" },
  "notice.usernameUpdated": { en: "Username updated; other devices must log in again", "zh-CN": "用户名已更新，其他设备需要重新登录", "zh-TW": "使用者名稱已更新，其他裝置需要重新登入" },
  "notice.usernameRecoveryReset": { en: "Username and recovery key updated; other devices must log in again", "zh-CN": "用户名和恢复密钥已更新，其他设备需要重新登录", "zh-TW": "使用者名稱和復原金鑰已更新，其他裝置需要重新登入" },
  "notice.usernameFailed": { en: "Unable to update username", "zh-CN": "无法更新用户名", "zh-TW": "無法更新使用者名稱" },
  "notice.usernameUnchanged": { en: "Enter a different username", "zh-CN": "请输入不同的用户名", "zh-TW": "請輸入不同的使用者名稱" },
  "notice.avatarUpdated": { en: "Avatar updated", "zh-CN": "头像已更新", "zh-TW": "頭像已更新" },
  "notice.avatarUpdateFailed": { en: "Unable to update avatar", "zh-CN": "无法更新头像", "zh-TW": "無法更新頭像" },
  "notice.avatarRemoved": { en: "Avatar removed", "zh-CN": "头像已移除", "zh-TW": "頭像已移除" },
  "notice.avatarRemoveFailed": { en: "Unable to remove avatar", "zh-CN": "无法移除头像", "zh-TW": "無法移除頭像" },
  "notice.signOutDeviceConfirm": { en: "Sign out {device}? It will need to log in again on its next request.", "zh-CN": "确定登出 {device}？该设备下次请求时将需要重新登录。", "zh-TW": "確定登出 {device}？該裝置下次請求時將需要重新登入。" },
  "notice.deviceSignedOut": { en: "{device} signed out", "zh-CN": "{device} 已登出", "zh-TW": "{device} 已登出" },
  "notice.deviceSignOutFailed": { en: "Unable to sign out device", "zh-CN": "登出设备失败", "zh-TW": "登出裝置失敗" },
  "notice.pinSaved": { en: "PIN saved for this device", "zh-CN": "当前设备 PIN 已保存", "zh-TW": "目前裝置的 PIN 已儲存" },
  "notice.pinSaveFailed": { en: "Unable to save PIN", "zh-CN": "无法保存 PIN", "zh-TW": "無法儲存 PIN" },
  "notice.pinRemoved": { en: "PIN removed from this device and automatic locking disabled", "zh-CN": "当前设备 PIN 已移除，自动锁定已关闭", "zh-TW": "目前裝置的 PIN 已移除，自動鎖定已關閉" },
  "notice.pinRemoveFailed": { en: "Unable to remove PIN", "zh-CN": "无法移除 PIN", "zh-TW": "無法移除 PIN" },
  "notice.setPinFirst": { en: "Set a device PIN above before enabling automatic locking", "zh-CN": "请先在上方设置本机 PIN，再开启自动锁定", "zh-TW": "請先在上方設定本機 PIN，再開啟自動鎖定" },
  "notice.autoLockEnabled": { en: "The app will lock after {count} minutes of inactivity", "zh-CN": "无操作 {count} 分钟后将自动锁定", "zh-TW": "閒置 {count} 分鐘後將自動鎖定" },
  "notice.autoLockDisabled": { en: "Automatic locking disabled; the device PIN is retained", "zh-CN": "自动锁定已关闭，本机 PIN 已保留", "zh-TW": "自動鎖定已關閉，本機 PIN 已保留" },
  "notice.autoLockSaveFailed": { en: "Unable to save automatic locking settings", "zh-CN": "无法保存自动锁定设置", "zh-TW": "無法儲存自動鎖定設定" },
  "notice.passwordChanged": { en: "Master password changed. Other devices must log in again; the recovery key is unaffected.", "zh-CN": "主密码已修改，其他设备需要重新登录；恢复密钥不受影响。", "zh-TW": "主密碼已變更，其他裝置需要重新登入；復原金鑰不受影響。" },
  "notice.passwordChangeFailed": { en: "Unable to change password", "zh-CN": "密码修改失败", "zh-TW": "密碼變更失敗" },
  "notice.recoveryReset": { en: "Recovery key reset; the old recovery key is no longer valid", "zh-CN": "恢复密钥已重置，旧恢复密钥已失效", "zh-TW": "復原金鑰已重設，舊復原金鑰已失效" },
  "notice.recoveryResetFailed": { en: "Unable to reset recovery key", "zh-CN": "无法重置恢复密钥", "zh-TW": "無法重設復原金鑰" },
  "notice.itemRestored": { en: "“{title}” restored", "zh-CN": "“{title}”已恢复", "zh-TW": "「{title}」已復原" },
  "notice.itemRestoreFailed": { en: "Unable to restore “{title}”", "zh-CN": "无法恢复“{title}”", "zh-TW": "無法復原「{title}」" },

  "admin.description": {
    en: "Create and manage user accounts. Administrators cannot view users' note content.",
    "zh-CN": "创建和管理用户账户。管理员无法查看用户的笔记内容。",
    "zh-TW": "建立和管理使用者帳戶。管理員無法查看使用者的筆記內容。"
  },
  "admin.userManagement": { en: "User management", "zh-CN": "用户管理", "zh-TW": "使用者管理" },
  "admin.createPending": { en: "Add user", "zh-CN": "新增用户", "zh-TW": "新增使用者" },
  "admin.createPendingHelp": {
    en: "After you specify a username and display name, a registration activation code valid for 72 hours is generated.",
    "zh-CN": "指定用户名和显示名称后，将生成一个 72 小时内有效的注册激活码。",
    "zh-TW": "指定使用者名稱和顯示名稱後，將產生一個 72 小時內有效的註冊啟用碼。"
  },
  "admin.createCode": { en: "Create activation code", "zh-CN": "创建激活码", "zh-TW": "建立啟用碼" },
  "admin.codeShownOnce": { en: "Activation code is shown only once", "zh-CN": "激活码仅显示一次", "zh-TW": "啟用碼僅顯示一次" },
  "admin.pending": { en: "Pending activation", "zh-CN": "待激活", "zh-TW": "待啟用" },
  "admin.expires": { en: "expires {date}", "zh-CN": "{date} 到期", "zh-TW": "{date} 到期" },
  "admin.existingUsers": { en: "Existing users", "zh-CN": "现有用户", "zh-TW": "現有使用者" },
  "admin.currentAccount": { en: "Current account", "zh-CN": "当前账户", "zh-TW": "目前帳戶" },
  "admin.roleAdmin": { en: "Administrator", "zh-CN": "管理员", "zh-TW": "管理員" },
  "admin.roleUser": { en: "User", "zh-CN": "用户", "zh-TW": "使用者" },
  "admin.objectCount": { en: "{count} objects", "zh-CN": "{count} 个对象", "zh-TW": "{count} 個物件" },
  "admin.enable": { en: "Enable", "zh-CN": "启用", "zh-TW": "啟用" },
  "admin.disable": { en: "Disable", "zh-CN": "禁用", "zh-TW": "停用" },
  "admin.delete": { en: "Delete", "zh-CN": "删除", "zh-TW": "刪除" },
  "admin.deleteUser": { en: "Permanently delete user", "zh-CN": "永久删除用户", "zh-TW": "永久刪除使用者" },
  "admin.deleteUserTitle": { en: "Permanently delete @{username}", "zh-CN": "永久删除 @{username}", "zh-TW": "永久刪除 @{username}" },
  "admin.deleteWarning": {
    en: "This user's account, notes, revision history, attachments, and login devices will be permanently deleted from this server database. This cannot be undone and does not remove independent backups or ciphertext left in the user's browser.",
    "zh-CN": "该用户的账户、笔记、历史版本、附件和登录设备将从当前服务器数据库中永久删除。此操作无法撤销，也不会删除独立备份或用户浏览器中遗留的本地密文。",
    "zh-TW": "該使用者的帳戶、筆記、歷史版本、附件和登入裝置將從目前伺服器資料庫中永久刪除。此操作無法復原，也不會刪除獨立備份或使用者瀏覽器中遺留的本機密文。"
  },
  "admin.confirmUsername": { en: "Enter the username to confirm", "zh-CN": "输入用户名确认", "zh-TW": "輸入使用者名稱確認" },
  "admin.yourPassword": { en: "Your master password", "zh-CN": "你的主密码", "zh-TW": "你的主密碼" },
  "admin.cancelActivationConfirm": { en: "Cancel activation eligibility for @{username}?", "zh-CN": "取消 @{username} 的激活资格？", "zh-TW": "取消 @{username} 的啟用資格？" },
  "admin.loadFailed": { en: "Unable to load administrator settings", "zh-CN": "无法加载管理员设置", "zh-TW": "無法載入管理員設定" },
  "admin.codeCreated": { en: "Activation code created. Save it now.", "zh-CN": "激活码已创建，请立即保存", "zh-TW": "啟用碼已建立，請立即儲存" },
  "admin.createFailed": { en: "Unable to create user", "zh-CN": "无法创建用户", "zh-TW": "無法建立使用者" },
  "admin.userEnabled": { en: "{name} enabled", "zh-CN": "{name} 已启用", "zh-TW": "{name} 已啟用" },
  "admin.userDisabled": { en: "{name} disabled", "zh-CN": "{name} 已禁用", "zh-TW": "{name} 已停用" },
  "admin.updateFailed": { en: "Unable to update user status", "zh-CN": "无法更新用户状态", "zh-TW": "無法更新使用者狀態" },
  "admin.activationCancelled": { en: "Activation eligibility for @{username} cancelled", "zh-CN": "@{username} 的激活资格已取消", "zh-TW": "@{username} 的啟用資格已取消" },
  "admin.cancelFailed": { en: "Unable to cancel activation eligibility", "zh-CN": "无法取消激活资格", "zh-TW": "無法取消啟用資格" },
  "admin.userDeleted": { en: "@{username} permanently deleted", "zh-CN": "@{username} 已永久删除", "zh-TW": "@{username} 已永久刪除" },
  "admin.deleteFailed": { en: "Unable to delete user", "zh-CN": "无法删除用户", "zh-TW": "無法刪除使用者" },

  "app.save.saving": { en: "Saving locally…", "zh-CN": "正在保存到本地…", "zh-TW": "正在儲存到本機…" },
  "app.save.local": { en: "Saved locally · waiting for the server", "zh-CN": "已保存到本地 · 正在等待服务器", "zh-TW": "已儲存在本機 · 正在等待伺服器" },
  "app.save.syncing": { en: "Syncing…", "zh-CN": "正在同步…", "zh-TW": "正在同步…" },
  "app.save.synced": { en: "Synced", "zh-CN": "已同步", "zh-TW": "已同步" },
  "app.save.offline": { en: "Offline · saved locally", "zh-CN": "离线 · 已保存到本地", "zh-TW": "離線 · 已儲存在本機" },
  "app.save.error": { en: "Sync error · saved locally", "zh-CN": "同步错误 · 已保存到本地", "zh-TW": "同步錯誤 · 已儲存在本機" },
  "app.save.syncingDetail": { en: "Synchronizing with the server…", "zh-CN": "正在与服务器同步…", "zh-TW": "正在與伺服器同步…" },
  "app.save.offlineDetail": {
    en: "Device is offline · changes are saved locally and will synchronize after reconnecting",
    "zh-CN": "设备当前离线 · 修改已保存到本地，联网后自动同步",
    "zh-TW": "裝置目前離線 · 修改已儲存在本機，連線後自動同步"
  },
  "app.save.unreachableDetail": {
    en: "Unable to connect to the server · changes are saved locally and synchronization will retry automatically",
    "zh-CN": "无法连接服务器 · 修改已保存到本地，将自动重试",
    "zh-TW": "無法連線到伺服器 · 修改已儲存在本機，將自動重試"
  },
  "app.save.serverErrorDetail": {
    en: "The server rejected synchronization: {reason} · changes are saved locally and synchronization will retry automatically",
    "zh-CN": "服务器拒绝同步：{reason} · 修改已保存到本地，将自动重试",
    "zh-TW": "伺服器拒絕同步：{reason} · 修改已儲存在本機，將自動重試"
  },
  "app.save.localFailureDetail": {
    en: "Local save failed · the latest changes are not yet safely stored",
    "zh-CN": "本地保存失败 · 最新修改尚未安全保存",
    "zh-TW": "本機儲存失敗 · 最新修改尚未安全儲存"
  },
  "app.loadingNotes": { en: "Decrypting local notes…", "zh-CN": "正在解密本地笔记…", "zh-TW": "正在解密本機筆記…" },
  "app.untitled": { en: "Untitled note", "zh-CN": "无标题笔记", "zh-TW": "無標題筆記" },
  "app.newFolder": { en: "New folder", "zh-CN": "新文件夹", "zh-TW": "新資料夾" },
  "app.welcomeTitle": { en: "Welcome", "zh-CN": "欢迎使用", "zh-TW": "歡迎使用" },
  "app.welcomeMarkdown": {
    en: "# Welcome\n\nThis is a local-first, end-to-end encrypted Markdown note.\n\n- Manage folders and notes on the left\n- Drag notes into folders\n- Image attachments are encrypted in the browser\n",
    "zh-CN": "# 欢迎使用\n\n这是一个本地优先、端到端加密的 Markdown 笔记。\n\n- 左侧管理文件夹和笔记\n- 可把笔记拖入文件夹\n- 图片附件在浏览器中加密\n",
    "zh-TW": "# 歡迎使用\n\n這是一個本機優先、端對端加密的 Markdown 筆記。\n\n- 在左側管理資料夾和筆記\n- 可將筆記拖入資料夾\n- 圖片附件會在瀏覽器中加密\n"
  },
  "app.conflictSuffix": { en: "conflict copy", "zh-CN": "冲突副本", "zh-TW": "衝突副本" },
  "app.copySuffix": { en: "copy", "zh-CN": "副本", "zh-TW": "副本" },
  "app.closeNotification": { en: "Close notification", "zh-CN": "关闭通知", "zh-TW": "關閉通知" },
  "app.collapseDirectory": { en: "Collapse directory", "zh-CN": "折叠目录", "zh-TW": "收合目錄" },
  "app.closeDirectory": { en: "Close directory", "zh-CN": "关闭目录", "zh-TW": "關閉目錄" },
  "app.pinned": { en: "Pinned", "zh-CN": "置顶", "zh-TW": "置頂" },
  "app.folderToggleHint": { en: "Expand or collapse this folder in the file list", "zh-CN": "在文件列表中展开或折叠此文件夹", "zh-TW": "在檔案清單中展開或收合此資料夾" },
  "app.notSynced": { en: "Not yet synchronized", "zh-CN": "尚未同步", "zh-TW": "尚未同步" },
  "app.openMenu": { en: "Open menu for {title}", "zh-CN": "打开 {title} 菜单", "zh-TW": "開啟 {title} 選單" },
  "app.search": { en: "Search notes", "zh-CN": "搜索笔记", "zh-TW": "搜尋筆記" },
  "app.clearSearch": { en: "Clear search", "zh-CN": "清除搜索", "zh-TW": "清除搜尋" },
  "app.noteActions": { en: "Note actions", "zh-CN": "笔记操作", "zh-TW": "筆記操作" },
  "app.newNote": { en: "New note", "zh-CN": "新建笔记", "zh-TW": "新增筆記" },
  "app.createFolder": { en: "New folder", "zh-CN": "新建文件夹", "zh-TW": "新增資料夾" },
  "app.collapseAll": { en: "Collapse all folders", "zh-CN": "折叠所有文件夹", "zh-TW": "收合所有資料夾" },
  "app.locateCurrent": { en: "Locate current note", "zh-CN": "定位当前笔记", "zh-TW": "定位目前筆記" },
  "app.sort": { en: "Sort order", "zh-CN": "排序方式", "zh-TW": "排序方式" },
  "app.sortCreated": { en: "Created", "zh-CN": "建立时间", "zh-TW": "建立時間" },
  "app.sortUpdated": { en: "Last modified", "zh-CN": "上次修改", "zh-TW": "上次修改" },
  "app.sortManual": { en: "Manual", "zh-CN": "手动", "zh-TW": "手動" },
  "app.noMatches": { en: "No matching notes", "zh-CN": "没有匹配的笔记", "zh-TW": "沒有相符的筆記" },
  "app.lock": { en: "Lock", "zh-CN": "锁定", "zh-TW": "鎖定" },
  "app.lockNote": { en: "Lock note", "zh-CN": "锁定笔记", "zh-TW": "鎖定筆記" },
  "app.unlockNote": { en: "Unlock note", "zh-CN": "解锁笔记", "zh-TW": "解鎖筆記" },
  "app.unlockToEdit": { en: "Unlock this note to edit it", "zh-CN": "请先解锁此笔记再进行编辑", "zh-TW": "請先解鎖此筆記再進行編輯" },
  "app.noteLockedBadge": { en: "Locked note", "zh-CN": "已锁定笔记", "zh-TW": "已鎖定筆記" },
  "app.logout": { en: "Log out", "zh-CN": "登出", "zh-TW": "登出" },
  "app.resizeLeft": { en: "Resize left sidebar", "zh-CN": "调整左侧栏宽度", "zh-TW": "調整左側欄寬度" },
  "app.openLeft": { en: "Open left sidebar", "zh-CN": "打开左侧栏", "zh-TW": "開啟左側欄" },
  "app.noteTitle": { en: "Note title", "zh-CN": "笔记标题", "zh-TW": "筆記標題" },
  "app.selectNote": { en: "Select a note", "zh-CN": "选择一篇笔记", "zh-TW": "選擇一篇筆記" },
  "app.displayMode": { en: "Display mode", "zh-CN": "显示模式", "zh-TW": "顯示模式" },
  "app.modeLive": { en: "Live", "zh-CN": "实时", "zh-TW": "即時" },
  "app.modeSource": { en: "Source", "zh-CN": "源码", "zh-TW": "原始碼" },
  "app.modeReading": { en: "Reading", "zh-CN": "阅读", "zh-TW": "閱讀" },
  "app.addImage": { en: "Add image attachment", "zh-CN": "添加图片附件", "zh-TW": "新增圖片附件" },
  "app.openRight": { en: "Open right sidebar", "zh-CN": "打开右侧栏", "zh-TW": "開啟右側欄" },
  "app.emptyTitle": { en: "Select or create a note", "zh-CN": "选择或创建一篇笔记", "zh-TW": "選擇或建立一篇筆記" },
  "app.emptyNoteHint": { en: "Start writing…", "zh-CN": "开始写作…", "zh-TW": "開始寫作…" },
  "app.createdAt": { en: "Created: {date}", "zh-CN": "创建时间: {date}", "zh-TW": "建立時間：{date}" },
  "app.updatedAt": { en: "Modified: {date}", "zh-CN": "修改时间: {date}", "zh-TW": "修改時間：{date}" },
  "app.countHelp": { en: "Words are segmented by language and exclude punctuation; characters exclude whitespace but include symbols", "zh-CN": "字词按语言分段，标点不计入；字符排除空白但包含符号", "zh-TW": "字詞依語言分段，標點不計入；字元排除空白但包含符號" },
  "app.count": { en: "{words} words · {characters} characters", "zh-CN": "{words} 字词 · {characters} 字符", "zh-TW": "{words} 字詞 · {characters} 字元" },
  "app.resizeRight": { en: "Resize right sidebar", "zh-CN": "调整右侧栏宽度", "zh-TW": "調整右側欄寬度" },
  "app.rightPanel": { en: "Right panel", "zh-CN": "右侧面板", "zh-TW": "右側面板" },
  "app.outline": { en: "Outline", "zh-CN": "大纲", "zh-TW": "大綱" },
  "app.collapseRight": { en: "Collapse right sidebar", "zh-CN": "折叠右侧栏", "zh-TW": "收合右側欄" },
  "app.closeRight": { en: "Close right sidebar", "zh-CN": "关闭右侧栏", "zh-TW": "關閉右側欄" },
  "app.noteOutline": { en: "Note outline", "zh-CN": "笔记大纲", "zh-TW": "筆記大綱" },
  "app.outlineEmpty": { en: "Add Markdown headings to see a live outline here.", "zh-CN": "添加 Markdown 标题后，大纲会实时显示在这里。", "zh-TW": "新增 Markdown 標題後，大綱會即時顯示在這裡。" },
  "app.closeSidebars": { en: "Close sidebars", "zh-CN": "关闭侧栏", "zh-TW": "關閉側欄" },
  "app.selectedCount": { en: "{count} items selected", "zh-CN": "已选择 {count} 个项目", "zh-TW": "已選擇 {count} 個項目" },
  "app.open": { en: "Open", "zh-CN": "打开", "zh-TW": "開啟" },
  "app.rename": { en: "Rename", "zh-CN": "重命名", "zh-TW": "重新命名" },
  "app.unpin": { en: "Unpin", "zh-CN": "取消置顶", "zh-TW": "取消置頂" },
  "app.createNoteInFolder": { en: "New note in folder", "zh-CN": "在文件夹中新建笔记", "zh-TW": "在資料夾中新增筆記" },
  "app.createSubfolder": { en: "New subfolder", "zh-CN": "新建子文件夹", "zh-TW": "新增子資料夾" },
  "app.duplicate": { en: "Make a copy", "zh-CN": "制作副本", "zh-TW": "製作副本" },
  "app.export": { en: "Export", "zh-CN": "导出", "zh-TW": "匯出" },
  "app.moveTo": { en: "Move to…", "zh-CN": "移动到…", "zh-TW": "移動到…" },
  "app.rootDirectory": { en: "Root directory", "zh-CN": "根目录", "zh-TW": "根目錄" },
  "app.restore": { en: "Restore", "zh-CN": "恢复", "zh-TW": "復原" },
  "app.permanentDeleteEllipsis": { en: "Permanently delete…", "zh-CN": "永久删除…", "zh-TW": "永久刪除…" },
  "app.moveToTrash": { en: "Move to trash", "zh-CN": "移到回收站", "zh-TW": "移到垃圾桶" },
  "app.markdownSource": { en: "Markdown source", "zh-CN": "Markdown 源码", "zh-TW": "Markdown 原始碼" },
  "properties.title": { en: "Note properties", "zh-CN": "笔记属性", "zh-TW": "筆記屬性" },
  "properties.key": { en: "Property name", "zh-CN": "属性名称", "zh-TW": "屬性名稱" },
  "properties.value": { en: "Value for {key}", "zh-CN": "{key} 的值", "zh-TW": "{key} 的值" },
  "properties.noValue": { en: "No value", "zh-CN": "没有值", "zh-TW": "沒有值" },
  "properties.add": { en: "Add note property", "zh-CN": "添加笔记属性", "zh-TW": "新增筆記屬性" },
  "properties.remove": { en: "Remove property", "zh-CN": "删除属性", "zh-TW": "刪除屬性" },
  "properties.removeNamed": { en: "Remove property {key}", "zh-CN": "删除属性 {key}", "zh-TW": "刪除屬性 {key}" },
  "properties.addListValue": { en: "Add value", "zh-CN": "添加值", "zh-TW": "新增值" },
  "properties.removeListValue": { en: "Remove value {value}", "zh-CN": "删除值 {value}", "zh-TW": "刪除值 {value}" },
  "properties.keyRequired": { en: "A property name is required.", "zh-CN": "属性名称不能为空。", "zh-TW": "屬性名稱不能為空。" },
  "properties.keyDuplicate": { en: "That property name already exists.", "zh-CN": "该属性名称已存在。", "zh-TW": "該屬性名稱已存在。" },
  "properties.invalid": {
    en: "This YAML frontmatter is invalid and has been left unchanged.",
    "zh-CN": "这段 YAML 元数据无效，内容已原样保留。",
    "zh-TW": "這段 YAML 中繼資料無效，內容已原樣保留。"
  },
  "properties.sourceHint": {
    en: "Switch to Source mode to edit the original YAML.",
    "zh-CN": "请切换到源码模式编辑原始 YAML。",
    "zh-TW": "請切換到原始碼模式編輯原始 YAML。"
  },
  "properties.complexValue": { en: "Complex YAML value", "zh-CN": "复杂 YAML 值", "zh-TW": "複雜 YAML 值" },
  "properties.complexHint": {
    en: "Complex YAML values are read-only here. Edit them in Source mode.",
    "zh-CN": "复杂 YAML 值在此处为只读，请在源码模式中编辑。",
    "zh-TW": "複雜 YAML 值在此處為唯讀，請在原始碼模式中編輯。"
  },
  "app.attachmentNotLoaded": { en: "Attachment not loaded: {name}", "zh-CN": "附件尚未加载：{name}", "zh-TW": "附件尚未載入：{name}" },

  "notice.attachmentConflict": { en: "Attachment metadata conflict detected. The server version was retained and local attachment chunks were not deleted.", "zh-CN": "检测到附件元数据冲突；已保留服务器版本，本地附件分块仍未删除。", "zh-TW": "偵測到附件中繼資料衝突；已保留伺服器版本，本機附件分塊仍未刪除。" },
  "notice.documentConflict": { en: "“{title}” has a cross-device conflict. Local changes were saved as a conflict copy.", "zh-CN": "“{title}”存在多端冲突，本地修改已保存为冲突副本。", "zh-TW": "「{title}」發生跨裝置衝突，本機修改已儲存為衝突副本。" },
  "notice.activeRemoteDeleted": { en: "The current note was deleted on another device. To avoid interrupting editing, the interface will update after you leave this note.", "zh-CN": "当前笔记已在其他设备上删除；为避免打断编辑，将在离开当前笔记后更新界面。", "zh-TW": "目前筆記已在其他裝置上刪除；為避免中斷編輯，將在離開目前筆記後更新介面。" },
  "notice.activeRemoteUpdated": { en: "The current note was updated on another device. To avoid interrupting editing, the remote version will be applied after you leave this note.", "zh-CN": "当前笔记在其他设备上已更新；为避免打断编辑，将在离开当前笔记后应用远端版本。", "zh-TW": "目前筆記已在其他裝置上更新；為避免中斷編輯，將在離開目前筆記後套用遠端版本。" },
  "notice.remoteIntegrity": { en: "{count} encrypted server items failed integrity checks. The last readable local versions were retained.", "zh-CN": "{count} 个服务器加密项目未能通过完整性校验；已保留本机最后一次可读版本。", "zh-TW": "{count} 個伺服器加密項目未通過完整性驗證；已保留本機最後一次可讀版本。" },
  "notice.syncFailed": { en: "Synchronization failed. Changes remain saved locally.", "zh-CN": "同步失败，修改仍保存在本地", "zh-TW": "同步失敗，修改仍儲存在本機" },
  "notice.localSaveFailed": {
    en: "Local save failed. The latest changes are still open but are not yet safely stored.",
    "zh-CN": "本地保存失败，最新修改仍在当前页面中，但尚未安全保存。",
    "zh-TW": "本機儲存失敗，最新修改仍在目前頁面中，但尚未安全儲存。"
  },
  "notice.localDecryptFailed": { en: "{count} local encrypted items could not be decrypted. Other notes loaded normally. {detail}", "zh-CN": "{count} 个本地加密项目暂时无法解密，其他笔记已正常加载。{detail}", "zh-TW": "{count} 個本機加密項目暫時無法解密，其他筆記已正常載入。{detail}" },
  "notice.pendingDecryptFailed": { en: "{count} contain unsynchronized changes and were retained unchanged.", "zh-CN": "其中 {count} 个含未同步修改，已原样保留。", "zh-TW": "其中 {count} 個包含未同步修改，已原樣保留。" },
  "notice.ciphertextRetained": { en: "The original ciphertext was retained.", "zh-CN": "已保留原始密文。", "zh-TW": "已保留原始密文。" },
  "notice.ignoreRevision": { en: "Do not show this version again", "zh-CN": "不再提示此版本", "zh-TW": "不再提示此版本" },
  "notice.remoteIntegrityOthers": { en: "{count} encrypted server items failed integrity checks. Other notes loaded normally and all readable local versions were retained.", "zh-CN": "{count} 个服务器加密项目未能通过完整性校验；其他笔记已正常加载，本机可读版本均已保留。", "zh-TW": "{count} 個伺服器加密項目未通過完整性驗證；其他筆記已正常載入，本機可讀版本均已保留。" },
  "notice.localRestoredSyncRetry": { en: "Notes were restored locally, but server synchronization failed and will retry automatically.", "zh-CN": "笔记已从本地恢复，但本次服务器同步失败，稍后会自动重试。", "zh-TW": "筆記已從本機復原，但本次伺服器同步失敗，稍後會自動重試。" },
  "notice.loadedOffline": { en: "Local notes loaded while offline.", "zh-CN": "离线状态下已加载本地笔记。", "zh-TW": "已在離線狀態載入本機筆記。" },
  "notice.onlineSessionRequired": {
    en: "This action requires an online, verified server session.",
    "zh-CN": "此操作需要联网并完成服务器会话验证。",
    "zh-TW": "此操作需要連線並完成伺服器工作階段驗證。"
  },
  "notice.openDatabaseFailed": { en: "Unable to open the local encrypted database", "zh-CN": "无法打开本地加密数据库", "zh-TW": "無法開啟本機加密資料庫" },
  "notice.logoutLocalClearFailed": { en: "Unable to delete this account's local data. You have not been logged out.", "zh-CN": "无法删除当前账户的本地数据，尚未登出。", "zh-TW": "無法刪除目前帳戶的本機資料，尚未登出。" },
  "notice.attachmentLoadFailed": { en: "Unable to load attachment", "zh-CN": "附件加载失败", "zh-TW": "附件載入失敗" },
  "notice.attachmentSaveFailed": { en: "Unable to save attachment", "zh-CN": "附件保存失败", "zh-TW": "附件儲存失敗" },
  "notice.restoreNameConflict": { en: "Cannot restore: “{title}” already exists in that directory.", "zh-CN": "无法恢复：“{title}”所在目录中已有同名项目。", "zh-TW": "無法復原：「{title}」所在目錄中已有同名項目。" },
  "notice.wikiLinkNotFound": { en: "WikiLink target not found: {target}", "zh-CN": "找不到 WikiLink 目标：{target}", "zh-TW": "找不到 WikiLink 目標：{target}" },
  "notice.purgeSingleLabel": { en: "“{title}” and its child items and attachments", "zh-CN": "“{title}”及其子项目和附件", "zh-TW": "「{title}」及其子項目和附件" },
  "notice.purgeMultipleLabel": { en: "the selected {count} items and their child items and attachments", "zh-CN": "选中的 {count} 个项目及其子项目和附件", "zh-TW": "選取的 {count} 個項目及其子項目和附件" },
  "notice.purgeConfirm": { en: "Permanently delete {label}? Server revision history will also be removed. This cannot be undone.", "zh-CN": "永久删除{label}？服务器历史版本也会被清除，此操作无法撤销。", "zh-TW": "永久刪除{label}？伺服器歷史版本也會被清除，此操作無法復原。" },
  "notice.clearTrashConfirm": { en: "Permanently delete everything in trash? Server revision history and encrypted attachments will also be removed. This cannot be undone.", "zh-CN": "永久删除回收站中的全部内容？服务器历史版本及附件密文也会被清除，此操作无法撤销。", "zh-TW": "永久刪除垃圾桶中的所有內容？伺服器歷史版本及附件密文也會被清除，此操作無法復原。" },
  "notice.purgeOnlineOnly": { en: "Permanent deletion requires an online connection. The content remains in trash while offline.", "zh-CN": "永久删除必须联网完成；离线时内容仍保留在回收站。", "zh-TW": "永久刪除必須連線完成；離線時內容仍保留在垃圾桶。" },
  "notice.purgeWaitSync": { en: "Wait for deletion status to synchronize before permanently deleting.", "zh-CN": "请等待删除状态同步完成后再永久删除。", "zh-TW": "請等待刪除狀態同步完成後再永久刪除。" },
  "notice.purgeComplete": { en: "Selected trash content permanently deleted.", "zh-CN": "已永久删除所选回收站内容。", "zh-TW": "已永久刪除所選垃圾桶內容。" },
  "notice.purgeFailed": { en: "Permanent deletion failed", "zh-CN": "永久删除失败", "zh-TW": "永久刪除失敗" },
  "notice.moveIntoDescendant": { en: "A folder cannot be moved into itself or one of its descendants.", "zh-CN": "不能把文件夹移动到自身或其子文件夹中。", "zh-TW": "不能將資料夾移動到自身或其子資料夾中。" },
  "notice.moveNameConflict": { en: "Cannot move: an item named “{title}” already exists in the destination.", "zh-CN": "无法移动：目标目录中已有名为“{title}”的项目。", "zh-TW": "無法移動：目標目錄中已有名為「{title}」的項目。" },
  "notice.batchMoveIntoDescendant": { en: "Selected folders cannot be moved into themselves or their descendants.", "zh-CN": "不能把所选文件夹移动到自身或其子文件夹中。", "zh-TW": "不能將所選資料夾移動到自身或其子資料夾中。" },
  "notice.batchMoveNameConflict": { en: "Cannot move selection: the destination would contain duplicate items named “{title}”.", "zh-CN": "无法批量移动：目标目录会出现名为“{title}”的重复项目。", "zh-TW": "無法批次移動：目標目錄會出現名為「{title}」的重複項目。" },
  "notice.encryptingAttachment": { en: "Encrypting {name} locally…", "zh-CN": "正在本地加密 {name}…", "zh-TW": "正在本機加密 {name}…" },
  "notice.attachmentSaved": { en: "Attachment “{name}” saved locally and synchronizing in the background.", "zh-CN": "附件“{name}”已保存到本地，正在后台同步。", "zh-TW": "附件「{name}」已儲存在本機，正在背景同步。" },
  "notice.noteLocked": { en: "“{title}” locked", "zh-CN": "已锁定“{title}”", "zh-TW": "已鎖定「{title}」" },
  "notice.noteUnlocked": { en: "“{title}” unlocked", "zh-CN": "已解锁“{title}”", "zh-TW": "已解鎖「{title}」" },
  "notice.noteLockedEdit": { en: "Unlock “{title}” before editing it", "zh-CN": "请先解锁“{title}”再进行编辑", "zh-TW": "請先解鎖「{title}」再進行編輯" },
  "notice.noteLockFailed": { en: "Unable to update note lock", "zh-CN": "无法更新笔记锁定状态", "zh-TW": "無法更新筆記鎖定狀態" },
  "notice.lockedTrashBlocked": { en: "Unlock “{title}” before moving this selection to trash", "zh-CN": "所选内容包含已锁定的“{title}”，请先解锁再移到回收站", "zh-TW": "所選內容包含已鎖定的「{title}」，請先解鎖再移到垃圾桶" },
  "notice.copiesCreated": { en: "{count} copies created.", "zh-CN": "已创建 {count} 个副本。", "zh-TW": "已建立 {count} 個副本。" },
  "notice.nameRequired": { en: "The name cannot be empty.", "zh-CN": "名称不能为空。", "zh-TW": "名稱不能為空。" },
  "notice.renameConflict": { en: "Cannot rename: an item named “{title}” already exists in this directory.", "zh-CN": "无法重命名：所在目录中已有名为“{title}”的项目。", "zh-TW": "無法重新命名：所在目錄中已有名為「{title}」的項目。" },
  "notice.allNotes": { en: "all notes", "zh-CN": "全部笔记", "zh-TW": "全部筆記" },
  "notice.exportConfirm": { en: "Export {label}? The export contains readable plaintext. Store it in a trusted location.", "zh-CN": "确认导出{label}？导出文件包含可读取的明文内容，请保存到可信位置。", "zh-TW": "確認匯出{label}？匯出檔案包含可讀取的明文內容，請儲存到可信任的位置。" },
  "notice.exportSelectionConfirm": { en: "Export the selected {count} items? The export contains readable plaintext. Store it in a trusted location.", "zh-CN": "确认导出选中的 {count} 个项目？导出文件包含可读取的明文内容，请保存到可信位置。", "zh-TW": "確認匯出所選的 {count} 個項目？匯出檔案包含可讀取的明文內容，請儲存到可信任的位置。" },
  "notice.importing": { en: "Parsing and encrypting imported files…", "zh-CN": "正在解析并加密导入文件…", "zh-TW": "正在解析並加密匯入檔案…" },
  "notice.imported": { en: "{count} notes imported and synchronizing in the background.", "zh-CN": "已导入 {count} 篇笔记，正在后台同步。", "zh-TW": "已匯入 {count} 篇筆記，正在背景同步。" },
  "notice.importFailed": { en: "Import failed", "zh-CN": "导入失败", "zh-TW": "匯入失敗" },
  "notice.configurePin": { en: "Set a device PIN under Settings > Security > Set PIN first.", "zh-CN": "请先在“设置 > 安全 > 设置 PIN”中设置本机 PIN。", "zh-TW": "請先在「設定 > 安全性 > 設定 PIN」中設定本機 PIN。" },

  "history.title": { en: "History", "zh-CN": "历史", "zh-TW": "歷史" },
  "history.list": { en: "Note history", "zh-CN": "笔记历史", "zh-TW": "筆記歷史" },
  "history.saveNow": { en: "Save current version", "zh-CN": "保存当前版本", "zh-TW": "儲存目前版本" },
  "history.clearNote": { en: "Clear this note's history", "zh-CN": "清空当前笔记历史", "zh-TW": "清空目前筆記歷史" },
  "history.empty": { en: "No saved history for this note yet.", "zh-CN": "这篇笔记还没有保存的历史版本。", "zh-TW": "這篇筆記還沒有儲存的歷史版本。" },
  "history.loading": { en: "Loading history…", "zh-CN": "正在加载历史…", "zh-TW": "正在載入歷史…" },
  "history.loadMore": { en: "Load older versions", "zh-CN": "加载更早版本", "zh-TW": "載入更早版本" },
  "history.pending": { en: "Pending sync", "zh-CN": "等待同步", "zh-TW": "等待同步" },
  "history.kindBaseline": { en: "Before editing", "zh-CN": "编辑前基线", "zh-TW": "編輯前基線" },
  "history.kindInterval": { en: "Automatic checkpoint", "zh-CN": "自动检查点", "zh-TW": "自動檢查點" },
  "history.kindIdle": { en: "End of editing", "zh-CN": "编辑结束", "zh-TW": "編輯結束" },
  "history.kindManual": { en: "Saved manually", "zh-CN": "手动保存", "zh-TW": "手動儲存" },
  "history.kindRestoreSafety": { en: "Before restore", "zh-CN": "恢复前保护", "zh-TW": "復原前保護" },
  "history.deleteOne": { en: "Delete this version", "zh-CN": "删除这个版本", "zh-TW": "刪除這個版本" },
  "history.deleteConfirm": { en: "Permanently delete the history version from {date}?", "zh-CN": "永久删除 {date} 的历史版本？", "zh-TW": "永久刪除 {date} 的歷史版本？" },
  "history.clearNoteConfirm": { en: "Permanently clear all history for “{title}”?", "zh-CN": "永久清空“{title}”的全部历史版本？", "zh-TW": "永久清空「{title}」的全部歷史版本？" },
  "history.clearAllConfirm": { en: "Permanently clear note history for the entire account? This cannot be undone.", "zh-CN": "永久清空此账户的全部笔记历史？此操作无法撤销。", "zh-TW": "永久清空此帳戶的全部筆記歷史？此操作無法復原。" },
  "history.preview": { en: "Historical preview", "zh-CN": "历史版本预览", "zh-TW": "歷史版本預覽" },
  "history.exitPreview": { en: "Exit preview", "zh-CN": "退出预览", "zh-TW": "退出預覽" },
  "history.restoreCopy": { en: "Restore as copy", "zh-CN": "恢复为副本", "zh-TW": "復原為副本" },
  "history.restoreCurrent": { en: "Restore current note", "zh-CN": "恢复为当前版本", "zh-TW": "復原為目前版本" },
  "history.restoreMissingAttachments": { en: "{count} referenced attachments are unavailable. Restore the text anyway?", "zh-CN": "有 {count} 个引用附件不可用，仍然只恢复文本吗？", "zh-TW": "有 {count} 個引用附件無法使用，仍然只復原文字嗎？" },
  "history.copyMissingAttachment": { en: "Cannot restore the copy because attachment {attachment} is unavailable.", "zh-CN": "附件 {attachment} 不可用，无法完整恢复副本。", "zh-TW": "附件 {attachment} 無法使用，無法完整復原副本。" },
  "history.restoredCopyTitle": { en: "{title} (restored {date})", "zh-CN": "{title}（恢复副本 {date}）", "zh-TW": "{title}（復原副本 {date}）" },
  "history.unsupported": { en: "This history format is not supported.", "zh-CN": "不支持这个历史版本格式。", "zh-TW": "不支援這個歷史版本格式。" },

  "settings.history": { en: "Note history", "zh-CN": "笔记历史", "zh-TW": "筆記歷史" },
  "settings.historyHelp": { en: "Versions are encrypted in your browser, saved locally first, and synchronized across your devices.", "zh-CN": "历史版本先在浏览器中加密并保存到本地，再跨设备同步。", "zh-TW": "歷史版本先在瀏覽器中加密並儲存到本機，再跨裝置同步。" },
  "settings.historyAutomatic": { en: "Automatic history", "zh-CN": "自动保存历史", "zh-TW": "自動儲存歷史" },
  "settings.historyFrequency": { en: "Active editing interval", "zh-CN": "持续编辑保存间隔", "zh-TW": "持續編輯儲存間隔" },
  "settings.historyRetention": { en: "Keep history for", "zh-CN": "历史保留时间", "zh-TW": "歷史保留時間" },
  "settings.historyTiered": { en: "All automatic versions are kept for 24 hours, then one per hour through day 7, and one per day afterward. Manual and pre-restore versions are not thinned.", "zh-CN": "自动版本在 24 小时内全部保留，2–7 天每小时保留一份，之后每天保留一份；手动和恢复前版本不降采样。", "zh-TW": "自動版本在 24 小時內全部保留，2–7 天每小時保留一份，之後每天保留一份；手動和復原前版本不降採樣。" },
  "settings.historyStorage": { en: "Encrypted history storage", "zh-CN": "加密历史存储", "zh-TW": "加密歷史儲存空間" },
  "settings.historyVersionCount": { en: "{count} versions", "zh-CN": "{count} 个版本", "zh-TW": "{count} 個版本" },
  "settings.historyClearAll": { en: "Clear all note history", "zh-CN": "清空全部笔记历史", "zh-TW": "清空全部筆記歷史" },

  "notice.historySaved": { en: "The current version was encrypted and saved locally.", "zh-CN": "当前版本已加密并保存到本地。", "zh-TW": "目前版本已加密並儲存到本機。" },
  "notice.historyUnchanged": { en: "This content is already the latest saved version.", "zh-CN": "当前内容与最新历史版本相同。", "zh-TW": "目前內容與最新歷史版本相同。" },
  "notice.historySaveFailed": { en: "Unable to save note history", "zh-CN": "无法保存笔记历史", "zh-TW": "無法儲存筆記歷史" },
  "notice.historyLoadFailed": { en: "Unable to load note history", "zh-CN": "无法加载笔记历史", "zh-TW": "無法載入筆記歷史" },
  "notice.historyDecryptFailed": { en: "This history version could not be decrypted. Other versions remain available.", "zh-CN": "无法解密这个历史版本，其他版本仍可使用。", "zh-TW": "無法解密這個歷史版本，其他版本仍可使用。" },
  "notice.historyDeleteOnlineOnly": { en: "History deletion requires an internet connection.", "zh-CN": "删除历史记录需要联网。", "zh-TW": "刪除歷史記錄需要連線。" },
  "notice.historyDeleted": { en: "History version deleted.", "zh-CN": "历史版本已删除。", "zh-TW": "歷史版本已刪除。" },
  "notice.historyDeleteFailed": { en: "Unable to delete the history version", "zh-CN": "无法删除历史版本", "zh-TW": "無法刪除歷史版本" },
  "notice.historyCleared": { en: "This note's history was cleared.", "zh-CN": "当前笔记的历史已清空。", "zh-TW": "目前筆記的歷史已清空。" },
  "notice.historyAllCleared": { en: "All note history was cleared.", "zh-CN": "全部笔记历史已清空。", "zh-TW": "全部筆記歷史已清空。" },
  "notice.historyClearFailed": { en: "Unable to clear note history", "zh-CN": "无法清空笔记历史", "zh-TW": "無法清空筆記歷史" },
  "notice.historyRestored": { en: "The historical content is now the current version.", "zh-CN": "历史内容已恢复为当前版本。", "zh-TW": "歷史內容已復原為目前版本。" },
  "notice.historyRestoreFailed": { en: "Unable to restore this history version", "zh-CN": "无法恢复这个历史版本", "zh-TW": "無法復原這個歷史版本" },
  "notice.historyCopyRestored": { en: "The history version was restored as a new note.", "zh-CN": "历史版本已恢复为一篇新笔记。", "zh-TW": "歷史版本已復原為一篇新筆記。" },
  "notice.historyCopyFailed": { en: "Unable to restore the history version as a copy", "zh-CN": "无法将历史版本恢复为副本", "zh-TW": "無法將歷史版本復原為副本" },
  "notice.historyQuotaReached": { en: "The encrypted history quota is full. Automatic history is paused until space is freed.", "zh-CN": "加密历史配额已用尽；释放空间前将暂停自动历史同步。", "zh-TW": "加密歷史配額已用盡；釋放空間前將暫停自動歷史同步。" },
  "notice.historySettingsSaved": { en: "Note history settings saved.", "zh-CN": "笔记历史设置已保存。", "zh-TW": "筆記歷史設定已儲存。" },
  "notice.historySettingsLoadFailed": { en: "Unable to load note history settings", "zh-CN": "无法加载笔记历史设置", "zh-TW": "無法載入筆記歷史設定" },
  "notice.historySettingsSaveFailed": { en: "Unable to save note history settings", "zh-CN": "无法保存笔记历史设置", "zh-TW": "無法儲存筆記歷史設定" },

  "error.pinMin": { en: "The PIN must contain at least 4 characters", "zh-CN": "PIN 至少需要 4 个字符", "zh-TW": "PIN 至少需要 4 個字元" },
  "error.deviceCredentialMissing": { en: "No device unlock credential is available on this device", "zh-CN": "当前设备没有可用的本机解锁凭据", "zh-TW": "目前裝置沒有可用的本機解鎖憑證" },
  "error.autoLockUnsupported": { en: "Unsupported automatic locking duration", "zh-CN": "不支持的自动锁定时间", "zh-TW": "不支援的自動鎖定時間" },
  "error.avatarProcess": { en: "Unable to process avatar image", "zh-CN": "无法处理头像图片", "zh-TW": "無法處理頭像圖片" },
  "error.avatarTooLarge": { en: "The source avatar image cannot exceed 10 MiB", "zh-CN": "头像原图不能超过 10 MiB", "zh-TW": "頭像原圖不能超過 10 MiB" },
  "error.avatarFormat": { en: "Choose a PNG, JPEG, GIF, WebP, or AVIF image", "zh-CN": "请选择 PNG、JPEG、GIF、WebP 或 AVIF 图片", "zh-TW": "請選擇 PNG、JPEG、GIF、WebP 或 AVIF 圖片" },
  "error.avatarBrowser": { en: "This browser cannot process the avatar image", "zh-CN": "当前浏览器无法处理头像图片", "zh-TW": "目前瀏覽器無法處理頭像圖片" },
  "error.attachmentEmpty": { en: "The attachment is empty", "zh-CN": "附件为空", "zh-TW": "附件是空的" },
  "error.attachmentFileTooLarge": { en: "An attachment cannot exceed 25 MiB", "zh-CN": "单个附件不能超过 25 MiB", "zh-TW": "單一附件不能超過 25 MiB" },
  "error.attachmentFormat": { en: "Only PNG, JPEG, GIF, WebP, and AVIF images are supported, and their actual file format is verified", "zh-CN": "仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片，且会校验真实文件格式", "zh-TW": "僅支援 PNG、JPEG、GIF、WebP 和 AVIF 圖片，且會驗證實際檔案格式" },
  "error.attachmentOffline": { en: "Attachment “{name}” is not cached and cannot be read while offline", "zh-CN": "附件“{name}”尚未缓存，离线时无法读取", "zh-TW": "附件「{name}」尚未快取，離線時無法讀取" },
  "error.missingAttachment": { en: "Note “{title}” is missing attachment {attachment}", "zh-CN": "笔记“{title}”缺少附件 {attachment}", "zh-TW": "筆記「{title}」缺少附件 {attachment}" },

  "api.crossOrigin": { en: "Cross-origin state change rejected", "zh-CN": "已拒绝跨来源状态变更", "zh-TW": "已拒絕跨來源狀態變更" },
  "api.authRequired": { en: "Authentication required", "zh-CN": "需要登录", "zh-TW": "需要登入" },
  "api.sessionInvalid": { en: "Session is no longer valid", "zh-CN": "登录会话已失效", "zh-TW": "登入工作階段已失效" },
  "api.adminRequired": { en: "Administrator access required", "zh-CN": "需要管理员权限", "zh-TW": "需要管理員權限" },
  "api.invalidRegistration": { en: "Invalid registration data", "zh-CN": "注册资料无效", "zh-TW": "註冊資料無效" },
  "api.registrationClosed": { en: "Registration is closed", "zh-CN": "注册已关闭", "zh-TW": "註冊已關閉" },
  "api.usernameReserved": { en: "Username is reserved for account activation", "zh-CN": "该用户名已预留给账户激活", "zh-TW": "該使用者名稱已保留給帳戶啟用" },
  "api.usernameUnavailable": { en: "Username is unavailable", "zh-CN": "用户名不可用", "zh-TW": "使用者名稱不可用" },
  "api.invalidActivation": { en: "Invalid account activation", "zh-CN": "账户激活资料无效", "zh-TW": "帳戶啟用資料無效" },
  "api.activationInvalid": { en: "Activation code is invalid or expired", "zh-CN": "激活码无效或已过期", "zh-TW": "啟用碼無效或已過期" },
  "api.accountNotFound": { en: "Account not found", "zh-CN": "未找到账户", "zh-TW": "找不到帳戶" },
  "api.invalidCredentials": { en: "Invalid credentials", "zh-CN": "用户名或密码不正确", "zh-TW": "使用者名稱或密碼不正確" },
  "api.invalidRecovery": { en: "Invalid recovery request", "zh-CN": "密码恢复请求无效", "zh-TW": "密碼復原請求無效" },
  "api.recoveryFailed": { en: "Recovery failed", "zh-CN": "密码恢复失败", "zh-TW": "密碼復原失敗" },
  "api.invalidPasswordChange": { en: "Invalid password change", "zh-CN": "密码修改请求无效", "zh-TW": "密碼變更請求無效" },
  "api.currentPasswordIncorrect": { en: "Current password is incorrect", "zh-CN": "当前密码不正确", "zh-TW": "目前密碼不正確" },
  "api.invalidRecoveryReset": { en: "Invalid recovery key reset", "zh-CN": "恢复密钥重置请求无效", "zh-TW": "復原金鑰重設請求無效" },
  "api.invalidUsernameChange": { en: "Invalid username change", "zh-CN": "用户名修改请求无效", "zh-TW": "使用者名稱變更請求無效" },
  "api.recoveryKeyIncorrect": { en: "Recovery key is incorrect", "zh-CN": "恢复密钥不正确", "zh-TW": "復原金鑰不正確" },
  "api.usernameUnchanged": { en: "Username is unchanged", "zh-CN": "用户名没有变化", "zh-TW": "使用者名稱沒有變更" },
  "api.invalidProfile": { en: "Invalid profile", "zh-CN": "个人资料无效", "zh-TW": "個人資料無效" },
  "api.invalidAvatar": { en: "Invalid encrypted avatar", "zh-CN": "加密头像无效", "zh-TW": "加密頭像無效" },
  "api.invalidTrashRetention": { en: "Invalid trash retention", "zh-CN": "回收站保留设置无效", "zh-TW": "垃圾桶保留設定無效" },
  "api.invalidHistorySettings": { en: "Invalid note history settings", "zh-CN": "笔记历史设置无效", "zh-TW": "筆記歷史設定無效" },
  "api.invalidHistoryRequest": { en: "Invalid note history request", "zh-CN": "笔记历史请求无效", "zh-TW": "筆記歷史請求無效" },
  "api.invalidEncryptedHistory": { en: "Invalid encrypted note history", "zh-CN": "加密笔记历史无效", "zh-TW": "加密筆記歷史無效" },
  "api.noteNotFound": { en: "Note not found", "zh-CN": "未找到笔记", "zh-TW": "找不到筆記" },
  "api.historyNotFound": { en: "History snapshot not found", "zh-CN": "未找到历史版本", "zh-TW": "找不到歷史版本" },
  "api.historyCleared": { en: "History snapshot was cleared", "zh-CN": "历史版本已被清除", "zh-TW": "歷史版本已被清除" },
  "api.historyExists": { en: "History snapshot already exists", "zh-CN": "历史版本已存在", "zh-TW": "歷史版本已存在" },
  "api.historyQuota": { en: "Note history quota exceeded", "zh-CN": "笔记历史配额已用尽", "zh-TW": "筆記歷史配額已用盡" },
  "api.endpointNotFound": { en: "Endpoint not found", "zh-CN": "未找到设备", "zh-TW": "找不到裝置" },
  "api.endpointTooNew": { en: "Current endpoint must be at least 24 hours old", "zh-CN": "当前设备登录满 24 小时后才能执行此操作", "zh-TW": "目前裝置登入滿 24 小時後才能執行此操作" },
  "api.logoutCurrentEndpoint": { en: "Use logout to end the current endpoint", "zh-CN": "请使用登出结束当前设备会话", "zh-TW": "請使用登出結束目前裝置工作階段" },
  "api.endpointAlreadySignedOut": { en: "Endpoint is already signed out", "zh-CN": "该设备已经登出", "zh-TW": "該裝置已經登出" },
  "api.invalidSyncEvent": { en: "Invalid synchronization event request", "zh-CN": "同步事件请求无效", "zh-TW": "同步事件請求無效" },
  "api.invalidEncryptedObject": { en: "Invalid encrypted object", "zh-CN": "加密对象无效", "zh-TW": "加密物件無效" },
  "api.invalidEncryptedObjectBatch": { en: "Invalid encrypted object batch", "zh-CN": "批量加密对象无效", "zh-TW": "批次加密物件無效" },
  "api.invalidPurge": { en: "Invalid purge request", "zh-CN": "永久删除请求无效", "zh-TW": "永久刪除請求無效" },
  "api.objectTypeChange": { en: "Object type cannot change", "zh-CN": "对象类型不能更改", "zh-TW": "物件類型不能變更" },
  "api.revisionConflict": { en: "Revision conflict", "zh-CN": "版本冲突", "zh-TW": "版本衝突" },
  "api.purgeConflict": { en: "Purge conflict", "zh-CN": "永久删除发生冲突", "zh-TW": "永久刪除發生衝突" },
  "api.invalidAttachmentChunk": { en: "Invalid encrypted attachment chunk", "zh-CN": "加密附件分块无效", "zh-TW": "加密附件分塊無效" },
  "api.attachmentTooLarge": { en: "Attachment chunk is too large", "zh-CN": "附件分块过大", "zh-TW": "附件分塊過大" },
  "api.attachmentExists": { en: "Attachment chunk already exists", "zh-CN": "附件分块已存在", "zh-TW": "附件分塊已存在" },
  "api.attachmentNotFound": { en: "Attachment chunk not found", "zh-CN": "未找到附件分块", "zh-TW": "找不到附件分塊" },
  "api.quotaExceeded": { en: "User storage quota exceeded", "zh-CN": "用户存储配额已用尽", "zh-TW": "使用者儲存配額已用盡" },
  "api.invalidUserSetup": { en: "Invalid user setup", "zh-CN": "用户激活资料无效", "zh-TW": "使用者啟用資料無效" },
  "api.setupNotFound": { en: "Account setup not found", "zh-CN": "未找到账户激活资料", "zh-TW": "找不到帳戶啟用資料" },
  "api.invalidUserUpdate": { en: "Invalid user update", "zh-CN": "用户更新请求无效", "zh-TW": "使用者更新請求無效" },
  "api.cannotDisableSelf": { en: "You cannot disable your own account", "zh-CN": "不能禁用自己的账户", "zh-TW": "不能停用自己的帳戶" },
  "api.userNotFound": { en: "User not found", "zh-CN": "未找到用户", "zh-TW": "找不到使用者" },
  "api.invalidUserDeletion": { en: "Invalid user deletion", "zh-CN": "用户删除请求无效", "zh-TW": "使用者刪除請求無效" },
  "api.cannotDeleteSelf": { en: "You cannot delete your own account", "zh-CN": "不能删除自己的账户", "zh-TW": "不能刪除自己的帳戶" },
  "api.usernameMismatch": { en: "Username confirmation does not match", "zh-CN": "确认用户名不匹配", "zh-TW": "確認使用者名稱不相符" },
  "api.lastAdmin": { en: "The last administrator cannot be deleted", "zh-CN": "不能删除最后一位管理员", "zh-TW": "不能刪除最後一位管理員" }
} as const;

export type MessageKey = keyof typeof messages;
export type Translate = (key: MessageKey, values?: TranslationValues) => string;

export const LANGUAGE_OPTIONS: ReadonlyArray<{ value: LanguagePreference; label: string }> = [
  { value: "system", label: "" },
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" }
];

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "system" || SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

export function detectBrowserLocale(languages?: readonly string[]): SupportedLocale {
  const candidates = languages?.length
    ? languages
    : typeof navigator !== "undefined"
      ? (navigator.languages.length ? navigator.languages : [navigator.language])
      : ["en"];
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase().replace("_", "-");
    if (normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-mo" || normalized.startsWith("zh-hant")) return "zh-TW";
    if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-sg" || normalized.startsWith("zh-hans")) return "zh-CN";
    if (normalized === "en" || normalized.startsWith("en-")) return "en";
  }
  return "en";
}

export function getLanguagePreference(): LanguagePreference {
  if (typeof localStorage === "undefined") return "system";
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguagePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function storeLanguagePreference(preference: LanguagePreference): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
  } catch {
    // Language selection remains active for this page when storage is unavailable.
  }
}

export function resolveLocale(preference: LanguagePreference, languages?: readonly string[]): SupportedLocale {
  return preference === "system" ? detectBrowserLocale(languages) : preference;
}

export function translateMessage(locale: SupportedLocale, key: MessageKey, values: TranslationValues = {}): string {
  let text: string = messages[key][locale];
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

export function translateCurrent(key: MessageKey, values?: TranslationValues): string {
  return translateMessage(resolveLocale(getLanguagePreference()), key, values);
}

const errorMessages: Record<string, MessageKey> = {
  "PIN 至少需要 4 个字符": "error.pinMin",
  "当前设备没有可用的本机解锁凭据": "error.deviceCredentialMissing",
  "不支持的自动锁定时间": "error.autoLockUnsupported",
  "无法处理头像图片": "error.avatarProcess",
  "头像原图不能超过 10 MiB": "error.avatarTooLarge",
  "请选择 PNG、JPEG、GIF、WebP 或 AVIF 图片": "error.avatarFormat",
  "当前浏览器无法处理头像图片": "error.avatarBrowser",
  "附件为空": "error.attachmentEmpty",
  "单个附件不能超过 25 MiB": "error.attachmentFileTooLarge",
  "仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片，且会校验真实文件格式": "error.attachmentFormat",
  "Cross-origin state change rejected": "api.crossOrigin",
  "Authentication required": "api.authRequired",
  "Session is no longer valid": "api.sessionInvalid",
  "Administrator access required": "api.adminRequired",
  "Invalid registration data": "api.invalidRegistration",
  "Registration is closed": "api.registrationClosed",
  "Username is reserved for account activation": "api.usernameReserved",
  "Username is unavailable": "api.usernameUnavailable",
  "Invalid account activation": "api.invalidActivation",
  "Activation code is invalid or expired": "api.activationInvalid",
  "Account not found": "api.accountNotFound",
  "Invalid credentials": "api.invalidCredentials",
  "Invalid recovery request": "api.invalidRecovery",
  "Recovery failed": "api.recoveryFailed",
  "Invalid password change": "api.invalidPasswordChange",
  "Current password is incorrect": "api.currentPasswordIncorrect",
  "Invalid recovery key reset": "api.invalidRecoveryReset",
  "Invalid username change": "api.invalidUsernameChange",
  "Recovery key is incorrect": "api.recoveryKeyIncorrect",
  "Username is unchanged": "api.usernameUnchanged",
  "Invalid profile": "api.invalidProfile",
  "Invalid encrypted avatar": "api.invalidAvatar",
  "Invalid trash retention": "api.invalidTrashRetention",
  "Invalid note history settings": "api.invalidHistorySettings",
  "Invalid note history request": "api.invalidHistoryRequest",
  "Invalid encrypted note history": "api.invalidEncryptedHistory",
  "Note not found": "api.noteNotFound",
  "History snapshot not found": "api.historyNotFound",
  "History snapshot was cleared": "api.historyCleared",
  "History snapshot already exists": "api.historyExists",
  "Note history quota exceeded": "api.historyQuota",
  "Endpoint not found": "api.endpointNotFound",
  "Current endpoint must be at least 24 hours old": "api.endpointTooNew",
  "Use logout to end the current endpoint": "api.logoutCurrentEndpoint",
  "Endpoint is already signed out": "api.endpointAlreadySignedOut",
  "Invalid synchronization event request": "api.invalidSyncEvent",
  "Invalid encrypted object": "api.invalidEncryptedObject",
  "Invalid encrypted object batch": "api.invalidEncryptedObjectBatch",
  "Invalid purge request": "api.invalidPurge",
  "Object type cannot change": "api.objectTypeChange",
  "Revision conflict": "api.revisionConflict",
  "Purge conflict": "api.purgeConflict",
  "Invalid encrypted attachment chunk": "api.invalidAttachmentChunk",
  "Attachment chunk is too large": "api.attachmentTooLarge",
  "Attachment chunk already exists": "api.attachmentExists",
  "Attachment chunk not found": "api.attachmentNotFound",
  "User storage quota exceeded": "api.quotaExceeded",
  "Invalid user setup": "api.invalidUserSetup",
  "Account setup not found": "api.setupNotFound",
  "Invalid user update": "api.invalidUserUpdate",
  "You cannot disable your own account": "api.cannotDisableSelf",
  "User not found": "api.userNotFound",
  "Invalid user deletion": "api.invalidUserDeletion",
  "You cannot delete your own account": "api.cannotDeleteSelf",
  "Username confirmation does not match": "api.usernameMismatch",
  "The last administrator cannot be deleted": "api.lastAdmin"
};

export function translateError(error: unknown, t: Translate, fallback: MessageKey): string {
  if (!(error instanceof Error)) return t(fallback);
  const key = errorMessages[error.message];
  if (key) return t(key);
  const offlineAttachment = /^附件“(.+)”尚未缓存，离线时无法读取$/.exec(error.message);
  if (offlineAttachment) return t("error.attachmentOffline", { name: offlineAttachment[1] });
  const missingAttachment = /^笔记“(.+)”缺少附件 (.+)$/.exec(error.message);
  if (missingAttachment) return t("error.missingAttachment", { title: missingAttachment[1], attachment: missingAttachment[2] });
  return error.message || t(fallback);
}

interface I18nValue {
  languagePreference: LanguagePreference;
  locale: SupportedLocale;
  setLanguagePreference: (preference: LanguagePreference) => void;
  t: Translate;
  formatDateTime: (value: string | number | Date) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [languagePreference, setPreferenceState] = useState<LanguagePreference>(getLanguagePreference);
  const [browserLocale, setBrowserLocale] = useState(() => detectBrowserLocale());
  const locale = languagePreference === "system" ? browserLocale : languagePreference;

  const setLanguagePreference = useCallback((preference: LanguagePreference) => {
    setPreferenceState(preference);
    storeLanguagePreference(preference);
  }, []);

  useEffect(() => {
    const update = () => setBrowserLocale(detectBrowserLocale());
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback<Translate>((key, values) => translateMessage(locale, key, values), [locale]);
  const formatDateTime = useCallback((value: string | number | Date) => (
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  ), [locale]);

  const value = useMemo<I18nValue>(() => ({
    languagePreference,
    locale,
    setLanguagePreference,
    t,
    formatDateTime
  }), [formatDateTime, languagePreference, locale, setLanguagePreference, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
