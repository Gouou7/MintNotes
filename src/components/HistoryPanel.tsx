import { Clock3, RotateCcw, Save, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useI18n } from "../i18n";
import type { HistoryCaptureKind, HistoryListItem } from "../types";
import { AppIcon } from "./AppIcon";

interface Props {
  items: HistoryListItem[];
  selectedId: string | null;
  loading: boolean;
  hasMore: boolean;
  disabled: boolean;
  onSelect: (item: HistoryListItem) => void;
  onSave: () => void;
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
    "restore-safety": t("history.kindRestoreSafety")
  })[kind];
}

export function HistoryPanel({
  items,
  selectedId,
  loading,
  hasMore,
  disabled,
  onSelect,
  onSave,
  onDelete,
  onClear,
  onLoadMore
}: Props) {
  const { formatDateTime, t } = useI18n();
  const groups = useMemo(() => {
    const result: Array<{ day: string; items: HistoryListItem[] }> = [];
    for (const item of items) {
      const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(item.capturedAt));
      const group = result.at(-1);
      if (group?.day === day) group.items.push(item);
      else result.push({ day, items: [item] });
    }
    return result;
  }, [items]);

  return <div className="history-panel">
    <div className="history-panel-actions">
      <button disabled={disabled} onClick={onSave}><AppIcon icon={Save} size={15} />{t("history.saveNow")}</button>
      <button className="history-clear" disabled={disabled || !items.length} onClick={onClear} title={t("history.clearNote")} aria-label={t("history.clearNote")}><AppIcon icon={Trash2} size={15} /></button>
    </div>
    <div className="history-list" aria-label={t("history.list")}>
      {groups.map((group) => <section className="history-day" key={group.day}>
        <h3>{group.day}</h3>
        {group.items.map((item) => <div className={`history-row ${selectedId === item.historyId ? "active" : ""}`} key={item.historyId}>
          <button className="history-select" onClick={() => onSelect(item)}>
            <span className="history-row-icon"><AppIcon icon={item.captureKind === "restore-safety" ? RotateCcw : Clock3} size={15} /></span>
            <span><strong>{formatDateTime(item.capturedAt)}</strong><small>{kindLabel(item.captureKind, t)}{item.pending ? ` · ${t("history.pending")}` : ""}</small></span>
          </button>
          <button className="history-delete" onClick={() => onDelete(item)} title={t("history.deleteOne")} aria-label={t("history.deleteOne")}><AppIcon icon={Trash2} size={14} /></button>
        </div>)}
      </section>)}
      {!items.length && !loading && <p className="outline-empty">{t("history.empty")}</p>}
      {loading && <p className="history-loading">{t("history.loading")}</p>}
      {hasMore && !loading && <button className="history-more" onClick={onLoadMore}>{t("history.loadMore")}</button>}
    </div>
  </div>;
}
