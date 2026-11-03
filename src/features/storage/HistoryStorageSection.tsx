import { SettingsSection } from "../../components/SettingsSection";
import { SettingsItem } from "../../components/SettingsItem";
import { Trash2 } from "lucide-react";
import { SettingsButton } from "../../components/SettingsButton";
import { useI18n } from "../../i18n";
import type { HistorySettings } from "../../types";
import { formatHistoryBytes } from "../history";
import { HISTORY_QUOTA_PRESETS, QuotaFields } from "./QuotaFields";
import { useHistoryQuotaAutoSave } from "./useHistoryQuotaAutoSave";
export function HistoryStorageSection({ historySettings, busy, serverSessionVerified, updateHistorySettings, onClearHistory }: {
 historySettings: HistorySettings; busy: boolean; serverSessionVerified: boolean;
 updateHistorySettings: (patch: Partial<Pick<HistorySettings, "enabled" | "intervalMinutes" | "retentionDays" | "quotaBytes">>) => Promise<boolean>; onClearHistory: () => Promise<void>;
}) {
 const { t } = useI18n();
 const quota = useHistoryQuotaAutoSave(historySettings.quotaBytes, busy, serverSessionVerified, updateHistorySettings);
            return <SettingsSection title={t("settings.history")} className="history-settings">
              <SettingsItem title={t("settings.historyAutomatic")}>{(control) =>
                <label className="settings-switch" htmlFor={control.id}>
                  <input
                    {...control}
                    type="checkbox"
                    role="switch"
                    aria-label={t("settings.historyAutomatic")}
                    disabled={busy || !serverSessionVerified}
                    checked={historySettings.enabled}
                    onChange={(event) => void updateHistorySettings({ enabled: event.target.checked })}
                  />
                  <span className="settings-switch-track" aria-hidden="true" />
                </label>}
              </SettingsItem>
              <SettingsItem title={t("settings.historyFrequency")}>{(control) => <select {...control} disabled={busy || !serverSessionVerified || !historySettings.enabled} value={historySettings.intervalMinutes} onChange={(event) => void updateHistorySettings({ intervalMinutes: Number(event.target.value) as HistorySettings["intervalMinutes"] })}>{[5, 10, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{t("settings.minutes", { count: minutes })}</option>)}</select>}</SettingsItem>
              <SettingsItem title={t("settings.historyRetention")} description={t("settings.historyTiered")}>{(control) => <select {...control} disabled={busy || !serverSessionVerified} value={historySettings.retentionDays === null ? "never" : historySettings.retentionDays} onChange={(event) => void updateHistorySettings({ retentionDays: event.target.value === "never" ? null : Number(event.target.value) as HistorySettings["retentionDays"] })}>{[7, 30, 90, 180, 365].map((days) => <option key={days} value={days}>{t(days === 90 ? "settings.daysDefault" : "settings.days", { count: days })}</option>)}<option value="never">{t("settings.keepForever")}</option></select>}</SettingsItem>
              <div className="history-budget" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void quota.flush(); }}>
                <QuotaFields presets={HISTORY_QUOTA_PRESETS} label={t("storage.historyBudget")} description={t("storage.historyBudgetHelp")} value={quota.draft} onChange={quota.change} disabled={busy || quota.saving || !serverSessionVerified} />
              </div>
              <SettingsItem title={t("settings.historyStorage")} className="history-usage" description={<>{formatHistoryBytes(historySettings.usedBytes)} / {historySettings.quotaBytes === null ? t("storage.unlimited") : formatHistoryBytes(historySettings.quotaBytes)} · {t("settings.historyVersionCount", { count: historySettings.count })}</>}>
                <SettingsButton icon={Trash2} className="danger" disabled={busy || !serverSessionVerified || historySettings.count === 0} onClick={() => void onClearHistory()}>{t("settings.historyClearAll")}</SettingsButton>
              </SettingsItem>
            </SettingsSection>;
}
