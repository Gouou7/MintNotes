import { type FormEvent, useState } from "react";
import { Save, X } from "lucide-react";
import { api } from "../../api";
import { AppIcon } from "../../components/AppIcon";
import { SettingsButton } from "../../components/SettingsButton";
import type { ToastTone } from "../../components/Toast";
import { translateError, useI18n } from "../../i18n";
import { QuotaFields, quotaDraft, quotaPayload, type QuotaDraft } from "./QuotaFields";

export interface StorageQuotaUser { id: string; displayName: string; totalBytes: number; quotaMode: QuotaDraft["mode"]; quotaBytes: number | null; }
function useQuotaEditor(user: StorageQuotaUser, defaultBytes: number, onSaved: () => Promise<void>, onClose: () => void, notify: (text: string, tone: ToastTone) => void) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => quotaDraft(user.quotaMode, user.quotaBytes));
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false);
  const target = draft.mode === "unlimited" ? null : draft.mode === "inherit" ? defaultBytes : Number(draft.mib) * 1048576;
  const belowUsage = target !== null && target < user.totalBytes;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (belowUsage && !confirmed) return;
    setBusy(true);
    try {
      await api(`/api/admin/users/${user.id}/storage-quota`, { method: "PATCH", body: JSON.stringify(quotaPayload(draft)) });
      await onSaved(); notify(t("storage.quotaSaved"), "info"); onClose();
    } catch (error) { notify(translateError(error, t, "storage.quotaSaveFailed"), "warning"); }
    finally { setBusy(false); }
  };
  return { draft, setDraft, busy, belowUsage, confirmed, setConfirmed, submit };
}
export function AdminQuotaEditor({ user, defaultBytes, onSaved, onClose, onNotify }: {
  user: StorageQuotaUser; defaultBytes: number; onSaved: () => Promise<void>; onClose: () => void; onNotify: (text: string, tone: ToastTone) => void;
}) {
  const { t } = useI18n();
  const controller = useQuotaEditor(user, defaultBytes, onSaved, onClose, onNotify);
  return <div className="danger-confirm quota-dialog settings-section" role="dialog" aria-modal="true" aria-label={t("storage.editQuota")}>
    <header><h3>{t("storage.userQuota", { name: user.displayName })}</h3><button disabled={controller.busy} onClick={onClose} aria-label={t("common.close")}><AppIcon icon={X} /></button></header>
    <form onSubmit={(event) => void controller.submit(event)}>
      <QuotaFields label={t("storage.totalQuota")} defaultBytes={defaultBytes} value={controller.draft} onChange={(value) => { controller.setDraft(value); controller.setConfirmed(false); }} disabled={controller.busy} />
      {controller.belowUsage && <label className="quota-confirm"><input type="checkbox" checked={controller.confirmed} onChange={(event) => controller.setConfirmed(event.target.checked)} />{t("storage.lowerQuotaWarning")}</label>}
      <div className="settings-actions"><SettingsButton icon={X} type="button" disabled={controller.busy} onClick={onClose}>{t("common.cancel")}</SettingsButton><SettingsButton icon={Save} disabled={controller.busy || controller.belowUsage && !controller.confirmed}>{t("storage.saveQuota")}</SettingsButton></div>
    </form>
  </div>;
}
