import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Download, FileText, Folder, History as HistoryIcon, Info, KeyRound, Laptop, LogOut, Pencil, RotateCcw, Settings2, Shield, ShieldCheck, Trash2, Upload, UserRound, X } from "lucide-react";
import { api } from "../api";
import { AppIcon } from "../components/AppIcon";
import { LanguageSelect } from "../components/LanguageSelect";
import type { ToastTone } from "../components/Toast";
import { createVaultEnvelopeBinding, cryptoClient, type EncryptedProfileAvatar } from "../crypto/client";
import { getDeviceUnlock, hasDevicePin, removeDevicePin, setAutoLockMinutes, setDevicePin } from "../crypto/deviceUnlock";
import { translateError, useI18n } from "../i18n";
import type { DeviceUnlockCredential } from "../storage/database";
import type { AuthEndpoint, AuthParameters, HistorySettings, OpenDocument, TrustedEndpointsResponse, UiPreferences, User, VaultEnvelopeBinding } from "../types";
import { compareDocuments } from "./tree";
import { submitFormOnEnter } from "./formKeyboard";
import { AdminPanel } from "./AdminPanel";
import { prepareProfileAvatar } from "./profileAvatar";
import { formatHistoryBytes } from "./history";
import { downloadRecoveryKey } from "./recoveryKey";
import { APP_VERSION } from "../version";
import { DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE } from "./appearance";

type Tab = "general" | "history" | "trash" | "security" | "data" | "about" | "users";
type PinDialogMode = "save" | "remove";
type AccountCredentialDialogMode = "password" | "recovery";

interface PendingUsernameRecoveryReset {
  binding: VaultEnvelopeBinding;
  recoveryAuthSecret: string;
  recoveryWrappedVaultKey: string;
  recoveryWrappedVaultNonce: string;
  recoveryCode: string;
}

