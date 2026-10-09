import { createRoot } from "react-dom/client";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Pin, Check, X, Trash2 } from "lucide-react";
import { AppIcon } from "../../../src/components/AppIcon";
import { HistoryPanel } from "../../../src/components/HistoryPanel";
import { WorkspaceOutline } from "../../../src/features/vault/WorkspaceOutline";
import { PaneResizer } from "../../../src/components/PaneResizer";
import { MarkdownEditor } from "../../../src/editor/product/MarkdownEditor";
import { NotePaneLayout } from "../../../src/features/vault/NotePaneLayout";
import { useWorkspaceEditorMode } from "../../../src/features/vault/useWorkspaceEditorMode";
import { DEFAULT_DEVICE_WORKSPACE_PREFERENCES } from "../../../src/features/workspace";
import { SettingsButton } from "../../../src/components/SettingsButton";
import { ToastStack, type ToastNotice, type ToastTone } from "../../../src/components/Toast";
import { useToastNotifications } from "../../../src/features/vault/useToastNotifications";
import { NoteToolbar } from "../../../src/features/vault/NoteToolbar";
import { TreeLevel, TreeNoteLock } from "../../../src/features/vault/VaultTree";
import { WorkspacePanelHeader, WorkspaceSidebar } from "../../../src/features/vault/WorkspaceChrome";
import { I18nProvider } from "../../../src/i18n";
import { buildOutline } from "../../../src/editor/product/outline";
import type { HistoryListItem, OpenDocument, UiPreferences } from "../../../src/types";
import "../../../src/styles.css";

const sample = '# Main page\n\nText with **bold**, *italic*, `code` and $x^2$.\n\n```ts\nconst title = "Mint Notes";\n```\n\n---\n\n> [!note] Note\n> Keep writing.';
const fixtureParameters = new URLSearchParams(window.location.search);
const historyFixture = fixtureParameters.has("history");
const outlineFixture = fixtureParameters.has("outline");
const outlineSample = [
  "## 前言", "#### 实时模式通用编辑逻辑", "## 换行", "#### 非严格换行的实时模式渲染逻辑与光标编辑行为", "###### 连续的空白行",
  "#### 非严格换行的阅读模式渲染逻辑", "## 核心编辑样式", "#### 粗体", "#### 斜体", "#### 粗斜体", "#### 删除线", "#### 高亮",
  "## 标题样式", "#### ATX 标题语法格式", "###### 渲染逻辑", "###### 光标逻辑", "#### Setext 标题语法", "###### 渲染逻辑", "## 列表样式", "#### 无序列表"
].map(heading => `${heading}\n\n${"示例正文，保留标题的原始等级与导航位置。\n\n".repeat(3)}`).join("\n\n");
const snapshotItems: HistoryListItem[] = ["笔记历史一标题", "笔记历史二标题", "笔记历史三标题"].map((name, index) => ({
  historyId: `snapshot-${index}`, noteId: "workspace-note", capturedAt: new Date(2000, 0, 1, 0, 0).toISOString(),
  captureKind: "interval", name, protected: index === 0, byteSize: 128, pending: false
}));
const document = (objectId: string, title: string, kind: "note" | "folder" = "note", parentId: string | null = null, locked = false): OpenDocument => ({
  objectId, title, kind, parentId, locked, markdown: sample, tags: [], favorite: false, deleted: false,
  createdAt: "2026-01-01", updatedAt: "2026-01-01", manualOrder: 0, attachmentIds: [], schemaVersion: 2, serverRevision: 0, dirty: false
});
const selected = document("selected", "Selected note"), lockedNote = document("locked", "Locked note", "note", null, true);
const tree = new Map<string | null, OpenDocument[]>([
  [null, [document("folder-one", "Folder one", "folder"), document("folder-two", "Folder two", "folder"), document("folder-three", "Folder three", "folder"), document("note", "Note one"), selected, lockedNote]],
  ["folder-two", [document("subfolder", "Subfolder", "folder", "folder-two"), document("child-one", "Child note one", "note", "folder-two"), document("child-two", "Child note two", "note", "folder-two")]],
  ["subfolder", [document("nested", "Nested note", "note", "subfolder")]]
]);
let saves = 0;
let notify!: ReturnType<typeof useToastNotifications>["showMessage"];
let loadMarkdown!: (text: string) => void;
declare global { interface Window { mintWorkspaceFixture: { saves(): number; loadMarkdown(text: string): void; notify(text: string, tone: ToastTone, action?: ToastNotice["action"]): void } } }
window.mintWorkspaceFixture = { saves: () => saves, loadMarkdown: text => loadMarkdown(text), notify: (...args) => notify(...args) };

