import { RefreshCw, ShieldCheck } from "lucide-react";
import { SettingsButton } from "../components/SettingsButton";
import { useI18n } from "../i18n";
import { formatHistoryBytes } from "./history";
import { capacityLevel } from "../storage/storageStatus";
import type { StorageStatus } from "./storage/useStorageStatus";
export interface PhysicalStorageUsage { databaseBytes: number; walBytes: number; backupsBytes: number; shmBytes?: number; }
export function PhysicalStorage({ usage }: { usage: PhysicalStorageUsage }) {
  const { t } = useI18n();
  return <div><p className="settings-help">{t("storage.physicalHelp")}</p><p>{t("storage.database")}: {formatHistoryBytes(usage.databaseBytes)} · WAL: {formatHistoryBytes(usage.walBytes)} · {t("storage.backups")}: {formatHistoryBytes(usage.backupsBytes)}</p></div>;
}
export function PendingStorage({ status }: { status: StorageStatus }) {
  const { t } = useI18n();
  if (!status.localReady) return <p className="settings-help">{t("storage.pendingUnknown")}</p>;
  return <dl className="storage-pending storage-metrics">
    <div><dt>{t("storage.pending")}</dt><dd className="storage-pending-counts" aria-label={t("storage.pendingCounts", { objects: status.local.objects, attachments: status.local.attachments, history: status.local.history })}>
      {([["storage.objects", status.local.objects], ["storage.attachments", status.local.attachments], ["settings.history", status.local.history]] as const).map(([label, count]) => <span className="storage-pending-item" key={label}><span>{t(label)}</span>{" "}<strong>{count}</strong></span>)}
    </dd></div>
    <div><dt>{t("storage.unsaved")}</dt><dd className={status.unsaved ? "storage-capacity warning" : undefined}>{t("storage.noteCount", { count: status.unsaved })}</dd></div>
  </dl>;
}
export function StorageUsage({ status }: { status: StorageStatus }) {
  const { formatDateTime, t } = useI18n();
  const usage = status.usage;
  const level = usage ? capacityLevel(usage.totalBytes, usage.quotaBytes) : "normal";
  const limit = (bytes: number | null) => bytes === null ? t("storage.unlimited") : formatHistoryBytes(bytes);
  return <section className="settings-section settings-card storage-usage"><div className="storage-heading"><h3>{t("storage.logical")}</h3><SettingsButton icon={RefreshCw} aria-label={t("storage.refresh")} title={t("storage.refresh")} disabled={status.refreshing} onClick={() => void status.refresh()} /></div>
    <div className="storage-overview"><div className="storage-server">
    {usage ? <><p className="storage-total"><strong>{formatHistoryBytes(usage.totalBytes)}</strong><span> / {limit(usage.quotaBytes)}</span></p>
      {usage.quotaBytes !== null && <progress aria-label={t("storage.total")} max={usage.quotaBytes} value={Math.min(usage.totalBytes, usage.quotaBytes)} />}
      {level !== "normal" && level !== "unlimited" && <p className={`storage-capacity ${level}`}>{t(`storage.level.${level}`)}</p>}
      <dl className="storage-metrics storage-categories">{([["storage.notes", usage.noteBytes], ["storage.attachments", usage.attachmentBytes], ["settings.history", usage.historyBytes], ["storage.avatar", usage.profileBytes]] as const).map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{formatHistoryBytes(value)}</dd></div>)}</dl>
      <p className="settings-help storage-summary">{t("storage.trashIncluded", { size: formatHistoryBytes(usage.trashBytes) })}<span>{t(status.stale ? "storage.cachedAt" : "storage.updatedAt", { date: formatDateTime(usage.checkedAt) })}</span></p>
    </> : <p className="settings-help">{t(status.failed ? "storage.unavailable" : "storage.noServerUsage")}</p>}
    </div><div className="storage-local"><h4 className="storage-local-title">{t("storage.local")}</h4>
    <dl className="storage-metrics"><div><dt title={t("storage.cacheHelp")}>{t("storage.localEstimate")}</dt><dd>{formatHistoryBytes(status.local.bytes)}</dd></div>
      <div><dt>{t("storage.lastCompleteSync")}</dt><dd>{status.lastSync ? formatDateTime(status.lastSync) : t("storage.neverSynced")}</dd></div>
    </dl><PendingStorage status={status} />
    <details className="storage-details"><summary>{t("storage.browserStorage")}</summary>
    <dl className="storage-metrics"><div><dt title={t("storage.estimateHelp")}>{t("storage.siteEstimateLabel")}</dt><dd>{status.estimate?.usage !== undefined ? `${formatHistoryBytes(status.estimate.usage)} / ${status.estimate.quota === undefined ? t("storage.unknown") : formatHistoryBytes(status.estimate.quota)}` : t("storage.unknown")}</dd></div></dl>
    <div className="storage-persistence"><span className="settings-help" title={t("storage.persistenceHelp")}>{t(`storage.persistence.${status.persistence}`)}</span>
      <SettingsButton icon={ShieldCheck} disabled={status.persistence === "unsupported" || status.persistence === "granted"} onClick={() => void status.requestPersistence()}>{t("storage.requestPersistence")}</SettingsButton></div></details>
    </div></div>
  </section>;
}
