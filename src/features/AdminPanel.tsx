import { Field, FieldLabel } from "@/components/ui/field";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { Badge } from "@/components/ui/badge";
import { AppDialog } from "../components/AppDialog";
import { Confirmation, useConfirmation } from "../components/Confirmation";
import { Input } from "@/components/ui/input";
import { useWorkspaceServices } from "./session/workspaceServices";
import { SettingsSection } from "../components/SettingsSection";
import { SettingsItem } from "../components/SettingsItem";
import { DatabaseStorageSection } from "./storage/DatabaseStorageSection";
import { AdminQuotaEditor, type StorageQuotaUser } from "./storage/AdminQuotaEditor";
import { QuotaFields, quotaDraft, quotaPayload } from "./storage/QuotaFields";
import { formatHistoryBytes } from "./history";
import { capacityLevel } from "../storage/storageStatus";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Copy, HardDrive, KeyRound, Trash2, UserRound, UserRoundCheck, UserRoundX, X } from "lucide-react";
import { AppIcon } from "../components/AppIcon";
import { SettingsButton } from "../components/SettingsButton";
import type { ToastTone } from "../components/Toast";
import { translateError, useI18n } from "../i18n";
import type { KdfParams, User } from "../types";

interface ManagedUser extends StorageQuotaUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  disabled: boolean;
  objectCount: number;
  encryptedBytes: number;
}

interface AccountSetup {
  id: string;
  username: string;
  displayName: string;
  expiresAt: string;
}

