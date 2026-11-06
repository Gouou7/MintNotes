import { useWorkspaceServices } from "../session/workspaceServices";
import { SettingsSection } from "../../components/SettingsSection";
import { useEffect, useState } from "react";
import { Archive, CircleAlert, CircleCheck, Database, Files, RefreshCw } from "lucide-react";
import { AppIcon } from "../../components/AppIcon";
import { SettingsButton } from "../../components/SettingsButton";
import { useI18n } from "../../i18n";
import { formatHistoryBytes } from "../history";
import { StorageBreakdown } from "./StorageBreakdown";
interface DatabaseStatus {
  databaseBytes: number; walBytes: number; shmBytes: number; backupsBytes: number; reusableBytes: number; logicalBytes: number;
  userCount: number; sqliteVersion: string; schemaVersion: number; journalMode: string; checkedAt: string; available: boolean;
}
function useDatabaseStorage() {
  const { transport: { api } } = useWorkspaceServices();
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
  const totalBytes = status ? status.databaseBytes + status.walBytes + status.shmBytes : 0;
  return <SettingsSection title={t("storage.database")} className="database-storage">
    <div className="storage-heading database-heading">
      <span className="storage-section-label"><AppIcon icon={Database} size={17} />{t("storage.databaseFiles")}</span>
      <div className="database-actions">
        {status && !failed && <span className={`storage-db-state${status.available ? "" : " warning"}`}><AppIcon icon={status.available ? CircleCheck : CircleAlert} size={15} />{t(status.available ? "storage.databaseReady" : "storage.databaseFailed")}</span>}
        <SettingsButton icon={RefreshCw} iconOnly aria-label={t("storage.refresh")} title={t("storage.refresh")} disabled={busy} onClick={refresh} />
      </div>
    </div>
    {failed && <p className="settings-help warning">{t("storage.databaseFailed")}</p>}
    {status && <><div className="storage-overview database-overview">
      <div className="storage-server">
        <p className="storage-total"><strong>{formatHistoryBytes(totalBytes)}</strong></p>
        <StorageBreakdown label={t("storage.breakdown")} totalBytes={totalBytes} categories={[
          { label: t("storage.databaseFile"), bytes: status.databaseBytes, tone: "notes" },
          { label: t("storage.wal"), bytes: status.walBytes, tone: "attachments" },
          { label: t("storage.shm"), bytes: status.shmBytes, tone: "history" },
        ]} />
      </div>
      <dl className="database-supplement">
        <div><dt><AppIcon icon={Files} size={17} />{t("storage.allUserData")}</dt><dd>{formatHistoryBytes(status.logicalBytes)}</dd><dd className="database-metric-help">{t("storage.logicalHelp")}</dd></div>
        <div><dt><AppIcon icon={Archive} size={17} />{t("storage.backups")}</dt><dd>{formatHistoryBytes(status.backupsBytes)}</dd><dd className="database-metric-help">{t("storage.backupsSeparate")}</dd></div>
      </dl>
    </div>
      <details className="storage-details"><summary>{t("storage.databaseDetails")}</summary>
      <p className="settings-help">{t("storage.databaseState", { sqlite: status.sqliteVersion, schema: status.schemaVersion, journal: status.journalMode })}</p>
      <dl className="storage-metrics"><div><dt>{t("storage.reusable")}</dt><dd>{formatHistoryBytes(status.reusableBytes)}</dd></div></dl>
      <p className="settings-help">{t("storage.databaseReadOnly")}</p></details>
      <p className="settings-help storage-summary">{t(failed ? "storage.cachedAt" : "storage.updatedAt", { date: formatDateTime(status.checkedAt) })}</p></>}
  </SettingsSection>;
}
