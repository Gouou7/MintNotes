import { useState, type FormEvent } from "react";
import { Copy, KeyRound, Pencil, Plug, RefreshCw, Trash2, X } from "lucide-react";
import type { ApplicationConnection, ApplicationPolicy } from "@mint-notes/application-client";
import { AppIcon } from "../../components/AppIcon";
import { SettingsButton } from "../../components/SettingsButton";
import type { ToastTone } from "../../components/Toast";
import { useI18n } from "../../i18n";
import { useApplicationConnections } from "./useApplicationConnections";

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ApplicationConnectionsSection({ userId, online, onNotify }: {
  userId: string; online: boolean; onNotify: (message: string, tone: ToastTone) => void;
}) {
  const { t, formatDateTime } = useI18n();
  const controller = useApplicationConnections(userId, online);
  const [editing, setEditing] = useState<ApplicationConnection | "new" | null>(null);
  const [name, setName] = useState("OpenClaw");
  const [access, setAccess] = useState<"read" | "read-write">("read-write");
  const [idle, setIdle] = useState<ApplicationPolicy["idleTimeoutDays"]>(30);
  const [expiry, setExpiry] = useState("");
  const [confirming, setConfirming] = useState<string | "all" | null>(null);
  const disabled = !online || controller.busy;
  const startEdit = (row: ApplicationConnection | "new") => {
    controller.dismissKey();
    setEditing(row);
    setName(row === "new" ? "OpenClaw" : row.name);
    setAccess(row === "new" ? "read-write" : row.access);
    setIdle(row === "new" ? 30 : row.idleTimeoutDays);
    setExpiry(row === "new" ? "" : localDateTime(row.expiresAt));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const policy: ApplicationPolicy = { name: name.trim(), idleTimeoutDays: idle, expiresAt: expiry ? new Date(expiry).toISOString() : null };
    const ok = editing === "new" ? await controller.create(policy, access) : await controller.update(editing.connectionId, policy);
    if (ok) setEditing(null);
  };
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); onNotify(t("applications.copied"), "info"); }
    catch { onNotify(t("applications.copyFailed"), "warning"); }
  };
  return <section className="application-connections" aria-label={t("applications.title")}>
    <h3>{t("applications.title")}</h3>
    <p className="settings-help">{t("applications.help")}</p>
    {!online && <p className="session-gate">{t("notice.onlineSessionRequired")}</p>}
    <div className="settings-actions">
      <SettingsButton icon={Plug} className="primary" disabled={disabled || Boolean(editing) || Boolean(controller.applicationKey)} onClick={() => startEdit("new")}>{t("applications.add")}</SettingsButton>
      <SettingsButton icon={RefreshCw} disabled={disabled} onClick={() => void controller.refresh()}>{t("applications.refresh")}</SettingsButton>
      <SettingsButton icon={Trash2} className="danger" disabled={disabled || Boolean(controller.applicationKey) || !controller.connections.some((row) => row.status === "active")} onClick={() => setConfirming("all")}>{t("applications.revokeAll")}</SettingsButton>
    </div>
    {controller.error && <p className="error" role="alert">{t("applications.failed")}</p>}
    {editing && online && <form className="compact-form application-form" onSubmit={(event) => void submit(event)}>
      <label>{t("applications.name")}<input value={name} maxLength={80} required disabled={disabled || controller.retryPending} onChange={(event) => setName(event.target.value)} autoFocus /></label>
      {editing === "new" && <label>{t("applications.permission")}<select value={access} disabled={disabled || controller.retryPending} onChange={(event) => setAccess(event.target.value as typeof access)}><option value="read-write">{t("applications.readWrite")}</option><option value="read">{t("applications.readOnly")}</option></select></label>}
      <label>{t("applications.idleExpiry")}<select value={idle ?? "never"} disabled={disabled || controller.retryPending} onChange={(event) => setIdle(event.target.value === "never" ? null : Number(event.target.value) as 7 | 30 | 90)}>{[7, 30, 90].map((days) => <option key={days} value={days}>{t("applications.days", { count: days })}</option>)}<option value="never">{t("applications.never")}</option></select></label>
      <label>{t("applications.fixedExpiry")}<input type="datetime-local" value={expiry} disabled={disabled || controller.retryPending} onChange={(event) => setExpiry(event.target.value)} /></label>
      <p className="settings-help">{t("applications.policyHelp")}</p>
      <div className="settings-actions"><SettingsButton icon={X} type="button" disabled={controller.busy} onClick={() => { controller.dismissKey(); setEditing(null); }}>{t("common.cancel")}</SettingsButton><SettingsButton icon={KeyRound} type="submit" className="primary" disabled={disabled}>{t(controller.retryPending ? "applications.retry" : editing === "new" ? "applications.generate" : "common.save")}</SettingsButton></div>
    </form>}
    {controller.applicationKey && online && <div className="application-key-card" role="region" aria-label={t("applications.newKey")}>
      <strong>{t("applications.newKey")}</strong>
      <p>{t("applications.once")}</p>
      <label>{t("applications.serverUrl")}<input readOnly value={window.location.origin} /></label>
      <label>{t("applications.key")}<input readOnly autoComplete="off" spellCheck={false} value={controller.applicationKey} /></label>
      <div className="settings-actions"><SettingsButton icon={Copy} onClick={() => void copy(window.location.origin)}>{t("applications.copyUrl")}</SettingsButton><SettingsButton icon={Copy} onClick={() => void copy(controller.applicationKey!)}>{t("applications.copyKey")}</SettingsButton><SettingsButton icon={X} onClick={controller.dismissKey}>{t("applications.savedKey")}</SettingsButton></div>
    </div>}
    {confirming && online && <div className="application-confirm" role="alertdialog" aria-label={t("applications.revoke")}>
      <p>{t(confirming === "all" ? "applications.confirmAll" : "applications.confirmOne")}</p>
      <div className="settings-actions"><SettingsButton icon={X} disabled={disabled} onClick={() => setConfirming(null)}>{t("common.cancel")}</SettingsButton><SettingsButton icon={Trash2} className="danger" disabled={disabled} onClick={() => void controller.revoke(confirming === "all" ? null : confirming).then((ok) => { if (ok) setConfirming(null); })}>{t("applications.revoke")}</SettingsButton></div>
    </div>}
    {online && controller.connections.length === 0 && !controller.busy && <p className="settings-help">{t("applications.empty")}</p>}
    <div className="session-list">{controller.connections.map((row) => <article className="session-row" key={row.connectionId}>
      <span className="session-device-icon"><AppIcon icon={Plug} /></span>
      <span className="session-details"><strong>{row.name}<em>{t(row.access === "read" ? "applications.readOnly" : "applications.readWrite")}</em><em>{t(`applications.${row.status}`)}</em></strong>
        <span>{t("applications.created", { date: formatDateTime(row.createdAt) })}</span>
        <small>{t("applications.lastUsed", { date: row.lastUsedAt ? formatDateTime(row.lastUsedAt) : t("applications.unused") })}</small>
        <small>{t("applications.idlePolicy", { value: row.idleTimeoutDays === null ? t("applications.never") : t("applications.days", { count: row.idleTimeoutDays }) })}</small>
        <small>{t("applications.expires", { date: row.validUntil ? formatDateTime(row.validUntil) : t("applications.never") })}</small>
      </span>
      <div className="application-row-actions">{row.status === "active" && <><SettingsButton icon={Pencil} disabled={disabled || Boolean(editing) || Boolean(controller.applicationKey)} onClick={() => startEdit(row)}>{t("applications.edit")}</SettingsButton><SettingsButton icon={Trash2} className="danger" disabled={disabled || Boolean(controller.applicationKey)} onClick={() => setConfirming(row.connectionId)}>{t("applications.revoke")}</SettingsButton></>}</div>
    </article>)}</div>
  </section>;
}