export function AdminPanel({ currentUser, onNotify }: { currentUser: User; onNotify: (text: string, tone: ToastTone) => void }) {
  const { transport: { api }, cryptoClient } = useWorkspaceServices();
  const { formatDateTime, t } = useI18n();
  const confirmation = useConfirmation();
  const createFormId = useId();
  const [defaultQuotaBytes, setDefaultQuotaBytes] = useState(2 * 1024 * 1024 * 1024);
  const [newQuota, setNewQuota] = useState(() => quotaDraft("inherit", null));
  const [quotaTarget, setQuotaTarget] = useState<ManagedUser | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [setups, setSetups] = useState<AccountSetup[]>([]);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [activation, setActivation] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [confirmationUsername, setConfirmationUsername] = useState("");
  const [administratorPassword, setAdministratorPassword] = useState("");

  const load = () => api<{ users: ManagedUser[]; setups: AccountSetup[]; defaultQuotaBytes?: number }>("/api/admin/users")
    .then((data) => { setUsers(data.users); setSetups(data.setups); setDefaultQuotaBytes(data.defaultQuotaBytes ?? 2 * 1024 * 1024 * 1024); })
    .catch((value) => onNotify(translateError(value, t, "admin.loadFailed"), "warning"));
  useEffect(() => { void load(); }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ activationCode: string }>("/api/admin/account-setups", { method: "POST", body: JSON.stringify({ username, displayName, expiresInHours: 72, storageQuota: quotaPayload(newQuota) }) });
      setActivation(result.activationCode); setUsername(""); setDisplayName(""); setNewQuota(quotaDraft("inherit", null));
      onNotify(t("admin.codeCreated"), "info");
      await load();
    } catch (value) { onNotify(translateError(value, t, "admin.createFailed"), "warning"); }
    finally { setBusy(false); }
  };

  const toggle = async (user: ManagedUser) => {
    setBusy(true);
    try {
      await api(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ disabled: !user.disabled }) });
      onNotify(t(user.disabled ? "admin.userEnabled" : "admin.userDisabled", { name: user.displayName }), "info");
      await load();
    }
    catch (value) { onNotify(translateError(value, t, "admin.updateFailed"), "warning"); }
    finally { setBusy(false); }
  };

  const currentSetups = useRef({ setups, busy });
  currentSetups.current = { setups, busy };
  const cancel = async (setup: AccountSetup) => {
    if (!await confirmation.request({
      title: t("admin.pending"),
      message: t("admin.cancelActivationConfirm", { username: setup.username }),
      action: t("common.remove"),
      destructive: true
    })) return;
    if (currentSetups.current.busy || !currentSetups.current.setups.some((entry) => entry.id === setup.id)) return;
    setBusy(true);
    try {
      await api(`/api/admin/account-setups/${setup.id}`, { method: "DELETE" });
      onNotify(t("admin.activationCancelled", { username: setup.username }), "info");
      await load();
    }
    catch (value) { onNotify(translateError(value, t, "admin.cancelFailed"), "warning"); }
    finally { setBusy(false); }
  };

  const deleteUser = async (event: FormEvent) => {
    event.preventDefault();
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const deletedUsername = deleteTarget.username;
      const parameters = await api<{ kdfSalt: string; kdfParams: KdfParams }>(`/api/auth/parameters/${encodeURIComponent(currentUser.username)}`);
      const derived = await cryptoClient.prepareLogin(administratorPassword, parameters.kdfSalt, parameters.kdfParams);
      await api(`/api/admin/users/${deleteTarget.id}`, { method: "DELETE", body: JSON.stringify({ currentAuthSecret: derived.authSecret, confirmationUsername }) });
      setDeleteTarget(null); setConfirmationUsername(""); setAdministratorPassword("");
      onNotify(t("admin.userDeleted", { username: deletedUsername }), "info");
      await load();
    } catch (value) { onNotify(translateError(value, t, "admin.deleteFailed"), "warning"); }
    finally { await cryptoClient.discardPendingLogin().catch(() => undefined); setBusy(false); }
  };

  const beginDelete = (entry: ManagedUser) => {
    setConfirmationUsername(""); setAdministratorPassword(""); setDeleteTarget(entry);
  };

  return <div className="settings-page admin-panel">
    <SettingsSection title={t("admin.userManagement")} className="admin-user-management">
      <div className="admin-subsection">
        <SettingsItem title={t("admin.createPending")} description={t("admin.createPendingHelp")}><SettingsButton icon={KeyRound} type="submit" form={createFormId} variant="default" className="primary compact" disabled={busy}>{t("admin.createCode")}</SettingsButton></SettingsItem>
        <form id={createFormId} className="admin-create" onSubmit={create}>
          <SettingsItem title={t("auth.username")}>{(control) => <Input {...control} value={username} onChange={(event) => setUsername(event.target.value)} pattern="[a-z0-9][a-z0-9._-]{2,47}" required />}</SettingsItem>
          <SettingsItem title={t("auth.displayName")}>{(control) => <Input {...control} value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />}</SettingsItem>
          <QuotaFields label={t("storage.totalQuota")} defaultBytes={defaultQuotaBytes} value={newQuota} onChange={setNewQuota} disabled={busy} />
        </form>
        {activation && <div className="activation-result"><strong>{t("admin.codeShownOnce")}</strong><code>{activation}</code><SettingsButton icon={Copy} onClick={() => navigator.clipboard.writeText(activation)}>{t("common.copy")}</SettingsButton></div>}
        {!!setups.length && <><h4>{t("admin.pending")}</h4><div className="user-list settings-list">{setups.map((entry) => <Item className="user-row settings-list-row" key={entry.id}><ItemMedia className="settings-list-icon"><AppIcon icon={UserRound} size={20} /></ItemMedia><ItemContent className="settings-list-details"><strong>{entry.displayName}</strong><small>@{entry.username} · {t("admin.expires", { date: formatDateTime(entry.expiresAt) })}</small></ItemContent><div className="settings-list-actions"><SettingsButton icon={X} disabled={busy} onClick={() => void cancel(entry)}>{t("common.cancel")}</SettingsButton></div></Item>)}</div></>}
      </div>
      <div className="admin-subsection">
        <h4>{t("admin.existingUsers")}</h4><div className="user-list settings-list">{users.map((entry) => <Item className="user-row settings-list-row" key={entry.id}><ItemMedia className="settings-list-icon"><AppIcon icon={UserRound} size={20} /></ItemMedia><ItemContent className="settings-list-details"><strong>{entry.displayName}{entry.id === currentUser.id && <Badge variant="outline" render={<em />}>{t("admin.currentAccount")}</Badge>}</strong><small>@{entry.username} · {entry.role === "admin" ? t("admin.roleAdmin") : t("admin.roleUser")}</small><small className="user-storage">{formatHistoryBytes(entry.totalBytes ?? entry.encryptedBytes)} / {entry.quotaBytes === null ? t("storage.unlimited") : formatHistoryBytes(entry.quotaBytes ?? defaultQuotaBytes)} · {t(`storage.level.${capacityLevel(entry.totalBytes ?? entry.encryptedBytes, entry.quotaBytes ?? (entry.quotaMode === "unlimited" ? null : defaultQuotaBytes))}`)}</small></ItemContent><div className="user-actions settings-list-actions"><SettingsButton icon={HardDrive} disabled={busy} onClick={() => setQuotaTarget(entry)}>{t("storage.editQuota")}</SettingsButton><SettingsButton icon={entry.disabled ? UserRoundCheck : UserRoundX} disabled={busy || entry.id === currentUser.id} onClick={() => void toggle(entry)}>{entry.disabled ? t("admin.enable") : t("admin.disable")}</SettingsButton>{entry.id !== currentUser.id && <SettingsButton icon={Trash2} variant="destructive" className="danger" disabled={busy} onClick={() => beginDelete(entry)}>{t("admin.delete")}</SettingsButton>}</div></Item>)}</div>
      </div>
    </SettingsSection>
    <DatabaseStorageSection />
    {quotaTarget && <AdminQuotaEditor user={quotaTarget} defaultBytes={defaultQuotaBytes} onSaved={load} onClose={() => setQuotaTarget(null)} onNotify={onNotify} />}
    {deleteTarget && <AppDialog className="danger-confirm" title={t("admin.deleteUserTitle", { username: deleteTarget.username })} onClose={() => setDeleteTarget(null)} dismissible={!busy}><p>{t("admin.deleteWarning")}</p><form onSubmit={deleteUser}><Field><FieldLabel>{t("admin.confirmUsername")}<Input value={confirmationUsername} onChange={(event) => setConfirmationUsername(event.target.value)} placeholder={deleteTarget.username} required /></FieldLabel></Field><Field><FieldLabel>{t("admin.yourPassword")}<Input type="password" autoComplete="current-password" value={administratorPassword} onChange={(event) => setAdministratorPassword(event.target.value)} required /></FieldLabel></Field><div className="settings-actions"><SettingsButton icon={X} type="button" onClick={() => setDeleteTarget(null)}>{t("common.cancel")}</SettingsButton><SettingsButton icon={Trash2} type="submit" variant="destructive" className="danger" disabled={busy || confirmationUsername !== deleteTarget.username}>{t("admin.deleteUser")}</SettingsButton></div></form></AppDialog>}
    <Confirmation current={confirmation.current} />
  </div>;
}
