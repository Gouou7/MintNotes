import { ClockPlus, Ellipsis, Pencil, Shield, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
    "restore-safety": t("history.kindRestoreSafety")
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
  const [menu, setMenu] = useState<{ item: HistoryListItem; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!renamingId) return;
    panel.current?.querySelector<HTMLElement>(`[data-history-id="${renamingId}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [renamingId]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", keydown);
    };
  }, [menu]);
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
      <button disabled={disabled} onClick={onSave}><AppIcon icon={ClockPlus} size={16} />{t("history.saveNow")}</button>
      <button className="history-clear" disabled={disabled || !items.length} onClick={onClear}><AppIcon icon={Trash2} size={16} />{t("history.clearNote")}</button>
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
            <small>{timeFormatter.format(new Date(item.capturedAt))} · {kindLabel(item.captureKind, t)}{item.pending ? ` · ${t("history.pending")}` : ""}</small>
          </span>;
          return <div className={`history-row ${selectedId === item.historyId ? "active" : ""}`} data-history-id={item.historyId} key={item.historyId} onContextMenu={(event) => {
            if (renamingId === item.historyId) return;
            event.preventDefault();
            setMenu({ item, x: event.clientX, y: event.clientY });
          }}>
            {renaming
              ? <div className="history-select history-renaming">{details}</div>
              : <button className="history-select" onClick={() => onSelect(item)}>{details}</button>}
            {item.protected && <span className="history-protection" title={t("history.protectedBadge")}>
              <AppIcon icon={Shield} size={16} />
              <span className="sr-only">{t("history.protectedBadge")}</span>
            </span>}
            <button className="history-actions" onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ item, x: rect.right, y: rect.bottom });
            }} title={t("history.openMenu")} aria-label={t("history.openMenu")}><AppIcon icon={Ellipsis} size={16} /></button>
          </div>;
        })}
      </section>)}
      {!items.length && !loading && <p className="outline-empty">{t("history.empty")}</p>}
      {loading && <p className="history-loading">{t("history.loading")}</p>}
      {hasMore && !loading && <button className="history-more" onClick={onLoadMore}>{t("history.loadMore")}</button>}
    </div>
    {/* Keep viewport positioning outside the sidebar's transform and clipping, while inheriting workspace styles. */}
    {menu && createPortal(<div className="context-menu history-context-menu" style={{
      left: Math.min(menu.x, window.innerWidth - 214),
      top: Math.min(menu.y, window.innerHeight - 150)
    }} onPointerDown={(event) => event.stopPropagation()}>
      <button onClick={() => { setMenu(null); onBeginRename(menu.item); }}><AppIcon icon={Pencil} size={16} strokeWidth={1.5} />{t("history.rename")}</button>
      <button onClick={() => { setMenu(null); onToggleProtection(menu.item); }}><AppIcon icon={menu.item.protected ? ShieldOff : ShieldCheck} size={16} strokeWidth={1.5} />{menu.item.protected ? t("history.unprotect") : t("history.protect")}</button>
      <hr />
      <button className="danger" disabled={!canDeleteHistory(menu.item)} title={menu.item.protected ? t("history.protectedDeleteHint") : undefined} onClick={() => { setMenu(null); onDelete(menu.item); }}><AppIcon icon={Trash2} size={16} strokeWidth={1.5} />{t("history.deleteOne")}</button>
    </div>, panel.current?.closest(".app-shell") ?? document.body)}
  </div>;
}
