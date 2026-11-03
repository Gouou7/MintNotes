import { SettingsSection } from "../../components/SettingsSection";
import { SettingsItem } from "../../components/SettingsItem";
import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { SettingsButton } from "../../components/SettingsButton";
import type { ToastTone } from "../../components/Toast";
import { useI18n } from "../../i18n";
export function MigrationStorageSection({ onImport, onExport, onNotify }: {
  onImport: (files: File[]) => Promise<void>; onExport: () => Promise<void>; onNotify: (text: string, tone: ToastTone) => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    try { await operation(); } catch { onNotify(t("storage.transferFailed"), "warning"); }
    finally { setBusy(false); }
  };
  return <SettingsSection title={t("storage.migration")} className="storage-migration">
    <SettingsItem title={t("storage.importNotes")} description={t("storage.importHelp")}><SettingsButton icon={Upload} disabled={busy} onClick={() => input.current?.click()}>{t("storage.importPackage")}</SettingsButton></SettingsItem>
    <SettingsItem title={t("storage.exportNotes")} description={t("storage.exportScope")}><SettingsButton icon={Download} disabled={busy} onClick={() => void run(onExport)}>{t("storage.exportAll")}</SettingsButton></SettingsItem>
    <input ref={input} type="file" accept=".md,.markdown,.txt,.zip" multiple hidden onChange={(event) => {
      const files = Array.from(event.target.files ?? []); event.target.value = "";
      if (files.length) void run(() => onImport(files));
    }} />
  </SettingsSection>;
}
