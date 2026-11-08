import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Field, FieldLabel } from "@/components/ui/field";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { Checkbox } from "@/components/ui/checkbox";
import { AppDialog } from "../components/AppDialog";
import { Confirmation, useConfirmation } from "../components/Confirmation";
import { DialogClose, DialogTitle } from "../components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { SettingsDialog } from "./SettingsDialog";
import { useMediaQuery } from "./useMediaQuery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { useWorkspaceServices } from "./session/workspaceServices";
import { SettingsSection } from "../components/SettingsSection";
import { SettingsItem } from "../components/SettingsItem";
import type { StorageStatus } from "./storage/useStorageStatus";
import { HistoryStorageSection } from "./storage/HistoryStorageSection";
import { TrashStorageSection } from "./storage/TrashStorageSection";
import { MigrationStorageSection } from "./storage/MigrationStorageSection";
import { RecoveryStorageSection } from "./storage/RecoveryStorageSection";
import { StorageUsage, PendingStorage } from "./storageUsage";
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Notebook, ChevronDown, ChevronRight, ChevronsUp, Check, Copy, Download, Ellipsis, FileText, Folder, History as HistoryIcon, Info, KeyRound, Laptop, LogOut, Pencil, Search, Settings, SlidersHorizontal, UserRoundCog, ShieldCheck, Trash2, Upload, UserRound, X } from "lucide-react";
import { AppIcon } from "../components/AppIcon";
import { SettingsButton } from "../components/SettingsButton";
import { LanguageSelect } from "../components/LanguageSelect";
import type { ToastTone } from "../components/Toast";
import { createVaultEnvelopeBinding, type EncryptedProfileAvatar } from "../crypto/client";
import { getDeviceUnlock, hasDevicePin, removeDevicePin, setAutoLockMinutes, setDevicePin } from "../crypto/deviceUnlock";
import { translateError, useI18n } from "../i18n";
import type { DeviceUnlockCredential } from "../storage/database";
import type { AuthEndpoint, AuthParameters, HistorySettings, OpenDocument, TrustedEndpointsResponse, UiPreferences, User, VaultEnvelopeBinding } from "../types";
import { submitFormOnEnter } from "./formKeyboard";
import { AdminPanel } from "./AdminPanel";
import { prepareProfileAvatar } from "./profileAvatar";
import { formatHistoryBytes } from "./history";
import { downloadRecoveryKey } from "./recoveryKey";
import { APP_VERSION } from "../version";
import { DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE, normalizeFontSize } from "./appearance";
import { ApplicationConnectionsSection } from "./applications/ApplicationConnectionsSection";

type Tab = "general" | "storage" | "security" | "about" | "users";
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
  confirmationDialog?: ReactNode;
  storageStatus: StorageStatus;
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

