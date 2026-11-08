import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } from "@/components/ui/alert-dialog";
import { Alert } from "@/components/ui/alert";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsItem } from "../../components/SettingsItem";
import { useState, type FormEvent } from "react";
import { Copy, KeyRound, Pencil, Plug, Trash2, X } from "lucide-react";
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
  const [confirming, setConfirming] = useState<string | null>(null);
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
  return <SettingsSection title={t("applications.title")} className="application-connections">
    <SettingsItem title={t("applications.authorization")} description={t("applications.help")}><SettingsButton icon={Plug} variant="default" disabled={disabled || Boolean(editing) || Boolean(controller.applicationKey)} onClick={() => startEdit("new")}>{t("applications.add")}</SettingsButton></SettingsItem>
    {!online && <p className="session-gate">{t("notice.onlineSessionRequired")}</p>}
    {controller.error && <Alert className="error" variant="destructive">{t("applications.failed")}</Alert>}
    {editing && online && <form className="compact-form application-form" onSubmit={(event) => void submit(event)}>
      <SettingsItem title={t("applications.name")}>{(control) => <Input {...control} value={name} maxLength={80} required disabled={disabled || controller.retryPending} onChange={(event) => setName(event.target.value)} autoFocus />}</SettingsItem>
      {editing === "new" && <SettingsItem title={t("applications.permission")} description={t("applications.permissionHelp")}>{(control) => <NativeSelect {...control} value={access} disabled={disabled || controller.retryPending} onChange={(event) => setAccess(event.target.value as typeof access)}><option value="read-write">{t("applications.readWrite")}</option><option value="read">{t("applications.readOnly")}</option></NativeSelect>}</SettingsItem>}
      <SettingsItem title={t("applications.idleExpiry")} description={t("applications.idleHelp")}>{(control) => <NativeSelect {...control} value={idle ?? "never"} disabled={disabled || controller.retryPending} onChange={(event) => setIdle(event.target.value === "never" ? null : Number(event.target.value) as 7 | 30 | 90)}>{[7, 30, 90].map((days) => <option key={days} value={days}>{t("applications.days", { count: days })}</option>)}<option value="never">{t("applications.never")}</option></NativeSelect>}</SettingsItem>
      <SettingsItem title={t("applications.fixedExpiry")}>{(control) => <Input {...control} type="datetime-local" value={expiry} disabled={disabled || controller.retryPending} onChange={(event) => setExpiry(event.target.value)} />}</SettingsItem>
      <div className="settings-actions"><SettingsButton icon={X} type="button" disabled={controller.busy} onClick={() => { controller.dismissKey(); setEditing(null); }}>{t("common.cancel")}</SettingsButton><SettingsButton icon={KeyRound} type="submit" variant="default" disabled={disabled}>{t(controller.retryPending ? "applications.retry" : editing === "new" ? "applications.generate" : "common.save")}</SettingsButton></div>
    </form>}
    {controller.applicationKey && online && <div className="application-key-card" role="region" aria-label={t("applications.newKey")}>
      <strong>{t("applications.newKey")}</strong>
      <p>{t("applications.once")}</p>
      <label>{t("applications.serverUrl")}<Input readOnly value={window.location.origin} /></label>
      <label>{t("applications.key")}<Input readOnly autoComplete="off" spellCheck={false} value={controller.applicationKey} /></label>
      <div className="settings-actions"><SettingsButton icon={Copy} onClick={() => void copy(window.location.origin)}>{t("applications.copyUrl")}</SettingsButton><SettingsButton icon={Copy} onClick={() => void copy(controller.applicationKey!)}>{t("applications.copyKey")}</SettingsButton><SettingsButton icon={X} onClick={controller.dismissKey}>{t("applications.savedKey")}</SettingsButton></div>
    </div>}
    {confirming && online && <AlertDialog open onOpenChange={(open) => { if (!open && !disabled) setConfirming(null); }}>
      <AlertDialogContent className="application-confirm">
      <AlertDialogTitle>{t("applications.revoke")}</AlertDialogTitle>
      <AlertDialogDescription>{t("applications.confirmOne")}</AlertDialogDescription>
      <div className="settings-actions"><SettingsButton icon={X} disabled={disabled} onClick={() => setConfirming(null)}>{t("common.cancel")}</SettingsButton><SettingsButton icon={Trash2} variant="destructive" disabled={disabled} onClick={() => void controller.revoke(confirming).then((ok) => { if (ok) setConfirming(null); })}>{t("applications.revoke")}</SettingsButton></div>
      </AlertDialogContent>
    </AlertDialog>}
    {online && controller.connections.length === 0 && !controller.busy && <p className="settings-help">{t("applications.empty")}</p>}
    <div className="session-list settings-list">{controller.connections.map((row) => <Item className="session-row settings-list-row" key={row.connectionId} render={<article />}>
      <ItemMedia className="settings-list-icon"><AppIcon icon={Plug} size={20} /></ItemMedia>
      <ItemContent className="session-details settings-list-details"><strong>{row.name}<Badge variant="outline" render={<em />}>{t(row.access === "read" ? "applications.readOnly" : "applications.readWrite")}</Badge><Badge variant="outline" render={<em />}>{t(`applications.${row.status}`)}</Badge></strong>
        <span>{t("applications.created", { date: formatDateTime(row.createdAt) })}</span>
        <small>{t("applications.lastUsed", { date: row.lastUsedAt ? formatDateTime(row.lastUsedAt) : t("applications.unused") })}</small>
        <small>{t("applications.idlePolicy", { value: row.idleTimeoutDays === null ? t("applications.never") : t("applications.days", { count: row.idleTimeoutDays }) })}</small>
        <small>{t("applications.expires", { date: row.validUntil ? formatDateTime(row.validUntil) : t("applications.never") })}</small>
      </ItemContent>
      <div className="settings-list-actions">
        {row.status === "active" && <SettingsButton icon={Pencil} disabled={disabled || Boolean(editing) || Boolean(controller.applicationKey)} onClick={() => startEdit(row)}>{t("applications.edit")}</SettingsButton>}
        {row.status === "revoked"
          ? <SettingsButton icon={Trash2} disabled={disabled || Boolean(controller.applicationKey)} onClick={() => void controller.remove(row.connectionId)}>{t("applications.removeDevice")}</SettingsButton>
          : <SettingsButton icon={Trash2} variant="destructive" disabled={disabled || Boolean(controller.applicationKey)} onClick={() => setConfirming(row.connectionId)}>{t("applications.revoke")}</SettingsButton>}
      </div>
    </Item>)}</div>
  </SettingsSection>;
}
