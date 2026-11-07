import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect } from "@/components/ui/native-select";
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
  onLock?: () => void;
  accountSwitcher?: ReactNode;
  onSettings: () => void;
}

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const { t } = useI18n();
  return <aside className="tree-pane">
    <header className="side-header">
      <img className="brand-small" src="/icon.svg" alt="" aria-hidden="true" />
      <strong>Mint Notes</strong>
      <Button className="tree-pane-collapse" onClick={props.onCollapse} title={t("app.collapseDirectory")} aria-label={t("app.collapseDirectory")}><AppIcon icon={PanelLeftClose} size={16} /></Button>
      <Button className="mobile-tree-close" onClick={props.onClose} title={t("app.closeDirectory")} aria-label={t("app.closeDirectory")}><AppIcon icon={PanelLeftClose} size={16} /></Button>
    </header>
    <InputGroup className="search-box">
      <InputGroupAddon><AppIcon icon={Search} size={20} /></InputGroupAddon>
      <InputGroupInput ref={props.searchInput} value={props.search} onChange={event => props.onSearchChange(event.target.value)} placeholder={t("app.search")} aria-label={t("app.search")} />
      {props.search && <InputGroupAddon align="inline-end"><InputGroupButton className="search-clear" size="icon-xs" onClick={() => { props.onSearchChange(""); props.searchInput.current?.focus(); }} title={t("app.clearSearch")} aria-label={t("app.clearSearch")}><AppIcon icon={X} /></InputGroupButton></InputGroupAddon>}
    </InputGroup>
    <nav className="tree-actions" aria-label={t("app.noteActions")}>
      <Button onClick={() => props.onCreate("note")} title={t("app.newNote")} aria-label={t("app.newNote")}><AppIcon icon={SquarePen} size={16} /></Button>
      <Button onClick={() => props.onCreate("folder")} title={t("app.createFolder")} aria-label={t("app.createFolder")}><AppIcon icon={FolderPlus} size={16} /></Button>
      <span className="tree-view-actions">
        <label className="tree-sort-action" title={t("app.sort")}><AppIcon icon={ListOrdered} size={16} /><NativeSelect value={props.sortMode} onChange={event => props.onSortChange(event.target.value as UiPreferences["sortMode"])} aria-label={t("app.sort")}><option value="alphabetical">A–Z</option><option value="created">{t("app.sortCreated")}</option><option value="updated">{t("app.sortUpdated")}</option><option value="manual">{t("app.sortManual")}</option></NativeSelect></label>
        <Button disabled={!props.canLocate} onClick={props.onLocate} title={t("app.locateCurrent")} aria-label={t("app.locateCurrent")}><AppIcon icon={ArrowDownToDot} size={16} /></Button>
        <Button onClick={props.onCollapseAll} title={t("app.collapseAll")} aria-label={t("app.collapseAll")}><AppIcon icon={ChevronsDownUp} size={16} /></Button>
      </span>
    </nav>
    {props.pinned}
    {props.children}
    <footer className="side-footer">
      <div className="sidebar-user" title={`@${props.username}`}>
        <Avatar className="sidebar-avatar" aria-hidden="true">
          {props.avatarUrl && <AvatarImage src={props.avatarUrl} alt="" />}
          <AvatarFallback>{props.displayName.trim().charAt(0).toLocaleUpperCase() || props.username.charAt(0).toLocaleUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="sidebar-user-name"><strong>{props.displayName}</strong><small>@{props.username}</small></span>
      </div>
      <div className="side-footer-actions">
        {props.onLock && <Button onClick={props.onLock} title={t("app.lock")} aria-label={t("app.lock")}><AppIcon icon={LockKeyhole} size={16} /></Button>}
        {props.accountSwitcher}
        <Button onClick={props.onSettings} title={t("settings.title")} aria-label={t("settings.title")}><AppIcon icon={Settings} size={16} /></Button>
      </div>
    </footer>
  </aside>;
}

export function WorkspacePanelHeader({ tab, onTabChange, onCollapse, onClose, children }: {
  tab: UiPreferences["rightPanelTab"];
  onTabChange: (tab: UiPreferences["rightPanelTab"]) => void;
  onCollapse: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return <Tabs value={tab} onValueChange={(value) => onTabChange(value as UiPreferences["rightPanelTab"])} className="workspace-panel-tabs">
    <header className="side-header right-panel-header">
    <TabsList className="right-panel-tabs" variant="line" aria-label={t("app.rightPanel")}>
      <TabsTrigger value="outline" title={t("app.outline")} aria-label={t("app.outline")}><AppIcon icon={List} /></TabsTrigger>
      <TabsTrigger value="history" title={t("history.title")} aria-label={t("history.title")}><AppIcon icon={History} /></TabsTrigger>
    </TabsList>
    <Button className="right-pane-collapse" onClick={onCollapse} title={t("app.collapseRight")} aria-label={t("app.collapseRight")}><AppIcon icon={PanelRightClose} size={16} /></Button>
    <Button className="mobile-outline-close" onClick={onClose} title={t("app.closeRight")} aria-label={t("app.closeRight")}><AppIcon icon={PanelRightClose} size={16} /></Button>
    </header>
    <TabsContent key={tab} value={tab} className="right-panel-content">{children}</TabsContent>
  </Tabs>;
}
