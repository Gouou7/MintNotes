import type { ReactNode, RefObject } from "react";
import { ArrowDownToDot, ChevronsDownUp, FolderPlus, History, List, ListOrdered, LockKeyhole, PanelLeftClose, PanelRightClose, Search, Settings, SquarePen, X } from "lucide-react";
import { AppIcon } from "../../components/AppIcon";
import { useI18n } from "../../i18n";
import type { UiPreferences } from "../../types";

interface WorkspaceSidebarProps {
  searchInput: RefObject<HTMLInputElement | null>;
  search: string;
  onSearchChange: (value: string) => void;
  onCreate: (kind: "note" | "folder") => void;
  sortMode: UiPreferences["sortMode"];
  onSortChange: (value: UiPreferences["sortMode"]) => void;
  canLocate: boolean;
  onLocate: () => void;
  onCollapseAll: () => void;
  onCollapse: () => void;
  onClose: () => void;
  pinned: ReactNode;
  children: ReactNode;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  onLock: () => void;
  onSettings: () => void;
}

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const { t } = useI18n();
  return <aside className="tree-pane">
    <header className="side-header">
      <img className="brand-small" src="/icon.svg" alt="" aria-hidden="true" />
      <strong>Mint Notes</strong>
      <button className="tree-pane-collapse" onClick={props.onCollapse} title={t("app.collapseDirectory")} aria-label={t("app.collapseDirectory")}><AppIcon icon={PanelLeftClose} size={16} /></button>
      <button className="mobile-tree-close" onClick={props.onClose} title={t("app.closeDirectory")} aria-label={t("app.closeDirectory")}><AppIcon icon={PanelLeftClose} size={16} /></button>
    </header>
    <div className="search-box">
      <AppIcon icon={Search} size={20} />
      <input ref={props.searchInput} value={props.search} onChange={event => props.onSearchChange(event.target.value)} placeholder={t("app.search")} aria-label={t("app.search")} />
      {props.search && <button className="search-clear" onClick={() => { props.onSearchChange(""); props.searchInput.current?.focus(); }} title={t("app.clearSearch")} aria-label={t("app.clearSearch")}><AppIcon icon={X} size={16} /></button>}
    </div>
    <nav className="tree-actions" aria-label={t("app.noteActions")}>
      <button onClick={() => props.onCreate("note")} title={t("app.newNote")} aria-label={t("app.newNote")}><AppIcon icon={SquarePen} size={16} /></button>
      <button onClick={() => props.onCreate("folder")} title={t("app.createFolder")} aria-label={t("app.createFolder")}><AppIcon icon={FolderPlus} size={16} /></button>
      <span className="tree-view-actions">
        <label className="tree-sort-action" title={t("app.sort")}><AppIcon icon={ListOrdered} size={16} /><select value={props.sortMode} onChange={event => props.onSortChange(event.target.value as UiPreferences["sortMode"])} aria-label={t("app.sort")}><option value="alphabetical">A–Z</option><option value="created">{t("app.sortCreated")}</option><option value="updated">{t("app.sortUpdated")}</option><option value="manual">{t("app.sortManual")}</option></select></label>
        <button disabled={!props.canLocate} onClick={props.onLocate} title={t("app.locateCurrent")} aria-label={t("app.locateCurrent")}><AppIcon icon={ArrowDownToDot} size={16} /></button>
        <button onClick={props.onCollapseAll} title={t("app.collapseAll")} aria-label={t("app.collapseAll")}><AppIcon icon={ChevronsDownUp} size={16} /></button>
      </span>
    </nav>
    {props.pinned}
    {props.children}
    <footer className="side-footer">
      <div className="sidebar-user" title={`@${props.username}`}>
        <span className="sidebar-avatar" aria-hidden="true">{props.avatarUrl ? <img src={props.avatarUrl} alt="" /> : (props.displayName.trim().charAt(0).toLocaleUpperCase() || props.username.charAt(0).toLocaleUpperCase())}</span>
        <span className="sidebar-user-name"><strong>{props.displayName}</strong><small>@{props.username}</small></span>
      </div>
      <div className="side-footer-actions">
        <button onClick={props.onLock} title={t("app.lock")} aria-label={t("app.lock")}><AppIcon icon={LockKeyhole} size={16} /></button>
        <button onClick={props.onSettings} title={t("settings.title")} aria-label={t("settings.title")}><AppIcon icon={Settings} size={16} /></button>
      </div>
    </footer>
  </aside>;
}

export function WorkspacePanelHeader({ tab, onTabChange, onCollapse, onClose }: {
  tab: UiPreferences["rightPanelTab"];
  onTabChange: (tab: UiPreferences["rightPanelTab"]) => void;
  onCollapse: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return <header className="side-header right-panel-header">
    <nav className="right-panel-tabs" aria-label={t("app.rightPanel")}>
      <button className={tab === "outline" ? "active" : ""} aria-current={tab === "outline" ? "page" : undefined} onClick={() => onTabChange("outline")} title={t("app.outline")} aria-label={t("app.outline")}><AppIcon icon={List} size={16} /></button>
      <button className={tab === "history" ? "active" : ""} aria-current={tab === "history" ? "page" : undefined} onClick={() => onTabChange("history")} title={t("history.title")} aria-label={t("history.title")}><AppIcon icon={History} size={16} /></button>
    </nav>
    <button className="right-pane-collapse" onClick={onCollapse} title={t("app.collapseRight")} aria-label={t("app.collapseRight")}><AppIcon icon={PanelRightClose} size={16} /></button>
    <button className="mobile-outline-close" onClick={onClose} title={t("app.closeRight")} aria-label={t("app.closeRight")}><AppIcon icon={PanelRightClose} size={16} /></button>
  </header>;
}