interface Props {
  user: User;
  endpoint: AuthEndpoint;
  credential: DeviceUnlockCredential | null;
  serverSessionVerified: boolean;
  onCredentialChange: (credential: DeviceUnlockCredential | null) => void;
  preferences: UiPreferences;
  onPreferences: (preferences: UiPreferences) => void;
  onClose: () => void;
  onLogout: () => Promise<void>;
  onImport: (files: File[]) => Promise<void>;
  onExport: () => Promise<void>;
  onDisplayName: (displayName: string) => void;
  onUsername: (username: string) => void;
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

export function SettingsPanel({ user, endpoint, credential, serverSessionVerified, onCredentialChange, preferences, onPreferences, onClose, onLogout, onImport, onExport, onDisplayName, onUsername, avatarUrl, onAvatarChange, trashItems, purging, onRestoreTrash, onPurgeTrash, onClearHistory, onClearTrash, historySettings, onHistorySettings, onRefreshHistorySettings, onNotify }: Props) {
  const { formatDateTime, setLanguagePreference, t } = useI18n();
  const [tab, setTab] = useState<Tab>("general");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [usernamePassword, setUsernamePassword] = useState("");
  const [usernameRecoveryKey, setUsernameRecoveryKey] = useState("");
  const [usernameDialogOpen, setUsernameDialogOpen] = useState(false);
  const [pendingUsernameRecoveryReset, setPendingUsernameRecoveryReset] = useState<PendingUsernameRecoveryReset | null>(null);
  const [usernameRecoveryConfirmed, setUsernameRecoveryConfirmed] = useState(false);
  const [deviceEndpoints, setDeviceEndpoints] = useState<TrustedEndpointsResponse | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState("");
  const [trashRetentionDays, setTrashRetentionDays] = useState<number | null>(30);
  const [pinPassword, setPinPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinDialogMode, setPinDialogMode] = useState<PinDialogMode | null>(null);
  const [autoLock, setAutoLock] = useState(credential?.autoLockMinutes ?? 0);
  const [restoringTrashId, setRestoringTrashId] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [newRecoveryKey, setNewRecoveryKey] = useState("");
  const [accountCredentialDialogMode, setAccountCredentialDialogMode] = useState<AccountCredentialDialogMode | null>(null);
  const [logoutConfirming, setLogoutConfirming] = useState(false);
  const [fontSizeInput, setFontSizeInput] = useState(String(preferences.fontSize));
  const fileInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  useEffect(() => setFontSizeInput(String(preferences.fontSize)), [preferences.fontSize]);

  const updateFontSizeInput = (value: string) => {
    setFontSizeInput(value);
    const fontSize = Number(value);
    if (Number.isInteger(fontSize) && fontSize >= MIN_FONT_SIZE && fontSize <= MAX_FONT_SIZE) {
      onPreferences({ ...preferences, fontSize });
    }
  };

  const restoreDefaultFontSize = () => {
    setFontSizeInput(String(DEFAULT_FONT_SIZE));
    onPreferences({ ...preferences, fontSize: DEFAULT_FONT_SIZE });
  };
  const requireServerSession = () => {
    if (serverSessionVerified) return true;
    onNotify(t("notice.onlineSessionRequired"), "warning");
    return false;
  };

  const loadDeviceSessions = async () => {
    if (!requireServerSession()) return;
    setSessionsLoading(true);
    try { setDeviceEndpoints(await api<TrustedEndpointsResponse>("/api/account/endpoints")); }
    catch (value) { onNotify(translateError(value, t, "notice.loadDevicesFailed"), "warning"); }
    finally { setSessionsLoading(false); }
  };

  useEffect(() => { if (tab === "security" && serverSessionVerified) void loadDeviceSessions(); }, [serverSessionVerified, tab]);
  useEffect(() => {
    if (tab !== "history" || !serverSessionVerified) return;
    void onRefreshHistorySettings().catch((value) => {
      onNotify(translateError(value, t, "notice.historySettingsLoadFailed"), "warning");
    });
  }, [serverSessionVerified, tab]);
  useEffect(() => {
    if (!serverSessionVerified) return;
    void api<{ days: number | null }>("/api/account/trash-retention")
      .then((result) => setTrashRetentionDays(result.days))
      .catch((value) => onNotify(translateError(value, t, "notice.loadTrashRetentionFailed"), "warning"));
  }, [serverSessionVerified]);

  const updateTrashRetention = async (days: number | null) => {
    if (!requireServerSession()) return;
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
    if (!requireServerSession()) return;
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

  const openProfileDialog = () => {
    if (!requireServerSession()) return;
    setDisplayName(user.displayName);
    setUsername(user.username);
    setProfileDialogOpen(true);
  };

  const closeProfileDialog = () => {
    setProfileDialogOpen(false);
    setDisplayName(user.displayName);
    setUsername(user.username);
  };

  const saveDisplayName = async (event: FormEvent) => {
    event.preventDefault();
    if (!requireServerSession()) return;
    if (displayName === user.displayName) return;
    setBusy(true);
    try {
      const result = await api<{ user: User }>("/api/account/profile", { method: "PATCH", body: JSON.stringify({ displayName }) });
      setDisplayName(result.user.displayName);
      onDisplayName(result.user.displayName);
      onNotify(t("notice.displayNameUpdated"), "info");
    } catch (value) { onNotify(translateError(value, t, "notice.displayNameFailed"), "warning"); }
    finally { setBusy(false); }
  };

  const normalizedUsername = () => username.trim().toLowerCase();

  const beginUsernameChange = (event: FormEvent) => {
    event.preventDefault();
    if (!requireServerSession()) return;
    if (normalizedUsername() === user.username) return;
    setProfileDialogOpen(false);
    setUsernamePassword("");
    setUsernameRecoveryKey("");
    setPendingUsernameRecoveryReset(null);
    setUsernameRecoveryConfirmed(false);
    setUsernameDialogOpen(true);
  };

  const closeUsernameDialog = () => {
    setUsernameDialogOpen(false);
    setUsernamePassword("");
    setUsernameRecoveryKey("");
    setPendingUsernameRecoveryReset(null);
    setUsernameRecoveryConfirmed(false);
    void cryptoClient.discardPendingLogin().catch(() => undefined);
  };

  const commitUsernameChange = async (body: Record<string, unknown>) => {
    const result = await api<{ user: User }>("/api/account/username", {
      method: "PATCH",
      body: JSON.stringify({ username: normalizedUsername(), ...body })
    });
    setUsername(result.user.username);
    onUsername(result.user.username);
    closeUsernameDialog();
  };

  const saveUsername = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const parameters = await api<AuthParameters>(`/api/auth/parameters/${encodeURIComponent(user.username)}`);
      const current = await cryptoClient.prepareLogin(usernamePassword, parameters.kdfSalt, parameters.kdfParams);
      const binding = parameters.envelopeBinding.version === 2
        ? parameters.envelopeBinding
        : createVaultEnvelopeBinding();
      const wrapped = await cryptoClient.rewrapVaultEnvelopes(binding, usernameRecoveryKey);
      await commitUsernameChange({
        currentAuthSecret: current.authSecret,
        currentRecoveryAuthSecret: wrapped.recoveryAuthSecret,
        envelopeVersion: binding.version,
        envelopeContext: binding.context,
        wrappedVaultKey: wrapped.wrappedVaultKey,
        wrappedVaultNonce: wrapped.wrappedVaultNonce,
        recoveryWrappedVaultKey: wrapped.recoveryWrappedVaultKey,
        recoveryWrappedVaultNonce: wrapped.recoveryWrappedVaultNonce
      });
      onNotify(t("notice.usernameUpdated"), "info");
    } catch (value) {
      onNotify(translateError(value, t, "notice.usernameFailed"), "warning");
    } finally {
      await cryptoClient.discardPendingLogin().catch(() => undefined);
      setBusy(false);
    }
  };

