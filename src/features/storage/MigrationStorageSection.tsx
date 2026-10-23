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
  return <section className="settings-section settings-card storage-migration"><h3>{t("storage.migration")}</h3>
    <p className="settings-help">{t("storage.exportScope")}</p>
    <input ref={input} type="file" accept=".md,.markdown,.txt,.zip" multiple hidden onChange={(event) => {
      const files = Array.from(event.target.files ?? []); event.target.value = "";
      if (files.length) void run(() => onImport(files));
    }} />
    <div className="settings-actions"><SettingsButton icon={Download} disabled={busy} onClick={() => void run(onExport)}>{t("storage.exportAll")}</SettingsButton>
      <SettingsButton icon={Upload} disabled={busy} onClick={() => input.current?.click()}>{t("storage.importPackage")}</SettingsButton></div>
  </section>;
}
