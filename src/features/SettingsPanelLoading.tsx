import { DialogClose, DialogTitle } from "../components/ui/dialog";
import { Spinner } from "../components/ui/spinner";
import { SettingsDialog } from "./SettingsDialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sidebar, SidebarHeader } from "@/components/ui/sidebar";
import { Settings, X } from "lucide-react";
import { AppIcon } from "../components/AppIcon";
import { useI18n } from "../i18n";

export function SettingsPanelLoading({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return <SettingsDialog onClose={onClose}>
      <div className="settings-layout">
        <Sidebar className="settings-sidebar h-auto w-full">
          <SidebarHeader className="p-0">
            <DialogTitle className="settings-title"><AppIcon icon={Settings} size={16} />{t("settings.title")}</DialogTitle>
          </SidebarHeader>
        </Sidebar>
        <ScrollArea className="settings-main"
          header={<header className="settings-header"><DialogClose render={<Button variant="ghost" size="icon" aria-label={t("settings.close")} />}><AppIcon icon={X} /></DialogClose></header>}
          viewport={{ className: "settings-content settings-loading-content", "aria-busy": true }}
          contentClassName="settings-scroll-content"
        >
          <Spinner className="spinner" aria-hidden="true" />
        </ScrollArea>
      </div>
  </SettingsDialog>;
}