  const prepareUsernameRecoveryReset = async () => {
    setBusy(true);
    try {
      const parameters = await api<AuthParameters>(`/api/auth/parameters/${encodeURIComponent(user.username)}`);
      const current = await cryptoClient.prepareLogin(usernamePassword, parameters.kdfSalt, parameters.kdfParams);
      await api("/api/auth/reauth", { method: "POST", body: JSON.stringify({ authSecret: current.authSecret }) });
      const binding = parameters.envelopeBinding.version === 2
        ? parameters.envelopeBinding
        : createVaultEnvelopeBinding();
      const recovery = await cryptoClient.rotateRecoveryKey(binding);
      setPendingUsernameRecoveryReset({ binding, ...recovery });
      setUsernameRecoveryConfirmed(false);
    } catch (value) {
      onNotify(translateError(value, t, "notice.recoveryResetFailed"), "warning");
    } finally {
      await cryptoClient.discardPendingLogin().catch(() => undefined);
      setBusy(false);
    }
  };

  const saveUsernameWithRecoveryReset = async () => {
    const pending = pendingUsernameRecoveryReset;
    if (!pending || !usernameRecoveryConfirmed) return;
    setBusy(true);
    try {
      const parameters = await api<AuthParameters>(`/api/auth/parameters/${encodeURIComponent(user.username)}`);
      const current = await cryptoClient.prepareLogin(usernamePassword, parameters.kdfSalt, parameters.kdfParams);
      const passwordWrapped = await cryptoClient.rewrapPasswordEnvelope(pending.binding);
      await commitUsernameChange({
        currentAuthSecret: current.authSecret,
        replacementRecoveryAuthSecret: pending.recoveryAuthSecret,
        envelopeVersion: pending.binding.version,
        envelopeContext: pending.binding.context,
        ...passwordWrapped,
        recoveryWrappedVaultKey: pending.recoveryWrappedVaultKey,
        recoveryWrappedVaultNonce: pending.recoveryWrappedVaultNonce
      });
      onNotify(t("notice.usernameRecoveryReset"), "info");
    } catch (value) {
      onNotify(translateError(value, t, "notice.usernameFailed"), "warning");
    } finally {
      await cryptoClient.discardPendingLogin().catch(() => undefined);
      setBusy(false);
    }
  };

