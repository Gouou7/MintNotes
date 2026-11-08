import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select } from "@/components/ui/select";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsItem } from "../../components/SettingsItem";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsUp, Ellipsis, FileText, Folder, RotateCcw, Search, Trash2 } from "lucide-react";
import { AppIcon } from "../../components/AppIcon";
import { RowActionMenu } from "../../components/RowActionMenu";
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
    <Item className="trash-row settings-list-row">
      <ItemMedia className="trash-item-icon settings-list-icon">
        {children.length ? (forceExpanded
          ? <span className="trash-disclosure forced" aria-hidden="true"><AppIcon icon={ChevronDown} size={15} /></span>
          : <Button variant="ghost" size="icon-xs" className="trash-disclosure" aria-expanded={expanded} onClick={() => onToggle(item.objectId)} title={t(expanded ? "settings.collapseFolder" : "settings.expandFolder", { title })} aria-label={t(expanded ? "settings.collapseFolder" : "settings.expandFolder", { title })}><AppIcon icon={expanded ? ChevronDown : ChevronRight} size={15} /></Button>)
          : null}
        <AppIcon icon={item.kind === "folder" ? Folder : FileText} size={20} />
      </ItemMedia>
      <ItemContent className="trash-details settings-list-details"><strong>{title}</strong><small>{item.kind === "folder" ? t("settings.folder") : t("settings.note")}{item.kind === "folder" && descendantCount > 0 ? ` · ${t("settings.containsItems", { count: descendantCount })}` : ""} · {t("settings.deletedAt", { date: formatDateTime(item.serverTrashedAt ?? item.updatedAt) })}</small></ItemContent>
      {root && <RowActionMenu contextDisabled
        row={(more) => <span className="trash-actions settings-list-actions">
          <SettingsButton icon={RotateCcw} iconOnly disabled={restoring === item.objectId || purging} onClick={() => onRestore(item)} title={t("settings.restore")} aria-label={t("settings.restoreItem", { title })} />
          {more}
        </span>}
        trigger={<Button variant="ghost" size="icon" className="trash-more" title={t("settings.moreActions")} aria-label={t("settings.moreActionsFor", { title })}><AppIcon icon={Ellipsis} /></Button>}
        items={(MenuItem) => <MenuItem variant="destructive" disabled={purging} onClick={() => onPurge(item.objectId)}><AppIcon icon={Trash2} />{t("settings.permanentDelete")}</MenuItem>}
      />}
    </Item>
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
            return <SettingsSection title={t("settings.trash")} className="trash-settings">
              <SettingsItem title={t("settings.autoDelete")} description={t("settings.trashHelp")}>{(control) => <Select {...control} disabled={busy || !serverSessionVerified}
                value={trashRetentionDays ?? "never"} items={[
                  ...[7, 30, 90, 180, 365].map((days) => ({ value: days, label: t(days === 30 ? "settings.daysDefault" : "settings.days", { count: days }) })),
                  { value: "never", label: t("settings.keepForever") }
                ]} onValueChange={(days) => void updateTrashRetention(days === "never" ? null : days)} />}</SettingsItem>
              <SettingsItem title={t("settings.deletedItems")} description={trashItems.length > 0 ? (trashView.filtering ? t("settings.trashFilterSummary", { count: trashView.matchCount }) : t("settings.trashSummary", { roots: trashView.roots.length, total: trashItems.length })) : undefined}>
                {trashItems.length > 0 && <>{expandedTrashIds.size > 0 && !trashView.filtering && <SettingsButton icon={ChevronsUp} onClick={() => setExpandedTrashIds(new Set())}>{t("settings.collapseAll")}</SettingsButton>}<SettingsButton icon={Trash2} variant="destructive" disabled={purging} onClick={onClearTrash}>{purging ? t("settings.clearingTrash") : t("settings.clearTrash")}</SettingsButton></>}
              </SettingsItem>
              {trashItems.length > 0 && <div className="trash-toolbar">
                <InputGroup className="trash-search"><InputGroupAddon><AppIcon icon={Search} /></InputGroupAddon><InputGroupInput type="search" value={trashQuery} onChange={(event) => setTrashQuery(event.target.value)} placeholder={t("settings.searchTrash")} aria-label={t("settings.searchTrash")} /></InputGroup>
                <Select value={trashKindFilter} onValueChange={setTrashKindFilter} aria-label={t("settings.trashTypeFilter")} items={[
                  { value: "all", label: t("settings.allTypes") },
                  { value: "folder", label: t("settings.foldersOnly") },
                  { value: "note", label: t("settings.notesOnly") }
                ]} />
                <Select value={trashSortMode} onValueChange={setTrashSortMode} aria-label={t("settings.trashSort")} items={[
                  { value: "deleted-desc", label: t("settings.deletedNewest") },
                  { value: "deleted-asc", label: t("settings.deletedOldest") },
                  { value: "name", label: t("settings.sortByName") }
                ]} />
              </div>}
              {visibleTrashRoots.length ? <><div className="trash-list settings-list" role="tree">{visibleTrashRoots.map((item) => <TrashBranch key={item.objectId} item={item} childrenByParent={trashView.childrenByParent} descendantCounts={trashView.descendantCounts} expandedIds={expandedTrashIds} automaticallyExpandedIds={trashView.automaticallyExpandedIds} root restoring={restoringTrashId} purging={purging} onToggle={toggleTrashFolder} onRestore={(entry) => void restoreTrashItem(entry)} onPurge={onPurgeTrash} />)}</div>{visibleTrashRootCount < trashView.roots.length && <SettingsButton icon={ChevronDown} className="trash-load-more" onClick={() => setVisibleTrashRootCount((count) => count + TRASH_PAGE_SIZE)}>{t("settings.showMore", { count: Math.min(TRASH_PAGE_SIZE, trashView.roots.length - visibleTrashRootCount) })}</SettingsButton>}</> : <p className="trash-empty">{trashItems.length ? t("settings.noTrashMatches") : t("settings.trashEmpty")}</p>}
            </SettingsSection>;
}
