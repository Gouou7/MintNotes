import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Download, FileText, Folder, History as HistoryIcon, Info, KeyRound, Laptop, LogOut, RotateCcw, Settings2, Shield, ShieldCheck, Trash2, Upload, UserRound, X } from "lucide-react";
import packageMetadata from "../../package.json";
import { api } from "../api";
import { AppIcon } from "../components/AppIcon";
import { LanguageSelect } from "../components/LanguageSelect";
import type { ToastTone } from "../components/Toast";
import { cryptoClient, type EncryptedProfileAvatar } from "../crypto/client";
import { getDeviceUnlock, hasDevicePin, removeDevicePin, setAutoLockMinutes, setDevicePin } from "../crypto/deviceUnlock";
import { translateError, useI18n } from "../i18n";
import type { DeviceUnlockCredential } from "../storage/database";
import type { AuthEndpoint, HistorySettings, KdfParams, OpenDocument, TrustedEndpointsResponse, UiPreferences, User } from "../types";
import { compareDocuments } from "./tree";
import { submitFormOnEnter } from "./formKeyboard";
import { AdminPanel } from "./AdminPanel";
import { prepareProfileAvatar } from "./profileAvatar";
import { formatHistoryBytes } from "./history";

type Tab = "general" | "history" | "trash" | "security" | "data" | "about" | "users";

interface Props {
  user: User;
  endpoint: AuthEndpoint;
  credential: DeviceUnlockCredential | null;
  onCredentialChange: (credential: DeviceUnlockCredential | null) => void;
  preferences: UiPreferences;
  onPreferences: (preferences: UiPreferences) => void;
  onClose: () => void;
  onLogout: () => Promise<void>;
  onImport: (files: File[]) => Promise<void>;
  onExport: () => Promise<void>;
  onDisplayName: (displayName: string) => void;
  avatarUrl: string | null;
  onAvatarChange: (avatar: { mime: string; data: ArrayBuffer } | null) => void;
  trashItems: OpenDocument[];
  purging: boolean;
  onRestoreTrash: (objectId: string) => Promise<void>;
  onPurgeTrash: (objectId: string) => void;
  onClearTrash: () => void;
  historySettings: HistorySettings;
  onHistorySettings: (settings: HistorySettings) => void;
  onRefreshHistorySettings: () => Promise<HistorySettings>;
  onClearHistory: () => Promise<void>;
  onNotify: (text: string, tone: ToastTone) => void;
}