  const uploadAvatar = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!requireServerSession()) return;
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
    if (!requireServerSession()) return;
    setBusy(true);
    try {
      await api("/api/account/avatar", { method: "DELETE" });
      onAvatarChange(null);
      onNotify(t("notice.avatarRemoved"), "info");
    } catch (value) { onNotify(translateError(value, t, "notice.avatarRemoveFailed"), "warning"); }
    finally { setBusy(false); }
  };

  const revokeDeviceEndpoint = async (endpointId: string, deviceName: string) => {
    if (!requireServerSession()) return;
    if (!window.confirm(t("notice.signOutDeviceConfirm", { device: deviceName }))) return;
    setRevokingSessionId(endpointId);
    try {
      await api(`/api/account/endpoints/${endpointId}`, { method: "DELETE" });
      onNotify(t("notice.deviceSignedOut", { device: deviceName }), "info");
      await loadDeviceSessions();
    } catch (value) { onNotify(translateError(value, t, "notice.deviceSignOutFailed"), "warning"); }
    finally { setRevokingSessionId(""); }
  };

  const removeDeviceEndpoint = async (endpointId: string, deviceName: string) => {
    if (!requireServerSession()) return;
    if (!window.confirm(t("notice.removeDeviceConfirm", { device: deviceName }))) return;
    setRevokingSessionId(endpointId);
    try {
      await api(`/api/account/endpoints/${endpointId}`, { method: "DELETE" });
      onNotify(t("notice.deviceRemoved", { device: deviceName }), "info");
      await loadDeviceSessions();
    } catch (value) { onNotify(translateError(value, t, "notice.deviceRemoveFailed"), "warning"); }
    finally { setRevokingSessionId(""); }
  };

  const masterPasswordSecret = async (password: string) => {
    if (!serverSessionVerified) throw new Error(t("notice.onlineSessionRequired"));
    const parameters = await api<AuthParameters>(`/api/auth/parameters/${encodeURIComponent(user.username)}`);
    return cryptoClient.prepareLogin(password, parameters.kdfSalt, parameters.kdfParams);
  };

  const verifyMasterPassword = async () => {
    const derived = await masterPasswordSecret(pinPassword);
    try { await api("/api/auth/reauth", { method: "POST", body: JSON.stringify({ authSecret: derived.authSecret }) }); }
    finally { await cryptoClient.discardPendingLogin(); }
  };

  const openPinDialog = (mode: PinDialogMode) => {
    if (!requireServerSession()) return;
    setPinPassword("");
    setNewPin("");
    setPinDialogMode(mode);
  };

  const closePinDialog = () => {
    setPinDialogMode(null);
    setPinPassword("");
    setNewPin("");
    void cryptoClient.discardPendingLogin().catch(() => undefined);
  };

  const savePin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await verifyMasterPassword();
      await setDevicePin(user.id, endpoint.id, newPin);
      onCredentialChange(await getDeviceUnlock(user.id, endpoint.id) ?? null);
      closePinDialog();
      onNotify(t("notice.pinSaved"), "info");
    } catch (value) {
      onNotify(translateError(value, t, "notice.pinSaveFailed"), "warning");
    } finally { setBusy(false); }
  };

  const removePin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await verifyMasterPassword();
      await setAutoLockMinutes(user.id, endpoint.id, 0);
      await removeDevicePin(user.id, endpoint.id);
      onCredentialChange(await getDeviceUnlock(user.id, endpoint.id) ?? null);
      setAutoLock(0);
      closePinDialog();
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

  const openAccountCredentialDialog = (mode: AccountCredentialDialogMode) => {
    if (!requireServerSession()) return;
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setRecoveryPassword("");
    setNewRecoveryKey("");
    setAccountCredentialDialogMode(mode);
  };

  const closeAccountCredentialDialog = () => {
    setAccountCredentialDialogMode(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setRecoveryPassword("");
    setNewRecoveryKey("");
    void cryptoClient.discardPendingLogin().catch(() => undefined);
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!requireServerSession()) return;
    if (newPassword.length < 10) return onNotify(t("auth.newPasswordMin"), "warning");
    if (newPassword !== confirmPassword) return onNotify(t("auth.newPasswordMismatch"), "warning");
    setBusy(true);
    try {
      const parameters = await api<AuthParameters>(`/api/auth/parameters/${encodeURIComponent(user.username)}`);
      const current = await cryptoClient.prepareLogin(currentPassword, parameters.kdfSalt, parameters.kdfParams);
      const next = await cryptoClient.rewrapPassword(parameters.envelopeBinding, newPassword);
      await api("/api/auth/password", { method: "POST", body: JSON.stringify({ currentAuthSecret: current.authSecret, newAuthSecret: next.authSecret, newKdfSalt: next.kdfSalt, newKdfParams: next.kdfParams, newWrappedVaultKey: next.wrappedVaultKey, newWrappedVaultNonce: next.wrappedVaultNonce }) });
      closeAccountCredentialDialog();
      onNotify(t("notice.passwordChanged"), "info");
      await loadDeviceSessions();
    } catch (value) { onNotify(translateError(value, t, "notice.passwordChangeFailed"), "warning"); }
    finally { await cryptoClient.discardPendingLogin().catch(() => undefined); setBusy(false); }
  };

  const resetRecoveryKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!requireServerSession()) return;
    setBusy(true);
    try {
      const current = await masterPasswordSecret(recoveryPassword);
      const parameters = await api<AuthParameters>(`/api/auth/parameters/${encodeURIComponent(user.username)}`);
      const recovery = await cryptoClient.rotateRecoveryKey(parameters.envelopeBinding);
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
      {!serverSessionVerified && <p className="auth-guidance warning">{t("settings.localOnly")}</p>}
      <div className="settings-layout">
        <nav className="settings-tabs">
          <button className={tab === "general" ? "active" : ""} onClick={() => changeTab("general")}><AppIcon icon={Settings2} size={16} />{t("settings.general")}</button>
          <button className={tab === "security" ? "active" : ""} onClick={() => changeTab("security")}><AppIcon icon={Shield} size={16} />{t("settings.security")}</button>
          <button className={tab === "history" ? "active" : ""} onClick={() => changeTab("history")}><AppIcon icon={HistoryIcon} size={16} />{t("settings.history")}</button>
          <button className={tab === "trash" ? "active" : ""} onClick={() => changeTab("trash")}><AppIcon icon={Trash2} size={16} />{t("settings.trash")}</button>
          <button className={tab === "data" ? "active" : ""} onClick={() => changeTab("data")}><AppIcon icon={ArrowLeftRight} size={16} />{t("settings.data")}</button>
          <button className={tab === "about" ? "active" : ""} onClick={() => changeTab("about")}><AppIcon icon={Info} size={16} />{t("settings.about")}</button>
          {user.role === "admin" && serverSessionVerified && <button className={`admin-tab ${tab === "users" ? "active" : ""}`} onClick={() => changeTab("users")}><AppIcon icon={ShieldCheck} size={16} />{t("settings.admin")}</button>}
        </nav>
        <div className="settings-content">
          {tab === "general" && <div className="settings-section">
            <div className="profile-summary"><span className="profile-avatar">{avatarUrl ? <img src={avatarUrl} alt={t("settings.currentAvatar")} /> : <AppIcon icon={UserRound} size={30} />}</span><span className="profile-identity"><strong>{user.displayName}</strong><small>@{user.username}</small></span><button className="primary" disabled={busy || !serverSessionVerified} onClick={openProfileDialog}><AppIcon icon={Pencil} size={15} />{t("settings.editProfile")}</button></div>
            <h3>{t("settings.appearance")}</h3>
            <label className="settings-control-row"><span>{t("language.label")}</span><LanguageSelect value={preferences.language} onChange={(language) => { setLanguagePreference(language); onPreferences({ ...preferences, language }); }} /></label>
            <label className="settings-control-row"><span>{t("settings.theme")}</span><select value={preferences.theme} onChange={(event) => onPreferences({ ...preferences, theme: event.target.value as UiPreferences["theme"] })}><option value="system">{t("settings.themeSystem")}</option><option value="light">{t("settings.themeLight")}</option><option value="dark">{t("settings.themeDark")}</option></select></label>
            <div className="settings-control-row font-size-setting">
              <span>{t("settings.fontSize")}</span>
              <div className="font-size-controls">
                <label className="font-size-input">
                  <input type="number" min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} step="1" inputMode="numeric" aria-label={t("settings.fontSizePixels")} value={fontSizeInput} onChange={(event) => updateFontSizeInput(event.target.value)} onBlur={() => setFontSizeInput(String(preferences.fontSize))} />
                  <span aria-hidden="true">px</span>
                </label>
                <button type="button" className="font-size-reset" disabled={preferences.fontSize === DEFAULT_FONT_SIZE} onClick={restoreDefaultFontSize}><AppIcon icon={RotateCcw} size={15} />{t("settings.restoreDefaultFontSize")}</button>
              </div>
            </div>
          </div>}

          {tab === "trash" && <div className="settings-section trash-settings">
            <h3>{t("settings.trash")}</h3><p className="settings-help">{t("settings.trashHelp")}</p>
            <label className="settings-control-row"><span>{t("settings.autoDelete")}</span><select disabled={busy || !serverSessionVerified} value={trashRetentionDays === null ? "never" : String(trashRetentionDays)} onChange={(event) => void updateTrashRetention(event.target.value === "never" ? null : Number(event.target.value))}>{[7, 30, 90, 180, 365].map((days) => <option key={days} value={days}>{t(days === 30 ? "settings.daysDefault" : "settings.days", { count: days })}</option>)}<option value="never">{t("settings.keepForever")}</option></select></label>
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
                  disabled={busy || !serverSessionVerified}
                  checked={historySettings.enabled}
                  onChange={(event) => void updateHistorySettings({ enabled: event.target.checked })}
                />
                <span className="settings-switch-track" aria-hidden="true" />
              </span>
            </label>
            <label className="settings-control-row"><span>{t("settings.historyFrequency")}</span><select disabled={busy || !serverSessionVerified || !historySettings.enabled} value={historySettings.intervalMinutes} onChange={(event) => void updateHistorySettings({ intervalMinutes: Number(event.target.value) as HistorySettings["intervalMinutes"] })}>{[5, 10, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{t("settings.minutes", { count: minutes })}</option>)}</select></label>
            <label className="settings-control-row"><span>{t("settings.historyRetention")}</span><select disabled={busy || !serverSessionVerified} value={historySettings.retentionDays === null ? "never" : historySettings.retentionDays} onChange={(event) => void updateHistorySettings({ retentionDays: event.target.value === "never" ? null : Number(event.target.value) as HistorySettings["retentionDays"] })}>{[7, 30, 90, 180, 365].map((days) => <option key={days} value={days}>{t(days === 90 ? "settings.daysDefault" : "settings.days", { count: days })}</option>)}<option value="never">{t("settings.keepForever")}</option></select></label>
            <p className="settings-help">{t("settings.historyTiered")}</p>
            <div className="history-usage">
              <span><strong>{t("settings.historyStorage")}</strong><small>{t("settings.historyVersionCount", { count: historySettings.count })}</small></span>
              <span>{formatHistoryBytes(historySettings.usedBytes)} / {formatHistoryBytes(historySettings.quotaBytes)}</span>
              <progress max={historySettings.quotaBytes} value={Math.min(historySettings.usedBytes, historySettings.quotaBytes)} />
            </div>
            <div className="settings-actions"><button className="danger" disabled={busy || !serverSessionVerified || historySettings.count === 0} onClick={() => void onClearHistory()}><AppIcon icon={Trash2} size={15} />{t("settings.historyClearAll")}</button></div>
          </div>}

          {tab === "security" && <div className="settings-section">
            <h3>{t("settings.devicePin")}</h3><p className="settings-help">{t(hasDevicePin(credential) ? "settings.pinConfiguredHelp" : "settings.pinHelp")}</p>
            <div className="settings-actions"><button type="button" className="primary compact" disabled={busy || !serverSessionVerified} onClick={() => openPinDialog("save")}>{hasDevicePin(credential) ? t("settings.changePin") : t("settings.setPin")}</button>{hasDevicePin(credential) && <button type="button" disabled={busy || !serverSessionVerified} onClick={() => openPinDialog("remove")}>{t("settings.removePin")}</button>}</div>
            <h3>{t("settings.autoLock")}</h3><p className="settings-help">{t("settings.autoLockHelp")}</p>
            <label className="settings-control-row"><span>{t("settings.autoLockAfter")}</span><select disabled={busy} value={autoLock} onChange={(event) => void updateAutoLock(Number(event.target.value))}><option value="0">{t("settings.offDefault")}</option>{[1, 2, 5, 10, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{t(minutes === 1 ? "settings.minute" : "settings.minutes", { count: minutes })}</option>)}</select></label>
            <h3>{t("settings.loginDevices")}</h3><p className="settings-help">{t("settings.loginDevicesHelp")}</p>
            {sessionsLoading && !deviceEndpoints && <p className="settings-help">{t("settings.loadingDevices")}</p>}
            {deviceEndpoints && <><p className="settings-help">{t("settings.inactiveDeviceRetention", { count: deviceEndpoints.inactiveRetentionDays })}</p>{!deviceEndpoints.canRevokeOthers && deviceEndpoints.endpoints.some((device) => !device.current && device.active) && <p className="session-gate">{t("settings.revokeAfter", { date: formatDateTime(deviceEndpoints.revokeEligibleAt) })}</p>}<div className="session-list">{deviceEndpoints.endpoints.map((device) => <article className={`session-row ${device.current ? "current" : ""}`} key={device.id}><span className="session-device-icon"><AppIcon icon={Laptop} /></span><span className="session-details"><strong>{device.deviceName}{device.current && <em>{t("settings.currentDevice")}</em>}{device.remembered && <em>{t("settings.remembered")}</em>}</strong><span>{t("settings.lastOnline", { date: formatDateTime(device.lastSeenAt) })}</span><small>{t("settings.deviceDetails", { first: formatDateTime(device.firstSeenAt), last: formatDateTime(device.lastLoginAt), count: device.loginCount, ip: device.ipAddress || t("common.unknown"), status: device.active ? t("settings.deviceActive") : device.revokedAt ? t("settings.deviceSignedOut") : t("settings.deviceExpired") })}</small></span>{!device.current && (device.active ? <button className="session-revoke" disabled={!deviceEndpoints.canRevokeOthers || revokingSessionId === device.id} onClick={() => void revokeDeviceEndpoint(device.id, device.deviceName)}><AppIcon icon={LogOut} size={15} />{t("settings.signOut")}</button> : <button className="session-revoke" disabled={revokingSessionId === device.id} onClick={() => void removeDeviceEndpoint(device.id, device.deviceName)}><AppIcon icon={Trash2} size={15} />{t("common.remove")}</button>)}</article>)}</div></>}
            <h3>{t("settings.accountCredentials")}</h3><p className="settings-help">{t("settings.accountCredentialsHelp")}</p>
            <div className="settings-actions"><button type="button" className="primary compact" disabled={busy || !serverSessionVerified} onClick={() => openAccountCredentialDialog("password")}>{t("settings.changePassword")}</button><button type="button" disabled={busy || !serverSessionVerified} onClick={() => openAccountCredentialDialog("recovery")}><AppIcon icon={KeyRound} size={15} />{t("settings.resetRecovery")}</button></div>
          </div>}

          {tab === "data" && <div className="settings-section"><h3>{t("settings.portableData")}</h3><p className="settings-help">{t("settings.portableHelp")}</p><input ref={fileInput} type="file" accept=".md,.markdown,.txt,.zip" multiple hidden onChange={(event) => { void importSelected(event.target.files); event.target.value = ""; }} /><div className="settings-actions"><button disabled={busy} onClick={() => fileInput.current?.click()}>{t("settings.import")}</button><button disabled={busy} onClick={() => void onExport()}>{t("settings.export")}</button></div></div>}
          {tab === "about" && <div className="settings-section about-settings">
            <div className="about-product">
              <h3>Mint Notes</h3>
              <p>{t("settings.version")} {APP_VERSION}</p>
            </div>
            <div className="about-introduction">
              <p>{t("settings.aboutDescription")}</p>
            </div>
            <h3>{t("settings.acknowledgements")}</h3>
            <p className="settings-help">{t("settings.aboutHelp")}</p>
            <ul className="about-credits">
              <li><a href="https://github.com/Yuyz0112/typora-web" target="_blank" rel="noreferrer">typora-web</a><span>{t("settings.editorCoreOrigin")}</span></li>
              <li><a href="https://lucide.dev" target="_blank" rel="noreferrer">Lucide React</a><span>{t("settings.iconLibrary")}</span></li>
            </ul>
          </div>}
          {tab === "users" && user.role === "admin" && serverSessionVerified && <div className="admin-settings"><AdminPanel currentUser={user} onNotify={onNotify} /></div>}
          <div className="settings-logout-section">
            <button type="button" className="settings-logout" onClick={() => setLogoutConfirming(true)}><AppIcon icon={LogOut} size={16} />{t("app.logout")}</button>
          </div>
        </div>
      </div>
      {profileDialogOpen && <div className="danger-confirm profile-edit-dialog settings-section" role="dialog" aria-modal="true" aria-label={t("settings.editProfile")}>
        <header><h3>{t("settings.editProfile")}</h3><button type="button" onClick={closeProfileDialog} aria-label={t("common.close")}><AppIcon icon={X} /></button></header>
        <div className="profile-avatar-editor"><strong>{t("settings.avatar")}</strong><span className="profile-avatar">{avatarUrl ? <img src={avatarUrl} alt={t("settings.currentAvatar")} /> : <AppIcon icon={UserRound} size={44} />}</span><input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" hidden onChange={(event) => { void uploadAvatar(event.target.files); event.target.value = ""; }} /><div className="settings-actions"><button type="button" className="profile-action-button" disabled={busy || !serverSessionVerified} onClick={() => avatarInput.current?.click()}><AppIcon icon={Upload} size={16} />{t(avatarUrl ? "settings.changeAvatar" : "settings.uploadAvatar")}</button>{avatarUrl && <button type="button" className="danger profile-action-button" disabled={busy || !serverSessionVerified} onClick={() => void removeAvatar()}><AppIcon icon={Trash2} size={16} />{t("settings.removeAvatar")}</button>}</div></div>
        <form className="compact-form profile-field-form" onSubmit={saveDisplayName}><label>{t("settings.name")}<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoFocus required /></label><button className="primary profile-action-button" disabled={busy || displayName === user.displayName}>{t("settings.changeDisplayName")}</button></form>
        <form className="compact-form profile-field-form" onSubmit={beginUsernameChange}><label>{t("auth.username")}<input value={username} onChange={(event) => setUsername(event.target.value)} pattern="[a-z0-9][a-z0-9._-]{2,47}" autoComplete="username" required /></label><p className="settings-help">{t("settings.changeUsernameHelp")}</p><button className="primary profile-action-button" disabled={busy || normalizedUsername() === user.username}>{t("settings.changeUsername")}</button></form>
        <div className="settings-actions profile-dialog-footer"><button type="button" className="profile-action-button" disabled={busy} onClick={closeProfileDialog}>{t("common.close")}</button></div>
      </div>}

      {usernameDialogOpen && <div className="danger-confirm username-change-dialog settings-section" role="dialog" aria-modal="true" aria-label={t("settings.changeUsername")}>
        <header><h3>{pendingUsernameRecoveryReset ? t("settings.saveReplacementRecovery") : t("settings.verifyUsernameChange")}</h3><button type="button" onClick={closeUsernameDialog} aria-label={t("common.close")}><AppIcon icon={X} /></button></header>
        {!pendingUsernameRecoveryReset ? <>
          <p>{t("settings.usernameVerificationHelp")}</p>
          <form className="compact-form" onSubmit={saveUsername}><label>{t("auth.currentPassword")}<input type="password" value={usernamePassword} onChange={(event) => setUsernamePassword(event.target.value)} autoComplete="current-password" autoFocus required /></label><label>{t("auth.recoveryKey")}<input type="password" value={usernameRecoveryKey} onChange={(event) => setUsernameRecoveryKey(event.target.value)} autoComplete="off" required /></label><div className="settings-actions"><button type="button" disabled={busy || !usernamePassword} onClick={() => void prepareUsernameRecoveryReset()}><AppIcon icon={KeyRound} size={15} />{t("settings.resetRecoveryAndContinue")}</button><button className="primary" disabled={busy}>{t("settings.confirmUsernameChange")}</button></div></form>
        </> : <>
          <p>{t("settings.replacementRecoveryHelp")}</p>
          <div className="recovery-result"><textarea readOnly rows={3} value={pendingUsernameRecoveryReset.recoveryCode} /><div className="settings-actions"><button type="button" onClick={() => void navigator.clipboard.writeText(pendingUsernameRecoveryReset.recoveryCode)}>{t("common.copy")}</button><button type="button" onClick={() => downloadRecoveryKey(normalizedUsername(), pendingUsernameRecoveryReset.recoveryCode)}><AppIcon icon={Download} size={15} />{t("common.download")}</button></div><label className="recovery-confirm"><input type="checkbox" checked={usernameRecoveryConfirmed} onChange={(event) => setUsernameRecoveryConfirmed(event.target.checked)} /><span>{t("auth.recovery.confirm")}</span></label></div>
          <div className="settings-actions"><button type="button" disabled={busy} onClick={closeUsernameDialog}>{t("common.cancel")}</button><button type="button" className="primary" disabled={busy || !usernameRecoveryConfirmed} onClick={() => void saveUsernameWithRecoveryReset()}>{t("settings.finishUsernameChange")}</button></div>
        </>}
      </div>}
      {pinDialogMode && <div className="danger-confirm pin-change-dialog settings-section" role="dialog" aria-modal="true" aria-label={t(pinDialogMode === "save" ? (hasDevicePin(credential) ? "settings.changePin" : "settings.setPin") : "settings.removePin")}>
        <header><h3>{t(pinDialogMode === "save" ? (hasDevicePin(credential) ? "settings.changePin" : "settings.setPin") : "settings.removePin")}</h3><button type="button" onClick={closePinDialog} aria-label={t("common.close")}><AppIcon icon={X} /></button></header>
        <p>{t(pinDialogMode === "save" ? "settings.pinVerificationHelp" : "settings.removePinHelp")}</p>
        {pinDialogMode === "save" ? <form className="compact-form" onSubmit={savePin}><label>{t("auth.masterPassword")}<input type="password" autoComplete="current-password" value={pinPassword} onChange={(event) => setPinPassword(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="next" autoFocus required /></label><label>{t("settings.newPin")}<input type="password" minLength={4} value={newPin} onChange={(event) => setNewPin(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="done" placeholder={t("settings.pinMin")} required /></label><div className="settings-actions"><button type="button" disabled={busy} onClick={closePinDialog}>{t("common.cancel")}</button><button type="submit" className="primary" disabled={busy}>{hasDevicePin(credential) ? t("settings.changePin") : t("settings.setPin")}</button></div></form> : <form className="compact-form" onSubmit={removePin}><label>{t("auth.masterPassword")}<input type="password" autoComplete="current-password" value={pinPassword} onChange={(event) => setPinPassword(event.target.value)} autoFocus required /></label><div className="settings-actions"><button type="button" disabled={busy} onClick={closePinDialog}>{t("common.cancel")}</button><button type="submit" className="danger danger-solid" disabled={busy}>{t("settings.removePin")}</button></div></form>}
      </div>}
      {accountCredentialDialogMode && <div className="danger-confirm account-credential-dialog settings-section" role="dialog" aria-modal="true" aria-label={t(accountCredentialDialogMode === "password" ? "settings.changePassword" : "settings.resetRecovery")}>
        <header><h3>{t(accountCredentialDialogMode === "password" ? "settings.changePassword" : "settings.resetRecovery")}</h3>{!newRecoveryKey && <button type="button" onClick={closeAccountCredentialDialog} aria-label={t("common.close")}><AppIcon icon={X} /></button>}</header>
        {accountCredentialDialogMode === "password" ? <><p>{t("settings.changePasswordHelp")}</p><form className="compact-form" onSubmit={changePassword}><label>{t("auth.currentPassword")}<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="next" autoFocus required /></label><label>{t("auth.newMasterPassword")}<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="next" required /></label><label>{t("auth.confirmNewPassword")}<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="done" required /></label><div className="settings-actions"><button type="button" disabled={busy} onClick={closeAccountCredentialDialog}>{t("common.cancel")}</button><button type="submit" className="primary" disabled={busy}>{t("settings.changePassword")}</button></div></form></> : !newRecoveryKey ? <><p>{t("settings.recoveryHelp")}</p><form className="compact-form" onSubmit={resetRecoveryKey}><label>{t("auth.currentPassword")}<input type="password" autoComplete="current-password" value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} autoFocus required /></label><div className="settings-actions"><button type="button" disabled={busy} onClick={closeAccountCredentialDialog}>{t("common.cancel")}</button><button type="submit" className="primary" disabled={busy}><AppIcon icon={KeyRound} size={15} />{t("settings.resetRecovery")}</button></div></form></> : <><p>{t("settings.recoveryHelp")}</p><div className="recovery-result"><strong>{t("settings.recoveryShownOnce")}</strong><textarea readOnly rows={3} value={newRecoveryKey} /><div className="settings-actions"><button type="button" onClick={() => void navigator.clipboard.writeText(newRecoveryKey)}>{t("common.copy")}</button><button type="button" onClick={() => downloadRecoveryKey(user.username, newRecoveryKey)}><AppIcon icon={Download} size={15} />{t("common.download")}</button><button type="button" className="primary" onClick={closeAccountCredentialDialog}>{t("settings.savedRecovery")}</button></div></div></>}
      </div>}
      {logoutConfirming && <div className="danger-confirm logout-confirm settings-section" role="dialog" aria-modal="true" aria-label={t("settings.logoutTitle")}><header><h3>{t("settings.logoutTitle")}</h3><button type="button" onClick={() => setLogoutConfirming(false)} aria-label={t("common.close")}><AppIcon icon={X} /></button></header><p>{t("settings.logoutWarning")}</p><div className="settings-actions"><button type="button" onClick={() => setLogoutConfirming(false)}>{t("common.cancel")}</button><button type="button" className="danger danger-solid" onClick={() => void onLogout()}><AppIcon icon={LogOut} size={15} />{t("app.logout")}</button></div></div>}
    </section>
  </div>;
}
