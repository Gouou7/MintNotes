import { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createApiClient } from "../../../src/api";
import { createCryptoClient } from "../../../src/crypto/client";
import { SettingsPanelLoading } from "../../../src/features/SettingsPanelLoading";
import { WorkspaceServicesContext } from "../../../src/features/session/workspaceServices";
import { DEFAULT_DEVICE_WORKSPACE_PREFERENCES } from "../../../src/features/workspace";
import { I18nProvider } from "../../../src/i18n";
import type { HistorySettings, OpenDocument, UiPreferences } from "../../../src/types";
import "../../../src/styles.css";

const params = new URLSearchParams(location.search);
const unlimitedStorage = params.has("unlimited");
const locale = params.get("language") === "zh-CN" ? "zh-CN" : "en";
const historySettings: HistorySettings = { enabled: false, intervalMinutes: 10, retentionDays: 90, count: unlimitedStorage ? 2 : 128, usedBytes: unlimitedStorage ? 1331 : 125829120, quotaBytes: unlimitedStorage ? null : 256 * 1024 * 1024, clearedBefore: null };
const trashItems: OpenDocument[] = ["folder", "note"].map((kind, index) => ({
  objectId: `trash-${kind}`, kind: kind as "folder" | "note", title: `Deleted ${kind}`, markdown: "",
  parentId: null, tags: [], favorite: false, locked: false, deleted: true,
  createdAt: "2026-10-23T10:30:00Z", updatedAt: "2026-10-23T10:30:00Z", manualOrder: index,
  attachmentIds: [], schemaVersion: 2, serverRevision: 1, dirty: false,
}));
const noop = () => {};
const done = async () => {};
const services = { transport: createApiClient(), cryptoClient: createCryptoClient() };

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
  const [preferences, setPreferences] = useState<UiPreferences>({ ...DEFAULT_DEVICE_WORKSPACE_PREFERENCES, theme: params.get("theme") === "light" ? "light" : "dark", fontSize: 14, wrapCodeBlocks: false, language: locale, sortMode: "alphabetical", treeWidth: 297, outlineWidth: 297, rightPanelTab: "outline" });
  useEffect(() => {
    const theme = preferences.theme === "system" ? "light" : preferences.theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [preferences.theme]);
  return <div className="app-shell">
    <aside className="tree-pane"><div className="side-header">Mint Notes</div><button onClick={() => setOpen(true)}>Open settings</button></aside>
    <main className="note-pane"><div className="note-pane-top"><div className="note-toolbar">Note title</div></div></main>
    {open && <Suspense fallback={<SettingsPanelLoading onClose={() => setOpen(false)} />}><SettingsPanel
      storageStatus={{ localReady: true, usage: unlimitedStorage
        ? { totalBytes: 7065, contentBytes: 5734, noteBytes: 5734, attachmentBytes: 0, historyBytes: 1331, profileBytes: 0, trashBytes: 4096,
          activeBytes: { noteBytes: 1638, attachmentBytes: 0, historyBytes: 1331 }, quotaBytes: null, historyQuotaBytes: null, checkedAt: "2026-11-03T15:46:00Z" }
        : { totalBytes: 389021696, contentBytes: 262144000, noteBytes: 12582912, attachmentBytes: 249561088, historyBytes: 125829120, profileBytes: 1048576, trashBytes: 15728640,
          activeBytes: { noteBytes: 8388608, attachmentBytes: 243269632, historyBytes: 120586240 }, quotaBytes: 2147483648, historyQuotaBytes: 268435456, checkedAt: "2026-10-23T10:30:00Z" },
        local: unlimitedStorage ? { bytes: 5939, objects: 0, attachments: 0, history: 0 } : { bytes: 73400320, objects: 12, attachments: 3, history: 24 }, lastSync: "2026-11-03T15:45:00Z", unsaved: unlimitedStorage ? 0 : 2, estimate: null, persistence: "unsupported", failed: false, refreshing: false, stale: false, refresh: done, requestPersistence: done }}
      user={{ id: "fixture-user", username: "mint", displayName: "Mint Notes", role: "admin" }}
      endpoint={{ id: "fixture-endpoint", remembered: false }} credential={null} serverSessionVerified={!new URLSearchParams(location.search).has("offline")}
      onCredentialChange={noop} preferences={preferences} onPreferences={setPreferences} onClose={() => setOpen(false)} onLogout={done}
      onImport={done} onExport={done} onDisplayName={noop} onUsername={noop} avatarUrl={null} onAvatarChange={noop}
      trashItems={trashItems} purging={false} onRestoreTrash={done} onPurgeTrash={noop} onClearTrash={noop}
      historySettings={historySettings} onHistorySettings={noop} onRefreshHistorySettings={async () => historySettings} onClearHistory={done} onNotify={noop}
    /></Suspense>}
  </div>;
}

localStorage.setItem("webmd-notes-language", locale);
createRoot(document.getElementById("root")!).render(<I18nProvider><WorkspaceServicesContext.Provider value={services}><SettingsFixture /></WorkspaceServicesContext.Provider></I18nProvider>);
