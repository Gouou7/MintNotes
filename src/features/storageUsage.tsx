import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SettingsSection } from "../components/SettingsSection";
import { SettingsItem } from "../components/SettingsItem";
import { HardDrive, Laptop, RefreshCw, ShieldCheck } from "lucide-react";
import { AppIcon } from "../components/AppIcon";
import { SettingsButton } from "../components/SettingsButton";
import { useI18n } from "../i18n";
import { formatHistoryBytes } from "./history";
import { capacityLevel } from "../storage/storageStatus";
import type { StorageStatus } from "./storage/useStorageStatus";
import { StorageBreakdown } from "./storage/StorageBreakdown";
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
  const active = usage?.activeBytes ?? usage;
  // Older cached responses cannot split trash by type; keep their remaining data in one category.
  const categories = usage ? [
    ...(usage.activeBytes || usage.trashBytes === 0 ? [
      { key: "storage.notes", tone: "notes", bytes: active!.noteBytes },
      { key: "storage.attachments", tone: "attachments", bytes: active!.attachmentBytes },
      { key: "settings.history", tone: "history", bytes: active!.historyBytes },
    ] as const : [{ key: "storage.activeData", tone: "notes", bytes: Math.max(0, usage.totalBytes - usage.profileBytes - usage.trashBytes) }] as const),
    ...(usage.profileBytes > 0 ? [{ key: "storage.avatar", tone: "avatar", bytes: usage.profileBytes }] as const : []),
    { key: "settings.trash", tone: "trash", bytes: usage.trashBytes },
  ] as const : [];
  const refreshButton = <SettingsButton icon={RefreshCw} iconOnly aria-label={t("storage.refresh")} title={t("storage.refresh")} disabled={status.refreshing} onClick={() => void status.refresh()} />;
  return <SettingsSection title={t("storage.logical")} className="storage-usage">
    <div className="storage-overview"><div className="storage-server">
    {usage ? <><div className="storage-heading"><span className="storage-section-label"><AppIcon icon={HardDrive} size={17} />{t("storage.serverUsage")}</span>{refreshButton}</div>
      <div className="storage-total"><strong>{formatHistoryBytes(usage.totalBytes)}</strong><span>{t("storage.quotaLabel", { size: limit(usage.quotaBytes) })}</span></div>
      {usage.quotaBytes !== null && <Progress className={`storage-quota-progress ${level}`} aria-label={t("storage.total")} max={Math.max(1, usage.quotaBytes)} value={Math.min(usage.totalBytes, Math.max(1, usage.quotaBytes))} />}
      {level !== "normal" && level !== "unlimited" && <p className={`storage-capacity ${level}`}>{t(`storage.level.${level}`)}</p>}
      <StorageBreakdown label={t("storage.breakdown")} totalBytes={usage.totalBytes} categories={categories.map(({ key, ...category }) => ({ ...category, label: t(key) }))} />
      <div className="storage-server-footer">
        <p className="settings-help storage-summary">{t(status.stale ? "storage.cachedAt" : "storage.updatedAt", { date: formatDateTime(usage.checkedAt) })}</p>
      </div>
    </> : <div className="settings-card-intro"><p className="settings-help settings-card-description">{t(status.failed ? "storage.unavailable" : "storage.noServerUsage")}</p>{refreshButton}</div>}
    </div><div className="storage-local"><h4 className="storage-local-title storage-section-label"><AppIcon icon={Laptop} size={17} />{t("storage.local")}</h4>
    <dl className="storage-metrics"><div><dt title={t("storage.cacheHelp")}>{t("storage.localEstimate")}</dt><dd>{status.localReady ? formatHistoryBytes(status.local.bytes) : t("storage.unknown")}</dd></div>
      <div><dt>{t("storage.lastCompleteSync")}</dt><dd>{status.lastSync ? formatDateTime(status.lastSync) : t("storage.neverSynced")}</dd></div>
    </dl><PendingStorage status={status} />
    <Collapsible className="storage-details"><CollapsibleTrigger>{t("storage.browserStorage")}</CollapsibleTrigger><CollapsibleContent>
    <dl className="storage-metrics"><div><dt title={t("storage.estimateHelp")}>{t("storage.siteEstimateLabel")}</dt><dd>{status.estimate?.usage !== undefined ? `${formatHistoryBytes(status.estimate.usage)} / ${status.estimate.quota === undefined ? t("storage.unknown") : formatHistoryBytes(status.estimate.quota)}` : t("storage.unknown")}</dd></div></dl>
    <SettingsItem title={t("storage.persistenceLabel")} className="storage-persistence" description={<span title={t("storage.persistenceHelp")}>{t(`storage.persistence.${status.persistence}`)}</span>}>
      <SettingsButton icon={ShieldCheck} disabled={status.persistence === "unsupported" || status.persistence === "granted"} onClick={() => void status.requestPersistence()}>{t("storage.requestPersistence")}</SettingsButton></SettingsItem></CollapsibleContent></Collapsible>
    </div></div>
  </SettingsSection>;
}
