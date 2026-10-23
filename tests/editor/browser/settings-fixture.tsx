import { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsPanelLoading } from "../../../src/features/SettingsPanelLoading";
import { DEFAULT_DEVICE_WORKSPACE_PREFERENCES } from "../../../src/features/workspace";
import { I18nProvider } from "../../../src/i18n";
import type { HistorySettings, UiPreferences } from "../../../src/types";
import "../../../src/styles.css";

const historySettings: HistorySettings = { enabled: false, intervalMinutes: 10, retentionDays: 90, count: 0, usedBytes: 0, quotaBytes: 256 * 1024 * 1024, clearedBefore: null };
const noop = () => {};
const done = async () => {};

declare global { interface Window { mintSettingsFixture: { finishLoading(): void } } }
let finishLoading = () => {};
const settingsReady = new Promise<void>(resolve => { finishLoading = resolve; });
window.mintSettingsFixture = { finishLoading: () => finishLoading() };
const SettingsPanel = lazy(async () => {
  if (new URLSearchParams(location.search).has("loading")) await settingsReady;
  return { default: (await import("../../../src/features/SettingsPanel")).SettingsPanel };
});

function SettingsFixture() {
  const [open, setOpen] = useState(true);
  const [preferences, setPreferences] = useState<UiPreferences>({ ...DEFAULT_DEVICE_WORKSPACE_PREFERENCES, theme: new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark", fontSize: 14, wrapCodeBlocks: false, language: "en", sortMode: "alphabetical", treeWidth: 297, outlineWidth: 297, rightPanelTab: "outline" });
  useEffect(() => {
    const theme = preferences.theme === "system" ? "light" : preferences.theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [preferences.theme]);
  return <div className="app-shell">
    <aside className="tree-pane"><div className="side-header">Mint Notes</div><button onClick={() => setOpen(true)}>Open settings</button></aside>
    <main className="note-pane"><div className="note-pane-top"><div className="note-toolbar">Note title</div></div></main>
    {open && <Suspense fallback={<SettingsPanelLoading onClose={() => setOpen(false)} />}><SettingsPanel
      storageStatus={{ localReady: true, usage: { totalBytes: 389021696, contentBytes: 262144000, noteBytes: 12582912, attachmentBytes: 249561088, historyBytes: 125829120, profileBytes: 1048576, trashBytes: 15728640, quotaBytes: 2147483648, historyQuotaBytes: 268435456, checkedAt: "2026-10-23T10:30:00Z" }, local: { bytes: 73400320, objects: 12, attachments: 3, history: 24 }, lastSync: "2026-10-23T10:30:00Z", unsaved: 2, estimate: null, persistence: "unsupported", failed: false, refreshing: false, stale: false, refresh: done, requestPersistence: done }}
      user={{ id: "fixture-user", username: "mint", displayName: "Mint Notes", role: "admin" }}
      endpoint={{ id: "fixture-endpoint", remembered: false }} credential={null} serverSessionVerified={!new URLSearchParams(location.search).has("offline")}
      onCredentialChange={noop} preferences={preferences} onPreferences={setPreferences} onClose={() => setOpen(false)} onLogout={done}
      onImport={done} onExport={done} onDisplayName={noop} onUsername={noop} avatarUrl={null} onAvatarChange={noop}
      trashItems={[]} purging={false} onRestoreTrash={done} onPurgeTrash={noop} onClearTrash={noop}
      historySettings={historySettings} onHistorySettings={noop} onRefreshHistorySettings={async () => historySettings} onClearHistory={done} onNotify={noop}
    /></Suspense>}
  </div>;
}

localStorage.setItem("webmd-notes-language", "en");
createRoot(document.getElementById("root")!).render(<I18nProvider><SettingsFixture /></I18nProvider>);