export function SettingsPanel({ confirmationDialog, storageStatus, user, endpoint, credential, serverSessionVerified, onCredentialChange, preferences, onPreferences, onClose, onLogout, onImport, onExport, onDisplayName, onUsername, avatarUrl, onAvatarChange, trashItems, purging, onRestoreTrash, onPurgeTrash, onClearHistory, onClearTrash, historySettings, onHistorySettings, onRefreshHistorySettings, onNotify }: Props) {
  const { transport: { api }, cryptoClient, generation } = useWorkspaceServices();
  const { formatDateTime, setLanguagePreference, t } = useI18n();
  const confirmation = useConfirmation();
  const compactTabs = useMediaQuery("(max-width: 720px)");
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
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [newRecoveryKey, setNewRecoveryKey] = useState("");
  const [newRecoveryConfirmed, setNewRecoveryConfirmed] = useState(false);
  const [accountCredentialDialogMode, setAccountCredentialDialogMode] = useState<AccountCredentialDialogMode | null>(null);
  const [logoutConfirming, setLogoutConfirming] = useState(false);
  const currentDevices = useRef({ serverSessionVerified, deviceEndpoints, revokingSessionId });
  currentDevices.current = { serverSessionVerified, deviceEndpoints, revokingSessionId };
  const avatarInput = useRef<HTMLInputElement>(null);
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
    if (tab !== "storage" || !serverSessionVerified) return;
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

  const updateHistorySettings = async (patch: Partial<Pick<HistorySettings, "enabled" | "intervalMinutes" | "retentionDays" | "quotaBytes">>) => {
    if (!requireServerSession()) return false;
    setBusy(true);
    try {
      const result = await api<HistorySettings>("/api/account/note-history-settings", {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      onHistorySettings(result);
      onNotify(t("notice.historySettingsSaved"), "info");
      return true;
    } catch (value) {
      onNotify(translateError(value, t, "notice.historySettingsSaveFailed"), "warning");
      return false;
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
    const action = t("settings.signOut");
    if (!await confirmation.request({ title: action, message: t("notice.signOutDeviceConfirm", { device: deviceName }), action, destructive: true })) return;
    const latest = currentDevices.current;
    const device = latest.deviceEndpoints?.endpoints.find((entry) => entry.id === endpointId);
    if (!latest.serverSessionVerified || latest.revokingSessionId === endpointId || !latest.deviceEndpoints?.canRevokeOthers || !device || device.current || !(device.active || device.resumable)) return;
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
    const action = t("common.remove");
    if (!await confirmation.request({ title: action, message: t("notice.removeDeviceConfirm", { device: deviceName }), action, destructive: true })) return;
    const latest = currentDevices.current;
    const device = latest.deviceEndpoints?.endpoints.find((entry) => entry.id === endpointId);
    if (!latest.serverSessionVerified || latest.revokingSessionId === endpointId || !device || device.current || device.active || device.resumable) return;
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
      await setDevicePin(user.id, endpoint.id, newPin, cryptoClient, generation);
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
      await removeDevicePin(user.id, endpoint.id, cryptoClient);
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
    setNewRecoveryConfirmed(false);
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
      setNewRecoveryConfirmed(false);
      onNotify(t("notice.recoveryReset"), "info");
    } catch (value) { onNotify(translateError(value, t, "notice.recoveryResetFailed"), "warning"); }
    finally { await cryptoClient.discardPendingLogin().catch(() => undefined); setBusy(false); }
  };

  const contentRef = useRef<HTMLDivElement>(null);
  const changeTab = (next: Tab) => {
    setTab(next);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  };
  const pageTitle = t(({ general: "settings.general", security: "settings.security", storage: "storage.title", about: "settings.about", users: "settings.admin" } as const)[tab]);

  return <SettingsDialog onClose={onClose} dismissible={!newRecoveryKey}
    style={{ "--settings-font-size": `${normalizeFontSize(preferences.fontSize)}px` } as CSSProperties}>
      <Tabs value={tab} onValueChange={(value) => changeTab(value as Tab)} orientation={compactTabs ? "horizontal" : "vertical"} className="settings-layout">
        <Sidebar className="settings-sidebar h-auto w-full">
          <SidebarHeader className="p-0">
            <DialogTitle className="settings-title"><AppIcon icon={Settings} size={16} />{t("settings.title")}</DialogTitle>
          </SidebarHeader>
          <SidebarContent>
            <TabsList className="settings-tabs" variant="line" aria-label={t("settings.title")}>
              <TabsTrigger value="general"><AppIcon icon={SlidersHorizontal} size={16} />{t("settings.general")}</TabsTrigger>
              <TabsTrigger value="security"><AppIcon icon={UserRoundCog} size={16} />{t("settings.security")}</TabsTrigger>
              <TabsTrigger value="storage"><AppIcon icon={Notebook} size={16} />{t("storage.title")}</TabsTrigger>
              {user.role === "admin" && serverSessionVerified && <TabsTrigger value="users" className="admin-tab"><AppIcon icon={ShieldCheck} size={16} />{t("settings.admin")}</TabsTrigger>}
              <TabsTrigger value="about"><AppIcon icon={Info} size={16} />{t("settings.about")}</TabsTrigger>
            </TabsList>
          </SidebarContent>
        </Sidebar>
        <div className="settings-main">
          <header className="settings-header"><DialogClose render={<Button variant="ghost" size="icon" disabled={Boolean(newRecoveryKey)} aria-label={t("settings.close")} />}><AppIcon icon={X} /></DialogClose></header>
          <div className="settings-content" ref={contentRef}>
            <h2 className="settings-page-title">{pageTitle}</h2>
            {!serverSessionVerified && <p className="auth-guidance warning">{t("settings.localOnly")}</p>}
            <TabsContent value="general" className="settings-page general-settings">
              <SettingsSection title={t("settings.appearance")}>
              <SettingsItem title={t("language.label")}>{(control) => <LanguageSelect {...control} value={preferences.language} onChange={(language) => { setLanguagePreference(language); onPreferences({ ...preferences, language }); }} />}</SettingsItem>
              <SettingsItem title={t("settings.theme")}>{(control) => <NativeSelect {...control} value={preferences.theme} onChange={(event) => onPreferences({ ...preferences, theme: event.target.value as UiPreferences["theme"] })}><option value="system">{t("settings.themeSystem")}</option><option value="light">{t("settings.themeLight")}</option><option value="dark">{t("settings.themeDark")}</option></NativeSelect>}</SettingsItem>
              <SettingsItem title={t("settings.fontSize")} className="font-size-setting">{(control) =>
                <NativeSelect {...control} value={normalizeFontSize(preferences.fontSize)} onChange={(event) => onPreferences({ ...preferences, fontSize: normalizeFontSize(Number(event.target.value)) })}>
                  {Array.from({ length: MAX_FONT_SIZE - MIN_FONT_SIZE + 1 }, (_, index) => MIN_FONT_SIZE + index).map(size => <option key={size} value={size}>{size === MIN_FONT_SIZE ? t("settings.fontSizeSmall", { size }) : size === DEFAULT_FONT_SIZE ? t("settings.fontSizeDefault", { size }) : size === MAX_FONT_SIZE ? t("settings.fontSizeLarge", { size }) : size}</option>)}
                </NativeSelect>}
              </SettingsItem>
              </SettingsSection><SettingsSection title={t("settings.editor")}>
              <SettingsItem title={t("settings.wrapCodeBlocks")}>{(control) =>
                <Switch className="settings-switch"
                    {...control}
                    aria-label={t("settings.wrapCodeBlocks")}
                    checked={preferences.wrapCodeBlocks}
                    onCheckedChange={(checked) => onPreferences({ ...preferences, wrapCodeBlocks: checked })}
                />}
              </SettingsItem>
              </SettingsSection>
            </TabsContent>

            <TabsContent value="security" className="settings-page security-settings">
              <div className="profile-summary settings-section settings-card"><Avatar className="profile-avatar">{avatarUrl && <AvatarImage src={avatarUrl} alt={t("settings.currentAvatar")} />}<AvatarFallback><AppIcon icon={UserRound} size={30} /></AvatarFallback></Avatar><span className="profile-identity"><strong>{user.displayName}</strong><small>@{user.username}</small></span><SettingsButton icon={Pencil} variant="default" className="primary" disabled={busy || !serverSessionVerified} onClick={openProfileDialog}>{t("settings.editProfile")}</SettingsButton></div>
              <SettingsSection title={t("settings.accountCredentials")}>
                <SettingsItem title={t("auth.masterPassword")} description={t("settings.changePasswordHelp")}><SettingsButton icon={KeyRound} type="button" variant="default" className="primary compact" disabled={busy || !serverSessionVerified} onClick={() => openAccountCredentialDialog("password")}>{t("settings.changePassword")}</SettingsButton></SettingsItem>
                <SettingsItem title={t("settings.recoveryKey")} description={t("settings.recoveryHelp")}><SettingsButton icon={KeyRound} type="button" disabled={busy || !serverSessionVerified} onClick={() => openAccountCredentialDialog("recovery")}>{t("settings.resetRecovery")}</SettingsButton></SettingsItem>
              </SettingsSection>
              <SettingsSection title={t("settings.deviceSecurity")}>
                <SettingsItem title={t("settings.devicePin")} description={t(hasDevicePin(credential) ? "settings.pinConfiguredHelp" : "settings.pinHelp")}><SettingsButton icon={KeyRound} type="button" variant="default" className="primary compact" disabled={busy || !serverSessionVerified} onClick={() => openPinDialog("save")}>{hasDevicePin(credential) ? t("settings.changePin") : t("settings.setPin")}</SettingsButton>{hasDevicePin(credential) && <SettingsButton icon={KeyRound} type="button" disabled={busy || !serverSessionVerified} onClick={() => openPinDialog("remove")}>{t("settings.removePin")}</SettingsButton>}</SettingsItem>
                <SettingsItem title={t("settings.autoLockAfter")} description={t("settings.autoLockHelp")}>{(control) => <NativeSelect {...control} disabled={busy} value={autoLock} onChange={(event) => void updateAutoLock(Number(event.target.value))}><option value="0">{t("settings.offDefault")}</option>{[1, 2, 5, 10, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{t(minutes === 1 ? "settings.minute" : "settings.minutes", { count: minutes })}</option>)}</NativeSelect>}</SettingsItem>
              </SettingsSection><SettingsSection title={t("settings.loginDevices")}><p className="settings-help">{t("settings.loginDevicesHelp")}</p>
              {sessionsLoading && !deviceEndpoints && <p className="settings-help">{t("settings.loadingDevices")}</p>}
              {deviceEndpoints && <><p className="settings-help">{t("settings.inactiveDeviceRetention", { count: deviceEndpoints.inactiveRetentionDays })}</p>{!deviceEndpoints.canRevokeOthers && deviceEndpoints.endpoints.some((device) => !device.current && (device.active || device.resumable)) && <p className="session-gate">{t("settings.revokeAfter", { date: formatDateTime(deviceEndpoints.revokeEligibleAt) })}</p>}<div className="session-list settings-list">{deviceEndpoints.endpoints.map((device) => <Item className={`session-row settings-list-row ${device.current ? "current" : ""}`} key={device.id} render={<article />}><ItemMedia className="settings-list-icon"><AppIcon icon={Laptop} size={20} /></ItemMedia><ItemContent className="session-details settings-list-details"><strong>{device.deviceName}{device.current && <Badge variant="outline" render={<em />}>{t("settings.currentDevice")}</Badge>}{device.remembered && <Badge variant="outline" render={<em />}>{t("settings.remembered")}</Badge>}</strong><span>{t("settings.lastOnline", { date: formatDateTime(device.lastSeenAt) })}</span><small>{t("settings.deviceDetails", { first: formatDateTime(device.firstSeenAt), last: formatDateTime(device.lastLoginAt), count: device.loginCount, ip: device.ipAddress || t("common.unknown"), status: device.active ? t("settings.deviceActive") : device.resumable ? t("account.deviceResumable") : device.revokedAt ? t("settings.deviceSignedOut") : t("settings.deviceExpired") })}</small></ItemContent>{!device.current && <div className="settings-list-actions">{device.active || device.resumable ? <SettingsButton icon={LogOut} variant="destructive" className="session-revoke danger" disabled={!deviceEndpoints.canRevokeOthers || revokingSessionId === device.id} onClick={() => void revokeDeviceEndpoint(device.id, device.deviceName)}>{t("settings.signOut")}</SettingsButton> : <SettingsButton icon={Trash2} className="session-remove" disabled={revokingSessionId === device.id} onClick={() => void removeDeviceEndpoint(device.id, device.deviceName)}>{t("common.remove")}</SettingsButton>}</div>}</Item>)}</div></>}
              </SettingsSection><ApplicationConnectionsSection userId={user.id} online={serverSessionVerified} onNotify={onNotify} />
            </TabsContent>

            <TabsContent value="storage" className="settings-page note-storage-settings">
              <StorageUsage status={storageStatus} />
              <RecoveryStorageSection userId={user.id} onNotify={onNotify} />
              <HistoryStorageSection historySettings={historySettings} busy={busy} serverSessionVerified={serverSessionVerified} updateHistorySettings={updateHistorySettings} onClearHistory={onClearHistory} />
              <TrashStorageSection trashItems={trashItems} busy={busy} purging={purging} serverSessionVerified={serverSessionVerified} trashRetentionDays={trashRetentionDays} updateTrashRetention={updateTrashRetention} onRestoreTrash={onRestoreTrash} onPurgeTrash={onPurgeTrash} onClearTrash={onClearTrash} onNotify={onNotify} />
              <MigrationStorageSection onImport={onImport} onExport={onExport} onNotify={onNotify} />
            </TabsContent>

            <TabsContent value="about" className="settings-page about-settings">
              <section className="settings-section settings-card about-overview"><div className="about-product">
                <h3>Mint Notes</h3>
                <p>{t("settings.version")} {APP_VERSION}</p>
              </div>
              <div className="about-introduction">
                <p>{t("settings.aboutDescription")}</p>
              </div>
              </section><SettingsSection title={t("settings.acknowledgements")}>
              <p className="settings-help">{t("settings.aboutHelp")}</p>
              <ul className="about-credits">
                <li><a href="https://github.com/Yuyz0112/typora-web" target="_blank" rel="noreferrer">typora-web</a><span>{t("settings.editorCoreOrigin")}</span></li>
                <li><a href="https://katex.org/" target="_blank" rel="noreferrer">KaTeX</a><span>{t("settings.mathFormulaRendering")}</span></li>
                <li><a href="https://mermaid.js.org/" target="_blank" rel="noreferrer">Mermaid</a><span>{t("settings.diagramRendering")}</span></li>
                <li><a href="https://ui.shadcn.com/" target="_blank" rel="noreferrer">shadcn/ui</a><span>{t("settings.uiComponentLibrary")}</span></li>
                <li><a href="https://lucide.dev" target="_blank" rel="noreferrer">Lucide React</a><span>{t("settings.iconLibrary")}</span></li>
              </ul></SettingsSection>
            </TabsContent>
            {user.role === "admin" && serverSessionVerified && <TabsContent value="users" className="admin-settings"><AdminPanel currentUser={user} onNotify={onNotify} /></TabsContent>}
          </div>
        </div>
        <SidebarFooter className="settings-logout-section flex-row">
          <SettingsButton icon={LogOut} type="button" variant="destructive" className="settings-logout danger" onClick={() => setLogoutConfirming(true)}>{t("app.logout")}</SettingsButton>
        </SidebarFooter>
      </Tabs>
      {profileDialogOpen && <AppDialog className="danger-confirm profile-edit-dialog settings-section" title={t("settings.editProfile")} onClose={closeProfileDialog} dismissible={!busy}>
        <div className="profile-avatar-editor"><strong>{t("settings.avatar")}</strong><Avatar className="profile-avatar">{avatarUrl && <AvatarImage src={avatarUrl} alt={t("settings.currentAvatar")} />}<AvatarFallback><AppIcon icon={UserRound} size={44} /></AvatarFallback></Avatar><input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" hidden onChange={(event) => { void uploadAvatar(event.target.files); event.target.value = ""; }} /><div className="settings-actions"><SettingsButton icon={Upload} type="button" className="profile-action-button" disabled={busy || !serverSessionVerified} onClick={() => avatarInput.current?.click()}>{t(avatarUrl ? "settings.changeAvatar" : "settings.uploadAvatar")}</SettingsButton>{avatarUrl && <SettingsButton icon={Trash2} type="button" variant="destructive" className="danger profile-action-button" disabled={busy || !serverSessionVerified} onClick={() => void removeAvatar()}>{t("settings.removeAvatar")}</SettingsButton>}</div></div>
        <form className="compact-form profile-field-form" onSubmit={saveDisplayName}><Field><FieldLabel>{t("settings.name")}<Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoFocus required /></FieldLabel></Field><SettingsButton type="submit" icon={Pencil} variant="default" className="primary profile-action-button" disabled={busy || displayName === user.displayName}>{t("settings.changeDisplayName")}</SettingsButton></form>
        <form className="compact-form profile-field-form" onSubmit={beginUsernameChange}><Field><FieldLabel>{t("auth.username")}<Input value={username} onChange={(event) => setUsername(event.target.value)} pattern="[a-z0-9][a-z0-9._-]{2,47}" autoComplete="username" required /></FieldLabel></Field><p className="settings-help">{t("settings.changeUsernameHelp")}</p><SettingsButton type="submit" icon={Pencil} variant="default" className="primary profile-action-button" disabled={busy || normalizedUsername() === user.username}>{t("settings.changeUsername")}</SettingsButton></form>
        <div className="settings-actions profile-dialog-footer"><SettingsButton icon={X} type="button" className="profile-action-button" disabled={busy} onClick={closeProfileDialog}>{t("common.close")}</SettingsButton></div>
      </AppDialog>}

      {usernameDialogOpen && <AppDialog className="danger-confirm username-change-dialog settings-section" title={pendingUsernameRecoveryReset ? t("settings.saveReplacementRecovery") : t("settings.verifyUsernameChange")} onClose={closeUsernameDialog} dismissible={!busy}>
        {!pendingUsernameRecoveryReset ? <>
          <p>{t("settings.usernameVerificationHelp")}</p>
          <form className="compact-form" onSubmit={saveUsername}><Field><FieldLabel>{t("auth.currentPassword")}<Input type="password" value={usernamePassword} onChange={(event) => setUsernamePassword(event.target.value)} autoComplete="current-password" autoFocus required /></FieldLabel></Field><Field><FieldLabel>{t("auth.recoveryKey")}<Input type="password" value={usernameRecoveryKey} onChange={(event) => setUsernameRecoveryKey(event.target.value)} autoComplete="off" required /></FieldLabel></Field><div className="settings-actions"><SettingsButton icon={KeyRound} type="button" disabled={busy || !usernamePassword} onClick={() => void prepareUsernameRecoveryReset()}>{t("settings.resetRecoveryAndContinue")}</SettingsButton><SettingsButton type="submit" icon={Check} variant="default" className="primary" disabled={busy}>{t("settings.confirmUsernameChange")}</SettingsButton></div></form>
        </> : <>
          <p>{t("settings.replacementRecoveryHelp")}</p>
          <div className="recovery-result"><Textarea readOnly rows={3} value={pendingUsernameRecoveryReset.recoveryCode} /><div className="settings-actions"><SettingsButton icon={Copy} type="button" onClick={() => void navigator.clipboard.writeText(pendingUsernameRecoveryReset.recoveryCode)}>{t("common.copy")}</SettingsButton><SettingsButton icon={Download} type="button" onClick={() => downloadRecoveryKey(normalizedUsername(), pendingUsernameRecoveryReset.recoveryCode)}>{t("common.download")}</SettingsButton></div><label className="recovery-confirm"><Checkbox  checked={usernameRecoveryConfirmed} onCheckedChange={(checked) => setUsernameRecoveryConfirmed(checked)} /><span>{t("auth.recovery.confirm")}</span></label></div>
          <div className="settings-actions"><SettingsButton icon={X} type="button" disabled={busy} onClick={closeUsernameDialog}>{t("common.cancel")}</SettingsButton><SettingsButton icon={Check} type="button" variant="default" className="primary" disabled={busy || !usernameRecoveryConfirmed} onClick={() => void saveUsernameWithRecoveryReset()}>{t("settings.finishUsernameChange")}</SettingsButton></div>
        </>}
      </AppDialog>}
      {pinDialogMode && <AppDialog className="danger-confirm pin-change-dialog settings-section" title={t(pinDialogMode === "save" ? (hasDevicePin(credential) ? "settings.changePin" : "settings.setPin") : "settings.removePin")} onClose={closePinDialog} dismissible={!busy}>
        <p>{t(pinDialogMode === "save" ? "settings.pinVerificationHelp" : "settings.removePinHelp")}</p>
        {pinDialogMode === "save" ? <form className="compact-form" onSubmit={savePin}><Field><FieldLabel>{t("auth.masterPassword")}<Input type="password" autoComplete="current-password" value={pinPassword} onChange={(event) => setPinPassword(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="next" autoFocus required /></FieldLabel></Field><Field><FieldLabel>{t("settings.newPin")}<Input type="password" minLength={4} value={newPin} onChange={(event) => setNewPin(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="done" placeholder={t("settings.pinMin")} required /></FieldLabel></Field><div className="settings-actions"><SettingsButton icon={X} type="button" disabled={busy} onClick={closePinDialog}>{t("common.cancel")}</SettingsButton><SettingsButton icon={KeyRound} type="submit" variant="default" className="primary" disabled={busy}>{hasDevicePin(credential) ? t("settings.changePin") : t("settings.setPin")}</SettingsButton></div></form> : <form className="compact-form" onSubmit={removePin}><Field><FieldLabel>{t("auth.masterPassword")}<Input type="password" autoComplete="current-password" value={pinPassword} onChange={(event) => setPinPassword(event.target.value)} autoFocus required /></FieldLabel></Field><div className="settings-actions"><SettingsButton icon={X} type="button" disabled={busy} onClick={closePinDialog}>{t("common.cancel")}</SettingsButton><SettingsButton icon={KeyRound} type="submit" variant="destructive" className="danger" disabled={busy}>{t("settings.removePin")}</SettingsButton></div></form>}
      </AppDialog>}
      {accountCredentialDialogMode && <AppDialog className="danger-confirm account-credential-dialog settings-section" title={t(accountCredentialDialogMode === "password" ? "settings.changePassword" : "settings.resetRecovery")} onClose={closeAccountCredentialDialog} dismissible={!busy && !newRecoveryKey}>
        {accountCredentialDialogMode === "password" ? <><p>{t("settings.changePasswordHelp")}</p><form className="compact-form" onSubmit={changePassword}><Field><FieldLabel>{t("auth.currentPassword")}<Input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="next" autoFocus required /></FieldLabel></Field><Field><FieldLabel>{t("auth.newMasterPassword")}<Input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="next" required /></FieldLabel></Field><Field><FieldLabel>{t("auth.confirmNewPassword")}<Input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} onKeyDown={submitFormOnEnter} enterKeyHint="done" required /></FieldLabel></Field><div className="settings-actions"><SettingsButton icon={X} type="button" disabled={busy} onClick={closeAccountCredentialDialog}>{t("common.cancel")}</SettingsButton><SettingsButton icon={KeyRound} type="submit" variant="default" className="primary" disabled={busy}>{t("settings.changePassword")}</SettingsButton></div></form></> : !newRecoveryKey ? <><p>{t("settings.recoveryHelp")}</p><form className="compact-form" onSubmit={resetRecoveryKey}><Field><FieldLabel>{t("auth.currentPassword")}<Input type="password" autoComplete="current-password" value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} autoFocus required /></FieldLabel></Field><div className="settings-actions"><SettingsButton icon={X} type="button" disabled={busy} onClick={closeAccountCredentialDialog}>{t("common.cancel")}</SettingsButton><SettingsButton icon={KeyRound} type="submit" variant="default" className="primary" disabled={busy}>{t("settings.resetRecovery")}</SettingsButton></div></form></> : <><p>{t("settings.recoveryHelp")}</p><div className="recovery-result"><strong>{t("settings.recoveryShownOnce")}</strong><Textarea readOnly rows={3} value={newRecoveryKey} /><div className="settings-actions"><SettingsButton icon={Copy} type="button" onClick={() => void navigator.clipboard.writeText(newRecoveryKey)}>{t("common.copy")}</SettingsButton><SettingsButton icon={Download} type="button" onClick={() => downloadRecoveryKey(user.username, newRecoveryKey)}>{t("common.download")}</SettingsButton></div><label className="recovery-confirm"><Checkbox  checked={newRecoveryConfirmed} onCheckedChange={(checked) => setNewRecoveryConfirmed(checked)} /><span>{t("auth.recovery.confirm")}</span></label><div className="settings-actions"><SettingsButton icon={Check} type="button" variant="default" className="primary" disabled={!newRecoveryConfirmed} onClick={closeAccountCredentialDialog}>{t("settings.savedRecovery")}</SettingsButton></div></div></>}
      </AppDialog>}
      {logoutConfirming && <AppDialog className="danger-confirm logout-confirm settings-section" title={t("settings.logoutTitle")} onClose={() => setLogoutConfirming(false)} dismissible={true}><p>{t("settings.logoutWarning")}</p><PendingStorage status={storageStatus} /><div className="settings-actions"><SettingsButton icon={X} type="button" onClick={() => setLogoutConfirming(false)}>{t("common.cancel")}</SettingsButton><SettingsButton type="button" icon={Download} onClick={() => void onExport()}>{t("storage.exportAll")}</SettingsButton><SettingsButton icon={LogOut} type="button" variant="destructive" className="danger" onClick={() => void onLogout()}>{t("app.logout")}</SettingsButton></div>{confirmationDialog}</AppDialog>}
      <Confirmation current={confirmation.current} />
      {!logoutConfirming && confirmationDialog}
  </SettingsDialog>;
}
