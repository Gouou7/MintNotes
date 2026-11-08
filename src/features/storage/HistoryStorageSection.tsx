import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
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
                <Switch className="settings-switch"
                    {...control}
                    aria-label={t("settings.historyAutomatic")}
                    disabled={busy || !serverSessionVerified}
                    checked={historySettings.enabled}
                    onCheckedChange={(checked) => void updateHistorySettings({ enabled: checked })}
                />}
              </SettingsItem>
              <SettingsItem title={t("settings.historyFrequency")}>{(control) => <Select {...control} disabled={busy || !serverSessionVerified || !historySettings.enabled}
                value={historySettings.intervalMinutes} items={([5, 10, 30, 60] as const).map((minutes) => ({
                  value: minutes, label: t("settings.minutes", { count: minutes })
                }))} onValueChange={(intervalMinutes) => void updateHistorySettings({ intervalMinutes })} />}</SettingsItem>
              <SettingsItem title={t("settings.historyRetention")} description={t("settings.historyTiered")}>{(control) => <Select {...control} disabled={busy || !serverSessionVerified}
                value={historySettings.retentionDays ?? "never"} items={[
                  ...([7, 30, 90, 180, 365] as const).map((days) => ({ value: days, label: t(days === 90 ? "settings.daysDefault" : "settings.days", { count: days }) })),
                  { value: "never", label: t("settings.keepForever") }
                ]} onValueChange={(days) => void updateHistorySettings({ retentionDays: days === "never" ? null : days })} />}</SettingsItem>
              <div className="history-budget" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void quota.flush(); }}>
                <QuotaFields presets={HISTORY_QUOTA_PRESETS} label={t("storage.historyBudget")} description={t("storage.historyBudgetHelp")} value={quota.draft} onChange={quota.change} disabled={busy || quota.saving || !serverSessionVerified} />
              </div>
              <SettingsItem title={t("settings.historyStorage")} className="history-usage" description={<>{formatHistoryBytes(historySettings.usedBytes)} / {historySettings.quotaBytes === null ? t("storage.unlimited") : formatHistoryBytes(historySettings.quotaBytes)} · {t("settings.historyVersionCount", { count: historySettings.count })}</>}>
                <SettingsButton icon={Trash2} variant="destructive" disabled={busy || !serverSessionVerified || historySettings.count === 0} onClick={() => void onClearHistory()}>{t("settings.historyClearAll")}</SettingsButton>
              </SettingsItem>
            </SettingsSection>;
}
