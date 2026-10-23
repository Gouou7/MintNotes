import { useEffect, useState } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { formatHistoryBytes } from "./history";

export interface PhysicalStorageUsage { databaseBytes: number; walBytes: number; backupsBytes: number; }
interface Usage { contentBytes: number; historyBytes: number; quotaBytes: number; historyQuotaBytes: number; }
export function PhysicalStorage({ usage }: { usage: PhysicalStorageUsage }) {
  const { t } = useI18n();
  return <div><h4>{t("storage.physical")}</h4><p className="settings-help">{t("storage.physicalHelp")}</p>
    <p>{t("storage.database")}: {formatHistoryBytes(usage.databaseBytes)} · WAL: {formatHistoryBytes(usage.walBytes)} · {t("storage.backups")}: {formatHistoryBytes(usage.backupsBytes)}</p></div>;
}
export function StorageUsage({ online }: { online: boolean }) {
  const { t } = useI18n();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    if (online) void api<Usage>("/api/account/storage").then((value) => { if (active) setUsage(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [online]);
  return <section><h3>{t("storage.logical")}</h3>{usage ? <>
    <p>{t("storage.content")}: {formatHistoryBytes(usage.contentBytes)} / {formatHistoryBytes(usage.quotaBytes)}</p>
    <progress aria-label={t("storage.content")} max={usage.quotaBytes} value={Math.min(usage.contentBytes, usage.quotaBytes)} />
    <p>{t("settings.history")}: {formatHistoryBytes(usage.historyBytes)} / {formatHistoryBytes(usage.historyQuotaBytes)}</p>
  </> : <p className="settings-help">{t(failed || !online ? "storage.unavailable" : "history.loading")}</p>}
    <p className="settings-help">{t("storage.cacheHelp")}</p></section>;
}
