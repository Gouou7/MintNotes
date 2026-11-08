import { Button } from "@/components/ui/button";
import { ClockPlus, Ellipsis, Pencil, Shield, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { RowActionMenu } from "./RowActionMenu";
import { useI18n } from "../i18n";
import { canDeleteHistory } from "../features/history";
import type { HistoryCaptureKind, HistoryListItem } from "../types";
import { AppIcon } from "./AppIcon";
import { TreeRenameInput } from "./TreeRenameInput";

interface Props {
  items: HistoryListItem[];
  selectedId: string | null;
  loading: boolean;
  hasMore: boolean;
  disabled: boolean;
  renamingId: string | null;
  onSelect: (item: HistoryListItem) => void;
  onSave: () => void;
  onBeginRename: (item: HistoryListItem) => void;
  onRename: (item: HistoryListItem, name: string) => void;
  onRenameCancel: () => void;
  onToggleProtection: (item: HistoryListItem) => void;
  onDelete: (item: HistoryListItem) => void;
  onClear: () => void;
  onLoadMore: () => void;
}

function kindLabel(kind: HistoryCaptureKind, t: ReturnType<typeof useI18n>["t"]): string {
  return ({
    baseline: t("history.kindBaseline"),
    interval: t("history.kindInterval"),
    idle: t("history.kindIdle"),
    manual: t("history.kindManual"),
    "restore-safety": t("history.kindRestoreSafety"),
    "application-edit": t("history.kindApplicationEdit")
  })[kind];
}

export function HistoryPanel({
  items,
  selectedId,
  loading,
  hasMore,
  disabled,
  renamingId,
  onSelect,
  onSave,
  onBeginRename,
  onRename,
  onRenameCancel,
  onToggleProtection,
  onDelete,
  onClear,
  onLoadMore
}: Props) {
  const { formatDateTime, locale, t } = useI18n();
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }), [locale]);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!renamingId) return;
    panel.current?.querySelector<HTMLElement>(`[data-history-id="${renamingId}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [renamingId]);
  const groups = useMemo(() => {
    const result: Array<{ day: string; items: HistoryListItem[] }> = [];
    for (const item of items) {
      const date = new Date(item.capturedAt);
      const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
      const group = result.at(-1);
      if (group?.day === day) group.items.push(item);
      else result.push({ day, items: [item] });
    }
    return result;
  }, [items]);

  return <div className="history-panel" ref={panel}>
    <div className="history-panel-actions">
      <Button disabled={disabled} onClick={onSave}><AppIcon icon={ClockPlus} data-icon="inline-start" />{t("history.saveNow")}</Button>
      <Button variant="destructive" disabled={disabled || !items.length} onClick={onClear}><AppIcon icon={Trash2} data-icon="inline-start" />{t("history.clearNote")}</Button>
    </div>
    <div className="history-list" aria-label={t("history.list")}>
      {groups.map((group) => <section className="history-day" key={group.day}>
        <h3>{group.day}</h3>
        {group.items.map((item) => {
          const name = item.name || formatDateTime(item.capturedAt);
          const renaming = renamingId === item.historyId;
          const details = <span>
            {renaming
              ? <TreeRenameInput className="history-rename-input" initialValue={name} label={t("history.rename")} onCommit={(name) => onRename(item, name)} onCancel={onRenameCancel} />
              : <strong>{name}</strong>}
            <small>{timeFormatter.format(new Date(item.capturedAt))} · {kindLabel(item.captureKind, t)}{item.pending ? ` · ${t("history.pending")}` : ` · ${t(item.offlineAvailable ? "history.offlineAvailable" : "history.downloadRequired")}`}</small>
          </span>;
          return <RowActionMenu key={item.historyId} contextDisabled={renaming} className="context-menu history-context-menu"
            trigger={<Button variant="ghost" size="icon" className="history-actions" title={t("history.openMenu")} aria-label={t("history.openMenu")}><AppIcon icon={Ellipsis} /></Button>}
            items={(Item, Separator) => <>
              <Item onClick={() => onBeginRename(item)}><AppIcon icon={Pencil} />{t("history.rename")}</Item>
              <Item onClick={() => onToggleProtection(item)}><AppIcon icon={item.protected ? ShieldOff : ShieldCheck} />{t(item.protected ? "history.unprotect" : "history.protect")}</Item>
              <Separator />
              <Item variant="destructive" disabled={!canDeleteHistory(item)} title={item.protected ? t("history.protectedDeleteHint") : undefined} onClick={() => onDelete(item)}><AppIcon icon={Trash2} />{t("history.deleteOne")}</Item>
            </>}
            row={(more) => <div className={`history-row ${selectedId === item.historyId ? "active" : ""}`} data-history-id={item.historyId}>
              {renaming
                ? <div className="history-select history-renaming">{details}</div>
                : <Button variant="ghost" className="history-select" onClick={() => onSelect(item)}>{details}</Button>}
              {item.protected && <span className="history-protection" title={t("history.protectedBadge")}>
                <AppIcon icon={Shield} size={16} />
                <span className="sr-only">{t("history.protectedBadge")}</span>
              </span>}
              {more}
            </div>} />;
        })}
      </section>)}
      {!items.length && !loading && <p className="outline-empty">{t("history.empty")}</p>}
      {loading && <p className="history-loading">{t("history.loading")}</p>}
      {hasMore && !loading && <Button variant="outline" className="w-full" onClick={onLoadMore}>{t("history.loadMore")}</Button>}
    </div>
  </div>;
}
