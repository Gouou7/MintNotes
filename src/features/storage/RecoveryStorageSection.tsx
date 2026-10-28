import { useEffect, useRef, useState } from "react";
import { liveQuery } from "dexie";
import { Download, RefreshCw } from "lucide-react";
import { SettingsButton } from "../../components/SettingsButton";
import { useI18n } from "../../i18n";
import type { ToastTone } from "../../components/Toast";
import { localDb } from "../../storage/database";
import { exportRecoveryCopies } from "../vault/recoveryExport";

function useRecoveries(userId: string) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const subscription = liveQuery(() => localDb.recoveries.where("userId").equals(userId).count())
      .subscribe({ next: setCount, error: () => setCount(0) });
    return () => subscription.unsubscribe();
  }, [userId]);
  return count;
}
export function RecoveryStorageSection({ userId, onNotify }: { userId: string; onNotify: (text: string, tone: ToastTone) => void }) {
  const { t } = useI18n();
  const count = useRecoveries(userId), active = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  if (!count) return null;
  return <section className="settings-section settings-card"><h3>{t("storage.recoveryTitle")}</h3>
    <p className="settings-help">{t("storage.recoveryHelp", { count })}</p>
    <div className="settings-actions">
      <SettingsButton icon={RefreshCw} disabled={busy} onClick={() => window.dispatchEvent(new CustomEvent("webmd:retry-recoveries"))}>{t("storage.recoveryRetry")}</SettingsButton>
      <SettingsButton icon={Download} disabled={busy} onClick={() => {
        setBusy(true);
        void exportRecoveryCopies(userId, () => active.current).catch(() => {
          if (active.current) onNotify(t("transfer.exportFailed"), "critical");
        }).finally(() => { if (active.current) setBusy(false); });
      }}>{t("storage.recoveryExport")}</SettingsButton>
    </div>
  </section>;
}
