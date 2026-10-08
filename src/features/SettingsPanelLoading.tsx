import { Settings, X } from "lucide-react";
import { AppIcon } from "../components/AppIcon";
import { useI18n } from "../i18n";

export function SettingsPanelLoading({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return <div className="modal-backdrop settings-backdrop" role="dialog" aria-modal="true" aria-label={t("settings.title")} onClick={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="modal settings-modal">
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <h2 className="settings-title"><AppIcon icon={Settings} size={16} />{t("settings.title")}</h2>
        </aside>
        <div className="settings-main">
          <header className="settings-header"><button onClick={onClose} aria-label={t("settings.close")}><AppIcon icon={X} size={16} /></button></header>
          <div className="settings-content settings-loading-content" aria-busy="true"><div className="spinner" aria-hidden="true" /></div>
        </div>
      </div>
    </section>
  </div>;
}