function downloadRecoveryKey(username: string, code: string) {
  const url = URL.createObjectURL(new Blob([
    `Mint Notes recovery key for @${username}\n\n${code}\n\nStore this file in a secure location.\n`
  ], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mint-notes-recovery-key-${username}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function TrashBranch({ item, items, sortMode, root, restoring, purging, onRestore, onPurge }: {
  item: OpenDocument;
  items: OpenDocument[];
  sortMode: UiPreferences["sortMode"];
  root: boolean;
  restoring: string;
  purging: boolean;
  onRestore: (item: OpenDocument) => void;
  onPurge: (objectId: string) => void;
}): ReactNode {
  const { formatDateTime, t } = useI18n();
  const children = items.filter((entry) => entry.parentId === item.objectId).sort(compareDocuments(sortMode));
  return <div className="trash-node" role="treeitem">
    <div className="trash-row">
      <span className="trash-item-icon"><AppIcon icon={item.kind === "folder" ? Folder : FileText} size={18} /></span>
      <span className="trash-details"><strong>{item.title || t("settings.untitled")}</strong><small>{item.kind === "folder" ? t("settings.folder") : t("settings.note")} · {t("settings.deletedAt", { date: formatDateTime(item.updatedAt) })}</small></span>
      {root && <span className="trash-actions"><button disabled={restoring === item.objectId || purging} onClick={() => onRestore(item)} title={t("settings.restore")} aria-label={t("settings.restoreItem", { title: item.title })}><AppIcon icon={RotateCcw} size={16} /></button><button className="danger" disabled={purging} onClick={() => onPurge(item.objectId)} title={t("settings.permanentDelete")} aria-label={t("settings.permanentDeleteItem", { title: item.title })}><AppIcon icon={Trash2} size={16} /></button></span>}
    </div>
    {!!children.length && <div className="trash-children" role="group">{children.map((child) => <TrashBranch key={child.objectId} item={child} items={items} sortMode={sortMode} root={false} restoring={restoring} purging={purging} onRestore={onRestore} onPurge={onPurge} />)}</div>}
  </div>;
}

export function SettingsPanel({ user, endpoint, credential, onCredentialChange, preferences, onPreferences, onClose, onLogout, onImport, onExport, onDisplayName, avatarUrl, onAvatarChange, trashItems, purging, onRestoreTrash, onPurgeTrash, onClearTrash, historySettings, onHistorySettings, onRefreshHistorySettings, onClearHistory, onNotify }: Props) {
  const { formatDateTime, setLanguagePreference, t } = useI18n();
  const [tab, setTab] = useState<Tab>("general");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [deviceEndpoints, setDeviceEndpoints] = useState<TrustedEndpointsResponse | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState("");
  const [trashRetentionDays, setTrashRetentionDays] = useState<number | null>(30);
  const [pinPassword, setPinPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [autoLock, setAutoLock] = useState(credential?.autoLockMinutes ?? 0);
  const [restoringTrashId, setRestoringTrashId] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [newRecoveryKey, setNewRecoveryKey] = useState("");
  const [logoutConfirming, setLogoutConfirming] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  const loadDeviceSessions = async () => {
    setSessionsLoading(true);
    try { setDeviceEndpoints(await api<TrustedEndpointsResponse>("/api/account/endpoints")); }
    catch (value) { onNotify(translateError(value, t, "notice.loadDevicesFailed"), "warning"); }
    finally { setSessionsLoading(false); }
  };

  useEffect(() => { if (tab === "security") void loadDeviceSessions(); }, [tab]);
  useEffect(() => {
    if (tab !== "history") return;
    void onRefreshHistorySettings().catch((value) => {
      onNotify(translateError(value, t, "notice.historySettingsLoadFailed"), "warning");
    });
  }, [tab]);
  useEffect(() => {
    void api<{ days: number | null }>("/api/account/trash-retention")
      .then((result) => setTrashRetentionDays(result.days))
      .catch((value) => onNotify(translateError(value, t, "notice.loadTrashRetentionFailed"), "warning"));
  }, []);

  const updateTrashRetention = async (days: number | null) => {
    const previous = trashRetentionDays;
    setTrashRetentionDays(days);
    setBusy(true);
    try {
      const result = await api<{ days: number | null }>("/api/account/trash-retention", { method: "PATCH", body: JSON.stringify({ days }) });
      setTrashRetentionDays(result.days);
      onNotify(result.days === null ? t("notice.trashForever") : t("notice.trashDeleteAfter", { count: result.days }), "info");
    } catch (value) {
      setTrashRetentionDays(previous);
      onNotify(value instanceof Error
        ? t("notice.settingRestored", { message: translateError(value, t, "notice.saveTrashFailed") })
        : t("notice.saveTrashFailed"), "warning");
    } finally { setBusy(false); }
  };

  const updateHistorySettings = async (patch: Partial<Pick<HistorySettings, "enabled" | "intervalMinutes" | "retentionDays">>) => {
    setBusy(true);
    try {
      const result = await api<HistorySettings>("/api/account/note-history-settings", {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      onHistorySettings(result);
      onNotify(t("notice.historySettingsSaved"), "info");
    } catch (value) {
      onNotify(translateError(value, t, "notice.historySettingsSaveFailed"), "warning");
    } finally {
      setBusy(false);
    }
  };

  const saveDisplayName = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ user: User }>("/api/account/profile", { method: "PATCH", body: JSON.stringify({ displayName }) });
      setDisplayName(result.user.displayName);
      onDisplayName(result.user.displayName);
      onNotify(t("notice.displayNameUpdated"), "info");
    } catch (value) { onNotify(translateError(value, t, "notice.displayNameFailed"), "warning"); }
    finally { setBusy(false); }
  };

  const uploadAvatar = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const prepared = await prepareProfileAvatar(file);
      const encrypted = await cryptoClient.encryptProfileAvatar(user.id, prepared.mime, prepared.data);
      await api("/api/account/avatar", { method: "PUT", body: JSON.stringify(encrypted) });
      onAvatarChange(await cryptoClient.decryptProfileAvatar(user.id, encrypted));
      onNotify(t("notice.avatarUpdated"), "info");
    } catch (value) { onNotify(translateError(value, t, "notice.avatarUpdateFailed"), "warning"); }
    finally { setBusy(false); }
  };

  const removeAvatar = async () => {
    setBusy(true);
    try {
      await api("/api/account/avatar", { method: "DELETE" });
      onAvatarChange(null);
      onNotify(t("notice.avatarRemoved"), "info");
    } catch (value) { onNotify(translateError(value, t, "notice.avatarRemoveFailed"), "warning"); }
    finally { setBusy(false); }
  };

  const revokeDeviceEndpoint = async (endpointId: string, deviceName: string) => {
    if (!window.confirm(t("notice.signOutDeviceConfirm", { device: deviceName }))) return;
    setRevokingSessionId(endpointId);
    try {
      await api(`/api/account/endpoints/${endpointId}`, { method: "DELETE" });
      onNotify(t("notice.deviceSignedOut", { device: deviceName }), "info");
      await loadDeviceSessions();
    } catch (value) { onNotify(translateError(value, t, "notice.deviceSignOutFailed"), "warning"); }
    finally { setRevokingSessionId(""); }
  };

  const masterPasswordSecret = async (password: string) => {
    const parameters = await api<{ kdfSalt: string; kdfParams: KdfParams }>(`/api/auth/parameters/${encodeURIComponent(user.username)}`);
    return cryptoClient.prepareLogin(password, parameters.kdfSalt, parameters.kdfParams);
  };

  const verifyMasterPassword = async () => {
    const derived = await masterPasswordSecret(pinPassword);
    try { await api("/api/auth/reauth", { method: "POST", body: JSON.stringify({ authSecret: derived.authSecret }) }); }
    finally { await cryptoClient.discardPendingLogin(); }
  };

  const savePin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await verifyMasterPassword();
      await setDevicePin(user.id, endpoint.id, newPin);
      onCredentialChange(await getDeviceUnlock(user.id, endpoint.id) ?? null);
      setPinPassword("");
      setNewPin("");
      onNotify(t("notice.pinSaved"), "info");
    } catch (value) {
      onNotify(translateError(value, t, "notice.pinSaveFailed"), "warning");
    } finally { setBusy(false); }
  };

  const removePin = async () => {
    setBusy(true);
    try {
      if (!pinPassword) throw new Error(t("notice.enterPasswordBeforeRemovePin"));
      await verifyMasterPassword();
      await setAutoLockMinutes(user.id, endpoint.id, 0);
      await removeDevicePin(user.id, endpoint.id);
      onCredentialChange(await getDeviceUnlock(user.id, endpoint.id) ?? null);
      setAutoLock(0);
      setPinPassword("");
      setNewPin("");
      onNotify(t("notice.pinRemoved"), "info");
    } catch (value) { onNotify(translateError(value, t, "notice.pinRemoveFailed"), "warning"); }
    finally { setBusy(false); }
  };

  const updateAutoLock = async (minutes: number) => {
    if (minutes > 0 && !hasDevicePin(credential)) {
      onNotify(t("notice.setPinFirst"), "warning");
      return;
    }
    const previous = autoLock;
    setAutoLock(minutes);
    setBusy(true);
    try {
      await setAutoLockMinutes(user.id, endpoint.id, minutes);
      onCredentialChange(await getDeviceUnlock(user.id, endpoint.id) ?? null);
      onNotify(minutes ? t("notice.autoLockEnabled", { count: minutes }) : t("notice.autoLockDisabled"), "info");
    } catch (value) {
      setAutoLock(previous);
      onNotify(translateError(value, t, "notice.autoLockSaveFailed"), "warning");
    } finally { setBusy(false); }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 10) return onNotify(t("auth.newPasswordMin"), "warning");
    if (newPassword !== confirmPassword) return onNotify(t("auth.newPasswordMismatch"), "warning");
    setBusy(true);
    try {
      const parameters = await api<{ kdfSalt: string; kdfParams: KdfParams }>(`/api/auth/parameters/${encodeURIComponent(user.username)}`);
      const current = await cryptoClient.prepareLogin(currentPassword, parameters.kdfSalt, parameters.kdfParams);
      const next = await cryptoClient.rewrapPassword(user.username, newPassword);
      await api("/api/auth/password", { method: "POST", body: JSON.stringify({ currentAuthSecret: current.authSecret, newAuthSecret: next.authSecret, newKdfSalt: next.kdfSalt, newKdfParams: next.kdfParams, newWrappedVaultKey: next.wrappedVaultKey, newWrappedVaultNonce: next.wrappedVaultNonce }) });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      onNotify(t("notice.passwordChanged"), "info");
      await loadDeviceSessions();
    } catch (value) { onNotify(translateError(value, t, "notice.passwordChangeFailed"), "warning"); }
    finally { await cryptoClient.discardPendingLogin().catch(() => undefined); setBusy(false); }
  };

  const resetRecoveryKey = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const current = await masterPasswordSecret(recoveryPassword);
      const recovery = await cryptoClient.rotateRecoveryKey(user.username);
      await api("/api/account/recovery-key", { method: "POST", body: JSON.stringify({ currentAuthSecret: current.authSecret, recoveryAuthSecret: recovery.recoveryAuthSecret, recoveryWrappedVaultKey: recovery.recoveryWrappedVaultKey, recoveryWrappedVaultNonce: recovery.recoveryWrappedVaultNonce }) });
      setRecoveryPassword("");
      setNewRecoveryKey(recovery.recoveryCode);
      onNotify(t("notice.recoveryReset"), "info");
    } catch (value) { onNotify(translateError(value, t, "notice.recoveryResetFailed"), "warning"); }
    finally { await cryptoClient.discardPendingLogin().catch(() => undefined); setBusy(false); }
  };

  const importSelected = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try { await onImport(Array.from(files)); } finally { setBusy(false); }
  };

  const restoreTrashItem = async (item: OpenDocument) => {
    setRestoringTrashId(item.objectId);
    try {
      await onRestoreTrash(item.objectId);
      onNotify(t("notice.itemRestored", { title: item.title }), "info");
    } catch (value) {
      onNotify(value instanceof Error ? translateError(value, t, "notice.itemRestoreFailed") : t("notice.itemRestoreFailed", { title: item.title }), "warning");
    }
    finally { setRestoringTrashId(""); }
  };

  const trashIds = new Set(trashItems.map((item) => item.objectId));
  const trashRoots = trashItems.filter((item) => !item.parentId || !trashIds.has(item.parentId)).sort(compareDocuments(preferences.sortMode));
  const changeTab = (next: Tab) => setTab(next);

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("settings.title")}>
    <section className="modal settings-modal">
      <header><h2>{t("settings.title")}</h2><button onClick={onClose} aria-label={t("settings.close")}><AppIcon icon={X} /></button></header>
      <div className="settings-layout">
        <nav className="settings-tabs">
          <button className={tab === "general" ? "active" : ""} onClick={() => changeTab("general")}><AppIcon icon={Settings2} size={16} />{t("settings.general")}</button>
          <button className={tab === "security" ? "active" : ""} onClick={() => changeTab("security")}><AppIcon icon={Shield} size={16} />{t("settings.security")}</button>
          <button className={tab === "history" ? "active" : ""} onClick={() => changeTab("history")}><AppIcon icon={HistoryIcon} size={16} />{t("settings.history")}</button>
          <button className={tab === "trash" ? "active" : ""} onClick={() => changeTab("trash")}><AppIcon icon={Trash2} size={16} />{t("settings.trash")}</button>
          <button className={tab === "data" ? "active" : ""} onClick={() => changeTab("data")}><AppIcon icon={ArrowLeftRight} size={16} />{t("settings.data")}</button>
          <button className={tab === "about" ? "active" : ""} onClick={() => changeTab("about")}><AppIcon icon={Info} size={16} />{t("settings.about")}</button>
          {user.role === "admin" && <button className={`admin-tab ${tab === "users" ? "active" : ""}`} onClick={() => changeTab("users")}><AppIcon icon={ShieldCheck} size={16} />{t("settings.admin")}</button>}
        </nav>
        <div className="settings-content">
          {tab === "general" && <div className="settings-section">
            <h3>{t("settings.profile")}</h3>
            <div className="profile-avatar-row"><span className="profile-avatar">{avatarUrl ? <img src={avatarUrl} alt={t("settings.currentAvatar")} /> : <AppIcon icon={UserRound} size={28} />}</span><strong>{t("settings.avatar")}</strong><input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" hidden onChange={(event) => { void uploadAvatar(event.target.files); event.target.value = ""; }} /><div className="settings-actions"><button disabled={busy} onClick={() => avatarInput.current?.click()}><AppIcon icon={Upload} size={15} />{avatarUrl ? t("common.replace") : t("common.upload")}</button>{avatarUrl && <button disabled={busy} onClick={() => void removeAvatar()}>{t("common.remove")}</button>}</div></div>
            <form className="settings-control-row" onSubmit={saveDisplayName}><label>{t("auth.displayName")}<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label><button className="primary compact" disabled={busy}>{t("common.save")}</button></form>
            <h3>{t("settings.appearance")}</h3>
            <label className="settings-control-row"><span>{t("language.label")}</span><LanguageSelect value={preferences.language} onChange={(language) => { setLanguagePreference(language); onPreferences({ ...preferences, language }); }} /></label>
            <label className="settings-control-row"><span>{t("settings.theme")}</span><select value={preferences.theme} onChange={(event) => onPreferences({ ...preferences, theme: event.target.value as UiPreferences["theme"] })}><option value="system">{t("settings.themeSystem")}</option><option value="light">{t("settings.themeLight")}</option><option value="dark">{t("settings.themeDark")}</option></select></label>
            <label className="settings-control-row"><span>{t("settings.fontSize")}</span><select value={preferences.fontSize} onChange={(event) => onPreferences({ ...preferences, fontSize: event.target.value as UiPreferences["fontSize"] })}><option value="small">{t("settings.fontSmall")}</option><option value="standard">{t("settings.fontStandard")}</option><option value="large">{t("settings.fontLarge")}</option></select></label>
          </div>}

          {tab === "trash" && <div className="settings-section trash-settings">
            <h3>{t("settings.trash")}</h3><p className="settings-help">{t("settings.trashHelp")}</p>
            <label className="settings-control-row"><span>{t("settings.autoDelete")}</span><select disabled={busy} value={trashRetentionDays === null ? "never" : String(trashRetentionDays)} onChange={(event) => void updateTrashRetention(event.target.value === "never" ? null : Number(event.target.value))}>{[7, 30, 90, 180, 365].map((days) => <option key={days} value={days}>{t(days === 30 ? "settings.daysDefault" : "settings.days", { count: days })}</option>)}<option value="never">{t("settings.keepForever")}</option></select></label>
            <div className="trash-heading"><h3>{t("settings.deletedItems")}</h3>{trashItems.length > 0 && <button className="trash-clear" disabled={purging} onClick={onClearTrash}><AppIcon icon={Trash2} size={15} />{purging ? t("settings.clearingTrash") : t("settings.clearTrash")}</button>}</div>
            {trashRoots.length ? <div className="trash-list" role="tree">{trashRoots.map((item) => <TrashBranch key={item.objectId} item={item} items={trashItems} sortMode={preferences.sortMode} root restoring={restoringTrashId} purging={purging} onRestore={(entry) => void restoreTrashItem(entry)} onPurge={onPurgeTrash} />)}</div> : <p className="trash-empty">{t("settings.trashEmpty")}</p>}
          </div>}

          {tab === "history" && <div className="settings-section history-settings">
            <h3>{t("settings.history")}</h3>
            <p className="settings-help">{t("settings.historyHelp")}</p>
            <label className="settings-control-row">
              <span>{t("settings.historyAutomatic")}</span>
              <span className="settings-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={t("settings.historyAutomatic")}
                  disabled={busy}
                  checked={historySettings.enabled}
                  onChange={(event) => void updateHistorySettings({ enabled: event.target.checked })}
                />
                <span className="settings-switch-track" aria-hidden="true" />
              </span>
            </label>
            <label className="settings-control-row"><span>{t("settings.historyFrequency")}</span><select disabled={busy || !historySettings.enabled} value={historySettings.intervalMinutes} onChange={(event) => void updateHistorySettings({ intervalMinutes: Number(event.target.value) as HistorySettings["intervalMinutes"] })}>{[5, 10, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{t("settings.minutes", { count: minutes })}</option>)}</select></label>
            <label className="settings-control-row"><span>{t("settings.historyRetention")}</span><select disabled={busy} value={historySettings.retentionDays === null ? "never" : historySettings.retentionDays} onChange={(event) => void updateHistorySettings({ retentionDays: event.target.value === "never" ? null : Number(event.target.value) as HistorySettings["retentionDays"] })}>{[7, 30, 90, 180, 365].map((days) => <option key={days} value={days}>{t(days === 90 ? "settings.daysDefault" : "settings.days", { count: days })}</option>)}<option value="never">{t("settings.keepForever")}</option></select></label>
            <p className="settings-help">{t("settings.historyTiered")}</p>
            <div className="history-usage">
              <span><strong>{t("settings.historyStorage")}</strong><small>{t("settings.historyVersionCount", { count: historySettings.count })}</small></span>
              <span>{formatHistoryBytes(historySettings.usedBytes)} / {formatHistoryBytes(historySettings.quotaBytes)}</span>
              <progress max={historySettings.quotaBytes} value={Math.min(historySettings.usedBytes, historySettings.quotaBytes)} />
            </div>
            <div className="settings-actions"><button className="danger" disabled={busy || historySettings.count === 0} onClick={() => void onClearHistory()}><AppIcon icon={Trash2} size={15} />{t("settings.historyClearAll")}</button></div>
          </div>}

          {tab === "security" && <div className="settings-section">
            <h3>{t("settings.setPin")}</h3><p className="settings-help">{t("settings.pinHelp")}</p>
            <form className="compact-form" onSubmit={savePin}><label>{t("auth.masterPassword")}<input type="password" autoComplete="current-password" value={pinPassword} onChange={(event) => setPinPassword(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="next" required /></label><label>{hasDevicePin(credential) ? t("settings.newPin") : t("settings.setPin")}<input type="password" minLength={4} value={newPin} onChange={(event) => setNewPin(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="done" placeholder={t("settings.pinMin")} required /></label><div className="settings-actions"><button type="submit" className="primary compact" disabled={busy}>{hasDevicePin(credential) ? t("settings.changePin") : t("settings.setPin")}</button>{hasDevicePin(credential) && <button type="button" disabled={busy} onClick={() => void removePin()}>{t("settings.removePin")}</button>}</div></form>
            <h3>{t("settings.autoLock")}</h3><p className="settings-help">{t("settings.autoLockHelp")}</p>
            <label className="settings-control-row"><span>{t("settings.autoLockAfter")}</span><select disabled={busy} value={autoLock} onChange={(event) => void updateAutoLock(Number(event.target.value))}><option value="0">{t("settings.offDefault")}</option>{[1, 2, 5, 10, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{t(minutes === 1 ? "settings.minute" : "settings.minutes", { count: minutes })}</option>)}</select></label>
            <h3>{t("settings.loginDevices")}</h3><p className="settings-help">{t("settings.loginDevicesHelp")}</p>
            {sessionsLoading && !deviceEndpoints && <p className="settings-help">{t("settings.loadingDevices")}</p>}
            {deviceEndpoints && <>{!deviceEndpoints.canRevokeOthers && <p className="session-gate">{t("settings.revokeAfter", { date: formatDateTime(deviceEndpoints.revokeEligibleAt) })}</p>}<div className="session-list">{deviceEndpoints.endpoints.map((device) => <article className={`session-row ${device.current ? "current" : ""}`} key={device.id}><span className="session-device-icon"><AppIcon icon={Laptop} /></span><span className="session-details"><strong>{device.deviceName}{device.current && <em>{t("settings.currentDevice")}</em>}{device.remembered && <em>{t("settings.remembered")}</em>}</strong><span>{t("settings.lastOnline", { date: formatDateTime(device.lastSeenAt) })}</span><small>{t("settings.deviceDetails", { first: formatDateTime(device.firstSeenAt), last: formatDateTime(device.lastLoginAt), count: device.loginCount, ip: device.ipAddress || t("common.unknown"), status: device.active ? t("settings.deviceActive") : device.revokedAt ? t("settings.deviceSignedOut") : t("settings.deviceExpired") })}</small></span>{!device.current && device.active && <button className="session-revoke" disabled={!deviceEndpoints.canRevokeOthers || revokingSessionId === device.id} onClick={() => void revokeDeviceEndpoint(device.id, device.deviceName)}><AppIcon icon={LogOut} size={15} />{t("settings.signOut")}</button>}</article>)}</div></>}
            <h3>{t("settings.changePassword")}</h3><p className="settings-help">{t("settings.changePasswordHelp")}</p>
            <form className="compact-form" onSubmit={changePassword}><label>{t("auth.currentPassword")}<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="next" required /></label><label>{t("auth.newMasterPassword")}<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="next" required /></label><label>{t("auth.confirmNewPassword")}<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="done" required /></label><button type="submit" className="primary compact" disabled={busy}>{t("settings.changePassword")}</button></form>
            <h3>{t("auth.recoveryKey")}</h3><p className="settings-help">{t("settings.recoveryHelp")}</p>
            {!newRecoveryKey ? <form className="settings-control-row" onSubmit={resetRecoveryKey}><label>{t("auth.currentPassword")}<input type="password" autoComplete="current-password" value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} required /></label><button className="compact" disabled={busy}><AppIcon icon={KeyRound} size={15} />{t("settings.resetRecovery")}</button></form> : <div className="recovery-result"><strong>{t("settings.recoveryShownOnce")}</strong><textarea readOnly rows={3} value={newRecoveryKey} /><div className="settings-actions"><button onClick={() => void navigator.clipboard.writeText(newRecoveryKey)}>{t("common.copy")}</button><button onClick={() => downloadRecoveryKey(user.username, newRecoveryKey)}><AppIcon icon={Download} size={15} />{t("common.download")}</button><button className="primary" onClick={() => setNewRecoveryKey("")}>{t("settings.savedRecovery")}</button></div></div>}
          </div>}

          {tab === "data" && <div className="settings-section"><h3>{t("settings.portableData")}</h3><p className="settings-help">{t("settings.portableHelp")}</p><input ref={fileInput} type="file" accept=".md,.markdown,.txt,.zip" multiple hidden onChange={(event) => { void importSelected(event.target.files); event.target.value = ""; }} /><div className="settings-actions"><button disabled={busy} onClick={() => fileInput.current?.click()}>{t("settings.import")}</button><button disabled={busy} onClick={() => void onExport()}>{t("settings.export")}</button></div></div>}
          {tab === "about" && <div className="settings-section about-settings">
            <div className="about-product">
              <h3>Mint Notes</h3>
              <p>{t("settings.version")} {packageMetadata.displayVersion}</p>
            </div>
            <div className="about-introduction">
              <p>{t("settings.aboutDescription")}</p>
              <p className="about-feedback">{t("settings.aboutFeedback")}</p>
            </div>
            <h3>{t("settings.acknowledgements")}</h3>
            <p className="settings-help">{t("settings.aboutHelp")}</p>
            <ul className="about-credits">
              <li><a href="https://github.com/Yuyz0112/typora-web" target="_blank" rel="noreferrer">typora-web</a><span>{t("settings.markdownEditor")}</span></li>
              <li><a href="https://lucide.dev" target="_blank" rel="noreferrer">Lucide React</a><span>{t("settings.iconLibrary")}</span></li>
            </ul>
          </div>}
          {tab === "users" && user.role === "admin" && <div className="admin-settings"><AdminPanel currentUser={user} onNotify={onNotify} /></div>}
          <div className="settings-logout-section">
            <button type="button" className="settings-logout" onClick={() => setLogoutConfirming(true)}><AppIcon icon={LogOut} size={16} />{t("app.logout")}</button>
          </div>
        </div>
      </div>
      {logoutConfirming && <div className="danger-confirm logout-confirm settings-section" role="dialog" aria-modal="true" aria-label={t("settings.logoutTitle")}><header><h3>{t("settings.logoutTitle")}</h3><button type="button" onClick={() => setLogoutConfirming(false)} aria-label={t("common.close")}><AppIcon icon={X} /></button></header><p>{t("settings.logoutWarning")}</p><div className="settings-actions"><button type="button" onClick={() => setLogoutConfirming(false)}>{t("common.cancel")}</button><button type="button" className="danger danger-solid" onClick={() => void onLogout()}><AppIcon icon={LogOut} size={15} />{t("app.logout")}</button></div></div>}
    </section>
  </div>;
}
