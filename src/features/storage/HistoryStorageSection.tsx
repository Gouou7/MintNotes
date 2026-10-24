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
            return <div className="settings-section settings-card history-settings">
              <h3>{t("settings.history")}</h3>
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
              <div className="history-budget" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void quota.flush(); }}>
                <QuotaFields presets={HISTORY_QUOTA_PRESETS} label={t("storage.historyBudget")} value={quota.draft} onChange={quota.change} disabled={busy || quota.saving || !serverSessionVerified} />
              </div><p className="settings-help">{t("storage.historyBudgetHelp")}</p>
              <div className="history-usage">
                <span className="history-usage-label"><strong>{t("settings.historyStorage")}</strong><small>{t("settings.historyVersionCount", { count: historySettings.count })}</small></span>
                <div className="history-usage-meter">
                  {historySettings.quotaBytes !== null && <progress aria-label={t("settings.historyStorage")} max={historySettings.quotaBytes} value={Math.min(historySettings.usedBytes, historySettings.quotaBytes)} />}
                  <span>{formatHistoryBytes(historySettings.usedBytes)} / {historySettings.quotaBytes === null ? t("storage.unlimited") : formatHistoryBytes(historySettings.quotaBytes)}</span>
                </div>
                <SettingsButton icon={Trash2} className="danger" disabled={busy || !serverSessionVerified || historySettings.count === 0} onClick={() => void onClearHistory()}>{t("settings.historyClearAll")}</SettingsButton>
              </div>
            </div>;
}
