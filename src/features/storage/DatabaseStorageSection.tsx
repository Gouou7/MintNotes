import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../../api";
import { SettingsButton } from "../../components/SettingsButton";
import { useI18n } from "../../i18n";
import { formatHistoryBytes } from "../history";
interface DatabaseStatus {
  databaseBytes: number; walBytes: number; shmBytes: number; backupsBytes: number; reusableBytes: number; logicalBytes: number;
  userCount: number; sqliteVersion: string; schemaVersion: number; journalMode: string; checkedAt: string; available: boolean;
}
function useDatabaseStorage() {
  const [status, setStatus] = useState<DatabaseStatus | null>(null), [failed, setFailed] = useState(false), [busy, setBusy] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    void api<DatabaseStatus>("/api/admin/storage", { signal: controller.signal }).then((data) => { if (typeof data.checkedAt !== "string" || typeof data.databaseBytes !== "number") throw new Error("Invalid database status"); setStatus(data); setFailed(false); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [refreshIndex]);
  return { status, failed, busy, refresh: () => setRefreshIndex((value) => value + 1) };
}
export function DatabaseStorageSection() {
  const { t, formatDateTime } = useI18n();
  const { status, failed, busy, refresh } = useDatabaseStorage();
  return <section className="settings-section settings-card database-storage"><div className="storage-heading"><h3>{t("storage.database")}</h3><SettingsButton icon={RefreshCw} aria-label={t("storage.refresh")} title={t("storage.refresh")} disabled={busy} onClick={refresh} /></div>
    {failed && <p className="settings-help warning">{t("storage.databaseFailed")}</p>}
    {status && <><p className="storage-total" title={t("storage.databaseFiles")}><strong>{formatHistoryBytes(status.databaseBytes + status.walBytes + status.shmBytes)}</strong><span className="storage-db-state">{t(status.available ? "storage.databaseReady" : "storage.databaseFailed")}</span></p>
      <dl className="storage-metrics">{([["storage.allUserData", status.logicalBytes], ["storage.backups", status.backupsBytes]] as const).map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{formatHistoryBytes(value)}</dd></div>)}</dl>
      <details className="storage-details"><summary>{t("storage.databaseDetails")}</summary>
      <p className="settings-help">{t("storage.databaseState", { sqlite: status.sqliteVersion, schema: status.schemaVersion, journal: status.journalMode })}</p>
      <dl className="storage-metrics">{([["storage.databaseFile", status.databaseBytes], ["storage.wal", status.walBytes], ["storage.shm", status.shmBytes], ["storage.reusable", status.reusableBytes]] as const).map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{formatHistoryBytes(value)}</dd></div>)}</dl>
      <p className="settings-help">{t("storage.databaseReadOnly")}</p></details>
      <p className="settings-help">{t("storage.updatedAt", { date: formatDateTime(status.checkedAt) })}</p></>}
  </section>;
}
