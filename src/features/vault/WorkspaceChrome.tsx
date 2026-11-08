import { Button, buttonVariants } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect } from "@/components/ui/native-select";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import type { ReactNode, RefObject } from "react";
import { ArrowDownToDot, ChevronsDownUp, FolderPlus, ListOrdered, LockKeyhole, PanelLeftClose, PanelRightClose, Search, Settings, SquarePen, X } from "lucide-react";
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
  return <Sidebar className="tree-pane">
    <SidebarHeader className="side-header flex-row">
      <img className="brand-small" src="/icon.svg" alt="" aria-hidden="true" />
      <strong>Mint Notes</strong>
      <Button variant="ghost" size="icon" className="tree-pane-collapse" onClick={props.onCollapse} title={t("app.collapseDirectory")} aria-label={t("app.collapseDirectory")}><AppIcon icon={PanelLeftClose} /></Button>
      <Button variant="ghost" size="icon" className="mobile-tree-close" onClick={props.onClose} title={t("app.closeDirectory")} aria-label={t("app.closeDirectory")}><AppIcon icon={PanelLeftClose} /></Button>
    </SidebarHeader>
    <InputGroup className="search-box">
      <InputGroupAddon><AppIcon icon={Search} /></InputGroupAddon>
      <InputGroupInput ref={props.searchInput} value={props.search} onChange={event => props.onSearchChange(event.target.value)} placeholder={t("app.search")} aria-label={t("app.search")} />
      {props.search && <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" onClick={() => { props.onSearchChange(""); props.searchInput.current?.focus(); }} title={t("app.clearSearch")} aria-label={t("app.clearSearch")}><AppIcon icon={X} /></InputGroupButton></InputGroupAddon>}
    </InputGroup>
    <nav className="tree-actions" aria-label={t("app.noteActions")}>
      <Button variant="ghost" size="icon" onClick={() => props.onCreate("note")} title={t("app.newNote")} aria-label={t("app.newNote")}><AppIcon icon={SquarePen} /></Button>
      <Button variant="ghost" size="icon" onClick={() => props.onCreate("folder")} title={t("app.createFolder")} aria-label={t("app.createFolder")}><AppIcon icon={FolderPlus} /></Button>
      <span className="tree-view-actions">
        <label data-slot="button" className={buttonVariants({ variant: "ghost", size: "icon", className: "tree-sort-action has-[select:focus-visible]:border-ring has-[select:focus-visible]:ring-3 has-[select:focus-visible]:ring-ring/50" })} title={t("app.sort")}><AppIcon icon={ListOrdered} /><NativeSelect value={props.sortMode} onChange={event => props.onSortChange(event.target.value as UiPreferences["sortMode"])} aria-label={t("app.sort")}><option value="alphabetical">A–Z</option><option value="created">{t("app.sortCreated")}</option><option value="updated">{t("app.sortUpdated")}</option><option value="manual">{t("app.sortManual")}</option></NativeSelect></label>
        <Button variant="ghost" size="icon" disabled={!props.canLocate} onClick={props.onLocate} title={t("app.locateCurrent")} aria-label={t("app.locateCurrent")}><AppIcon icon={ArrowDownToDot} /></Button>
        <Button variant="ghost" size="icon" onClick={props.onCollapseAll} title={t("app.collapseAll")} aria-label={t("app.collapseAll")}><AppIcon icon={ChevronsDownUp} /></Button>
      </span>
    </nav>
    {props.pinned}
    {props.children}
    <SidebarFooter className="side-footer flex-row">
      <div className="sidebar-user" title={props.displayName}>
        <Avatar className="sidebar-avatar" aria-hidden="true">
          {props.avatarUrl && <AvatarImage src={props.avatarUrl} alt="" />}
          <AvatarFallback>{props.displayName.trim().charAt(0).toLocaleUpperCase() || props.username.charAt(0).toLocaleUpperCase()}</AvatarFallback>
        </Avatar>
        <strong className="sidebar-user-name">{props.displayName}</strong>
      </div>
      <div className="side-footer-actions">
        {props.onLock && <Button variant="ghost" size="icon" onClick={props.onLock} title={t("app.lock")} aria-label={t("app.lock")}><AppIcon icon={LockKeyhole} /></Button>}
        {props.accountSwitcher}
        <Button variant="ghost" size="icon" onClick={props.onSettings} title={t("settings.title")} aria-label={t("settings.title")}><AppIcon icon={Settings} /></Button>
      </div>
    </SidebarFooter>
  </Sidebar>;
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
    <SidebarHeader className="side-header right-panel-header">
      <TabsList className="right-panel-tabs" aria-label={t("app.rightPanel")}>
        <TabsTrigger value="outline" className="min-w-0 px-1"><span className="truncate">{t("app.outline")}</span></TabsTrigger>
        <TabsTrigger value="history" className="min-w-0 px-1"><span className="truncate">{t("history.title")}</span></TabsTrigger>
      </TabsList>
      <Button variant="ghost" size="icon" className="right-pane-collapse" onClick={onCollapse} title={t("app.collapseRight")} aria-label={t("app.collapseRight")}><AppIcon icon={PanelRightClose} /></Button>
      <Button variant="ghost" size="icon" className="mobile-outline-close" onClick={onClose} title={t("app.closeRight")} aria-label={t("app.closeRight")}><AppIcon icon={PanelRightClose} /></Button>
    </SidebarHeader>
    <TabsContent key={tab} value={tab} className="right-panel-content" render={<SidebarContent />}>{children}</TabsContent>
  </Tabs>;
}
