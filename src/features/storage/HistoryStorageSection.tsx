import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { AppIcon } from "../../components/AppIcon";
import { SettingsButton } from "../../components/SettingsButton";
import { useI18n } from "../../i18n";
import type { HistorySettings } from "../../types";
import { formatHistoryBytes } from "../history";
import { HISTORY_QUOTA_PRESETS, QuotaFields, quotaDraft, quotaPayload } from "./QuotaFields";
export function HistoryStorageSection({ historySettings, busy, serverSessionVerified, updateHistorySettings, onClearHistory }: {
 historySettings: HistorySettings; busy: boolean; serverSessionVerified: boolean;
 updateHistorySettings: (patch: Partial<Pick<HistorySettings, "enabled" | "intervalMinutes" | "retentionDays" | "quotaBytes">>) => Promise<void>; onClearHistory: () => Promise<void>;
}) {
 const { t } = useI18n();
 const [draft, setDraft] = useState(() => quotaDraft(historySettings.quotaBytes === null ? "unlimited" : "limited", historySettings.quotaBytes));
 useEffect(() => setDraft(quotaDraft(historySettings.quotaBytes === null ? "unlimited" : "limited", historySettings.quotaBytes)), [historySettings.quotaBytes]);
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
              <details className="storage-details"><summary>{t("storage.retentionRules")}</summary><p className="settings-help">{t("settings.historyTiered")}</p></details>
              <form className="history-budget" onSubmit={(event) => { event.preventDefault(); void updateHistorySettings({ quotaBytes: quotaPayload(draft).bytes }); }}>
                <QuotaFields presets={HISTORY_QUOTA_PRESETS} label={t("storage.historyBudget")} value={draft} onChange={setDraft} disabled={busy || !serverSessionVerified} />
                <SettingsButton aria-label={t("storage.saveQuota")} disabled={busy || !serverSessionVerified}><span className="quota-save-label">{t("storage.saveQuota")}</span><span className="quota-save-short" aria-hidden="true">{t("common.save")}</span></SettingsButton>
              </form><p className="settings-help">{t("storage.historyBudgetHelp")}</p>
              <div className="history-usage">
                <span><strong>{t("settings.historyStorage")}</strong><small>{t("settings.historyVersionCount", { count: historySettings.count })}</small></span>
                <span>{formatHistoryBytes(historySettings.usedBytes)} / {historySettings.quotaBytes === null ? t("storage.unlimited") : formatHistoryBytes(historySettings.quotaBytes)}</span>
                {historySettings.quotaBytes !== null && <progress max={historySettings.quotaBytes} value={Math.min(historySettings.usedBytes, historySettings.quotaBytes)} />}
              </div>
              <div className="settings-actions"><SettingsButton className="danger" disabled={busy || !serverSessionVerified || historySettings.count === 0} onClick={() => void onClearHistory()}><AppIcon icon={Trash2} size={15} />{t("settings.historyClearAll")}</SettingsButton></div>
            </div>;
}
