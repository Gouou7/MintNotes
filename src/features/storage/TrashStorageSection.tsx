import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsUp, Ellipsis, FileText, Folder, RotateCcw, Search, Trash2 } from "lucide-react";
import { AppIcon } from "../../components/AppIcon";
import { SettingsButton } from "../../components/SettingsButton";
import { translateError, useI18n } from "../../i18n";
import type { ToastTone } from "../../components/Toast";
import type { OpenDocument } from "../../types";
import { createTrashView, type TrashKindFilter, type TrashSortMode } from "../trashView";
const TRASH_PAGE_SIZE = 30;

function TrashBranch({ item, childrenByParent, descendantCounts, expandedIds, automaticallyExpandedIds, root, restoring, purging, onToggle, onRestore, onPurge }: {
  item: OpenDocument;
  childrenByParent: Map<string, OpenDocument[]>;
  descendantCounts: Map<string, number>;
  expandedIds: Set<string>;
  automaticallyExpandedIds: Set<string>;
  root: boolean;
  restoring: string;
  purging: boolean;
  onToggle: (objectId: string) => void;
  onRestore: (item: OpenDocument) => void;
  onPurge: (objectId: string) => void;
}): ReactNode {
  const { formatDateTime, t } = useI18n();
  const children = childrenByParent.get(item.objectId) ?? [];
  const descendantCount = descendantCounts.get(item.objectId) ?? 0;
  const forceExpanded = automaticallyExpandedIds.has(item.objectId);
  const expanded = children.length > 0 && (forceExpanded || expandedIds.has(item.objectId));
  const title = item.title || t("settings.untitled");
  return <div className="trash-node" role="treeitem" aria-expanded={children.length ? expanded : undefined}>
    <div className="trash-row">
      {children.length ? (forceExpanded
        ? <span className="trash-disclosure forced" aria-hidden="true"><AppIcon icon={ChevronDown} size={15} /></span>
        : <button className="trash-disclosure" onClick={() => onToggle(item.objectId)} title={t(expanded ? "settings.collapseFolder" : "settings.expandFolder", { title })} aria-label={t(expanded ? "settings.collapseFolder" : "settings.expandFolder", { title })}><AppIcon icon={expanded ? ChevronDown : ChevronRight} size={15} /></button>)
        : <span className="trash-disclosure-spacer" />}
      <span className="trash-item-icon"><AppIcon icon={item.kind === "folder" ? Folder : FileText} size={18} /></span>
      <span className="trash-details"><strong>{title}</strong><small>{item.kind === "folder" ? t("settings.folder") : t("settings.note")}{item.kind === "folder" && descendantCount > 0 ? ` · ${t("settings.containsItems", { count: descendantCount })}` : ""} · {t("settings.deletedAt", { date: formatDateTime(item.serverTrashedAt ?? item.updatedAt) })}</small></span>
      {root && <span className="trash-actions"><SettingsButton icon={RotateCcw} iconOnly disabled={restoring === item.objectId || purging} onClick={() => onRestore(item)} title={t("settings.restore")} aria-label={t("settings.restoreItem", { title })} /><details className="trash-more"><summary title={t("settings.moreActions")} aria-label={t("settings.moreActionsFor", { title })}><AppIcon icon={Ellipsis} size={17} /></summary><div><SettingsButton icon={Trash2} className="danger" disabled={purging} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onPurge(item.objectId); }}>{t("settings.permanentDelete")}</SettingsButton></div></details></span>}
    </div>
    {expanded && <div className="trash-children" role="group">{children.map((child) => <TrashBranch key={child.objectId} item={child} childrenByParent={childrenByParent} descendantCounts={descendantCounts} expandedIds={expandedIds} automaticallyExpandedIds={automaticallyExpandedIds} root={false} restoring={restoring} purging={purging} onToggle={onToggle} onRestore={onRestore} onPurge={onPurge} />)}</div>}
  </div>;
}

