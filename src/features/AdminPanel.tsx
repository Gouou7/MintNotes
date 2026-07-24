import { type FormEvent, useEffect, useState } from "react";
import { ShieldCheck, Trash2, X } from "lucide-react";
import { api } from "../api";
import { AppIcon } from "../components/AppIcon";
import type { ToastTone } from "../components/Toast";
import { cryptoClient } from "../crypto/client";
import { translateError, useI18n } from "../i18n";
import type { KdfParams, User } from "../types";

interface ManagedUser {
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

function bytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

export function AdminPanel({ currentUser, onNotify }: { currentUser: User; onNotify: (text: string, tone: ToastTone) => void }) {
  const { formatDateTime, t } = useI18n();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [setups, setSetups] = useState<AccountSetup[]>([]);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [activation, setActivation] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [confirmationUsername, setConfirmationUsername] = useState("");
  const [administratorPassword, setAdministratorPassword] = useState("");

  const load = () => api<{ users: ManagedUser[]; setups: AccountSetup[] }>("/api/admin/users")
    .then((data) => { setUsers(data.users); setSetups(data.setups); })
    .catch((value) => onNotify(translateError(value, t, "admin.loadFailed"), "warning"));
  useEffect(() => { void load(); }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ activationCode: string }>("/api/admin/account-setups", { method: "POST", body: JSON.stringify({ username, displayName, expiresInHours: 72 }) });
      setActivation(result.activationCode); setUsername(""); setDisplayName("");
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

  const cancel = async (setup: AccountSetup) => {
    if (!window.confirm(t("admin.cancelActivationConfirm", { username: setup.username }))) return;
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

  return <div className="settings-section admin-panel">
    <div className="admin-heading"><span><AppIcon icon={ShieldCheck} size={22} /></span><div><h3>{t("settings.admin")}</h3><p>{t("admin.description")}</p></div></div>
    <h3>{t("admin.createPending")}</h3><p className="settings-help">{t("admin.createPendingHelp")}</p>
    <form className="admin-create" onSubmit={create}><label>{t("auth.username")}<input value={username} onChange={(event) => setUsername(event.target.value)} pattern="[a-z0-9][a-z0-9._-]{2,47}" required /></label><label>{t("auth.displayName")}<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label><button className="primary compact" disabled={busy}>{t("admin.createCode")}</button></form>
    {activation && <div className="activation-result"><strong>{t("admin.codeShownOnce")}</strong><code>{activation}</code><button onClick={() => navigator.clipboard.writeText(activation)}>{t("common.copy")}</button></div>}
    {!!setups.length && <><h3>{t("admin.pending")}</h3><div className="user-list">{setups.map((entry) => <div className="user-row" key={entry.id}><span><strong>{entry.displayName}</strong><small>@{entry.username} · {t("admin.expires", { date: formatDateTime(entry.expiresAt) })}</small></span><button disabled={busy} onClick={() => void cancel(entry)}>{t("common.cancel")}</button></div>)}</div></>}
    <h3>{t("admin.existingUsers")}</h3><div className="user-list">{users.map((entry) => <div className="user-row" key={entry.id}><span><strong>{entry.displayName}{entry.id === currentUser.id && <em>{t("admin.currentAccount")}</em>}</strong><small>@{entry.username} · {entry.role === "admin" ? t("admin.roleAdmin") : t("admin.roleUser")} · {t("admin.objectCount", { count: entry.objectCount })} · {bytes(entry.encryptedBytes)}</small></span><div className="user-actions"><button disabled={busy || entry.id === currentUser.id} onClick={() => void toggle(entry)}>{entry.disabled ? t("admin.enable") : t("admin.disable")}</button>{entry.id !== currentUser.id && <button className="danger" disabled={busy} onClick={() => beginDelete(entry)}><AppIcon icon={Trash2} size={15} />{t("admin.delete")}</button>}</div></div>)}</div>
    {deleteTarget && <div className="danger-confirm" role="dialog" aria-modal="true" aria-label={t("admin.deleteUser")}><header><h3>{t("admin.deleteUserTitle", { username: deleteTarget.username })}</h3><button type="button" onClick={() => setDeleteTarget(null)} aria-label={t("common.close")}><AppIcon icon={X} /></button></header><p>{t("admin.deleteWarning")}</p><form onSubmit={deleteUser}><label>{t("admin.confirmUsername")}<input value={confirmationUsername} onChange={(event) => setConfirmationUsername(event.target.value)} placeholder={deleteTarget.username} required /></label><label>{t("admin.yourPassword")}<input type="password" autoComplete="current-password" value={administratorPassword} onChange={(event) => setAdministratorPassword(event.target.value)} required /></label><div className="settings-actions"><button type="button" onClick={() => setDeleteTarget(null)}>{t("common.cancel")}</button><button className="danger danger-solid" disabled={busy || confirmationUsername !== deleteTarget.username}>{t("admin.deleteUser")}</button></div></form></div>}
  </div>;
}