function Workspace() {
  const notifications = useToastNotifications(); notify = notifications.showMessage;
  const [search, setSearch] = useState("");
  const [preferences, setPreferences] = useState<UiPreferences>({ ...DEFAULT_DEVICE_WORKSPACE_PREFERENCES, theme: "system", fontSize: 14, wrapCodeBlocks: true, language: "en", sortMode: "alphabetical", treeWidth: 297, outlineWidth: 297, rightPanelTab: "outline" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [markdown, setMarkdown] = useState(outlineFixture ? outlineSample : sample), [title, setTitle] = useState("Note title"), [locked, setLocked] = useState(false);
  loadMarkdown = setMarkdown;
  const outline = useMemo(() => buildOutline(markdown), [markdown]);
  const [treeOpen, setTreeOpen] = useState(false), [outlineOpen, setOutlineOpen] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false), [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [treeWidth, setTreeWidth] = useState(297), [outlineWidth, setOutlineWidth] = useState(297);
  const [sortMode, setSortMode] = useState<UiPreferences["sortMode"]>("alphabetical"), [tab, setTab] = useState<UiPreferences["rightPanelTab"]>(historyFixture ? "history" : "outline");
  const [historyItems, setHistoryItems] = useState(historyFixture ? snapshotItems : []);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null), [renamingHistoryId, setRenamingHistoryId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(new Set(["folder-two", "subfolder"]));
  const searchInput = useRef<HTMLInputElement>(null), titleInput = useRef<HTMLInputElement>(null);
  const editorMode = useWorkspaceEditorMode({ preferences, document: { ...selected, locked }, previewing: false, onPreferences: setPreferences });
  const area = editorMode.navigation.editorArea;
  return <div className={`app-shell ${treeOpen ? "tree-open" : ""} ${outlineOpen ? "outline-open" : ""} ${treeCollapsed ? "tree-collapsed" : ""} ${outlineCollapsed ? "outline-collapsed" : ""}`} style={{ "--tree-width": `${treeWidth}px`, "--outline-width": `${outlineWidth}px` } as CSSProperties}>
    <WorkspaceSidebar searchInput={searchInput} search={search} onSearchChange={setSearch} onCreate={() => {}} sortMode={sortMode} onSortChange={setSortMode}
      canLocate onLocate={() => {}} onCollapseAll={() => setExpanded(new Set())} onCollapse={() => setTreeCollapsed(true)} onClose={() => setTreeOpen(false)}
      displayName="User" username="username" avatarUrl={null} onLock={() => {}} onSettings={() => setSettingsOpen(true)}
      pinned={<div className="pinned-section"><div className="tree-section-label"><AppIcon icon={Pin} size={8} />Pinned</div>{[selected, lockedNote].map(entry => <div key={entry.objectId} className={`tree-row ${entry === selected ? "active" : ""}`}><button className="tree-main"><span className="tree-spacer" /><span className="tree-title">{entry.title}</span><TreeNoteLock document={entry} /></button></div>)}</div>}
    >
      <div className="document-tree"><TreeLevel childrenByParent={tree} parentId={null} activeId={selected.objectId} selectedIds={new Set([selected.objectId])} expanded={expanded}
        draggingIds={new Set()} dropTarget={null} renamingDocumentId={null} onDropTarget={() => {}} onSelect={entry => { if (entry.kind === "folder") setExpanded(current => { const next = new Set(current); if (next.has(entry.objectId)) next.delete(entry.objectId); else next.add(entry.objectId); return next; }); }}
        onContext={() => {}} onDragSelection={() => []} onDragFinish={() => {}} onMove={() => {}} onRenameCommit={() => {}} onRenameCancel={() => {}} /></div>
    </WorkspaceSidebar>
    <PaneResizer label="Resize left panel" side="left" value={treeWidth} min={220} max={420} onResize={setTreeWidth} />
    <NotePaneLayout editorArea={area} toolbar={<NoteToolbar titleInput={titleInput} active title={title} titleReadOnly={editorMode.readOnly} locked={locked} historyPreview={false}
      sourceMode={editorMode.sourceMode} readOnly={editorMode.readOnly} onOpenLeft={() => treeCollapsed ? setTreeCollapsed(false) : setTreeOpen(true)} onTitleChange={event => setTitle(event.target.value)}
      onTitleBlur={() => {}} onTitleKeyDown={() => {}} onToggleSource={editorMode.toggleSource} onToggleReadOnly={editorMode.toggleReadOnly} onToggleLock={() => setLocked(current => !current)} onAddImage={() => {}} onOpenRight={() => outlineCollapsed ? setOutlineCollapsed(false) : setOutlineOpen(true)}
    />} status={<footer className="status-bar"><span>Saved locally</span><span>42 words</span></footer>}>
      <MarkdownEditor documentKey="workspace-note" markdown={markdown} mode={editorMode.effectiveMode} readOnly={editorMode.readOnly} onModeChange={editorMode.onModeChange} onChange={text => { saves++; setMarkdown(text); }} />
    </NotePaneLayout>
    <PaneResizer label="Resize right panel" side="right" value={outlineWidth} min={200} max={420} onResize={setOutlineWidth} />
    <aside className="outline-pane"><WorkspacePanelHeader tab={tab} onTabChange={setTab} onCollapse={() => setOutlineCollapsed(true)} onClose={() => setOutlineOpen(false)} /><section className="right-panel-content">
      {tab === "history" && historyFixture ? <HistoryPanel
        items={historyItems} selectedId={selectedHistoryId} loading={false} hasMore={false} disabled={false} renamingId={renamingHistoryId}
        onSelect={item => setSelectedHistoryId(item.historyId)}
        onSave={() => setHistoryItems(items => [{ ...snapshotItems[0], historyId: crypto.randomUUID(), capturedAt: new Date().toISOString(), captureKind: "manual", protected: false }, ...items])}
        onBeginRename={item => setRenamingHistoryId(item.historyId)} onRenameCancel={() => setRenamingHistoryId(null)}
        onRename={(item, name) => { setHistoryItems(items => items.map(entry => entry.historyId === item.historyId ? { ...entry, name } : entry)); setRenamingHistoryId(null); }}
        onToggleProtection={item => setHistoryItems(items => items.map(entry => entry.historyId === item.historyId ? { ...entry, protected: !entry.protected } : entry))}
        onDelete={item => setHistoryItems(items => items.filter(entry => entry.historyId !== item.historyId))}
        onClear={() => setHistoryItems(items => items.filter(item => item.protected))} onLoadMore={() => {}}
      /> : tab === "outline" ? <WorkspaceOutline items={outline} editorArea={area} mode={editorMode.effectiveMode}
        collapsed={outlineCollapsed} open={outlineOpen} onSelect={item => { editorMode.navigation.jumpToHeading(item); setOutlineOpen(false); }} />
        : <nav className="outline-list"><p className="outline-empty">No history</p></nav>}
    </section></aside>
    {settingsOpen && <div className="modal-backdrop"><section className="settings-modal"><div className="settings-section"><div className="settings-actions"><SettingsButton icon={Check} className="primary">Save</SettingsButton><SettingsButton icon={X} onClick={() => setSettingsOpen(false)}>Cancel</SettingsButton><SettingsButton icon={Trash2} className="danger">Delete</SettingsButton></div></div></section></div>}
    {(treeOpen || outlineOpen) && <button className="drawer-scrim" aria-label="Close panels" onClick={() => { setTreeOpen(false); setOutlineOpen(false); }} />}
    <ToastStack notices={notifications.notices} onDismiss={notifications.dismissMessage} />
  </div>;
}

localStorage.setItem("webmd-notes-language", fixtureParameters.get("language") ?? "en");
createRoot(window.document.getElementById("root")!).render(<I18nProvider><Workspace /></I18nProvider>);