export function TrashStorageSection({ trashItems, busy, purging, serverSessionVerified, trashRetentionDays, updateTrashRetention, onRestoreTrash, onPurgeTrash, onClearTrash, onNotify }: {
  trashItems: OpenDocument[]; busy: boolean; purging: boolean; serverSessionVerified: boolean; trashRetentionDays: number | null;
  updateTrashRetention: (days: number | null) => Promise<void>; onRestoreTrash: (id: string) => Promise<void>;
  onPurgeTrash: (id: string) => void; onClearTrash: () => void; onNotify: (text: string, tone: ToastTone) => void;
}) {
 const { t } = useI18n();
  const [restoringTrashId, setRestoringTrashId] = useState("");
  const [trashQuery, setTrashQuery] = useState("");
  const [trashKindFilter, setTrashKindFilter] = useState<TrashKindFilter>("all");
  const [trashSortMode, setTrashSortMode] = useState<TrashSortMode>("deleted-desc");
  const [expandedTrashIds, setExpandedTrashIds] = useState<Set<string>>(() => new Set());
  const [visibleTrashRootCount, setVisibleTrashRootCount] = useState(TRASH_PAGE_SIZE);
  const restoreTrashItem = async (item: OpenDocument) => {
    setRestoringTrashId(item.objectId);
    try {
      await onRestoreTrash(item.objectId);
      onNotify(t("notice.itemRestored", { title: item.title }), "info");
    } catch (value) {
      onNotify(value instanceof Error ? translateError(value, t, "notice.itemRestoreFailed") : t("notice.itemRestoreFailed", { title: item.title }), "warning");
    }
    finally { setRestoringTrashId(""); }
  };

  const trashView = useMemo(
    () => createTrashView(trashItems, trashQuery, trashKindFilter, trashSortMode),
    [trashItems, trashQuery, trashKindFilter, trashSortMode]
  );
  const visibleTrashRoots = trashView.roots.slice(0, visibleTrashRootCount);
  useEffect(() => setVisibleTrashRootCount(TRASH_PAGE_SIZE), [trashQuery, trashKindFilter, trashSortMode]);
  useEffect(() => setExpandedTrashIds((current) => {
    const validIds = new Set(trashItems.map((item) => item.objectId));
    if ([...current].every((objectId) => validIds.has(objectId))) return current;
    return new Set([...current].filter((objectId) => validIds.has(objectId)));
  }), [trashItems]);
  const toggleTrashFolder = (objectId: string) => setExpandedTrashIds((current) => {
    const next = new Set(current);
    if (next.has(objectId)) next.delete(objectId);
    else next.add(objectId);
    return next;
  });
            return <div className="settings-section settings-card trash-settings">
              <h3>{t("settings.trash")}</h3><p className="settings-help">{t("settings.trashHelp")}</p>
              <label className="settings-control-row"><span>{t("settings.autoDelete")}</span><select disabled={busy || !serverSessionVerified} value={trashRetentionDays === null ? "never" : String(trashRetentionDays)} onChange={(event) => void updateTrashRetention(event.target.value === "never" ? null : Number(event.target.value))}>{[7, 30, 90, 180, 365].map((days) => <option key={days} value={days}>{t(days === 30 ? "settings.daysDefault" : "settings.days", { count: days })}</option>)}<option value="never">{t("settings.keepForever")}</option></select></label>
              <div className="trash-heading"><span><h3>{t("settings.deletedItems")}</h3>{trashItems.length > 0 && <small>{trashView.filtering ? t("settings.trashFilterSummary", { count: trashView.matchCount }) : t("settings.trashSummary", { roots: trashView.roots.length, total: trashItems.length })}</small>}</span>{trashItems.length > 0 && <span className="trash-heading-actions">{expandedTrashIds.size > 0 && !trashView.filtering && <SettingsButton icon={ChevronsUp} className="trash-collapse-all" onClick={() => setExpandedTrashIds(new Set())}>{t("settings.collapseAll")}</SettingsButton>}<SettingsButton icon={Trash2} className="trash-clear danger" disabled={purging} onClick={onClearTrash}>{purging ? t("settings.clearingTrash") : t("settings.clearTrash")}</SettingsButton></span>}</div>
              {trashItems.length > 0 && <div className="trash-toolbar">
                <label className="trash-search"><AppIcon icon={Search} size={16} /><input type="search" value={trashQuery} onChange={(event) => setTrashQuery(event.target.value)} placeholder={t("settings.searchTrash")} aria-label={t("settings.searchTrash")} /></label>
                <select value={trashKindFilter} onChange={(event) => setTrashKindFilter(event.target.value as TrashKindFilter)} aria-label={t("settings.trashTypeFilter")}><option value="all">{t("settings.allTypes")}</option><option value="folder">{t("settings.foldersOnly")}</option><option value="note">{t("settings.notesOnly")}</option></select>
                <select value={trashSortMode} onChange={(event) => setTrashSortMode(event.target.value as TrashSortMode)} aria-label={t("settings.trashSort")}><option value="deleted-desc">{t("settings.deletedNewest")}</option><option value="deleted-asc">{t("settings.deletedOldest")}</option><option value="name">{t("settings.sortByName")}</option></select>
              </div>}
              {visibleTrashRoots.length ? <><div className="trash-list" role="tree">{visibleTrashRoots.map((item) => <TrashBranch key={item.objectId} item={item} childrenByParent={trashView.childrenByParent} descendantCounts={trashView.descendantCounts} expandedIds={expandedTrashIds} automaticallyExpandedIds={trashView.automaticallyExpandedIds} root restoring={restoringTrashId} purging={purging} onToggle={toggleTrashFolder} onRestore={(entry) => void restoreTrashItem(entry)} onPurge={onPurgeTrash} />)}</div>{visibleTrashRootCount < trashView.roots.length && <SettingsButton icon={ChevronDown} className="trash-load-more" onClick={() => setVisibleTrashRootCount((count) => count + TRASH_PAGE_SIZE)}>{t("settings.showMore", { count: Math.min(TRASH_PAGE_SIZE, trashView.roots.length - visibleTrashRootCount) })}</SettingsButton>}</> : <p className="trash-empty">{trashItems.length ? t("settings.noTrashMatches") : t("settings.trashEmpty")}</p>}
            </div>;
}
