import { createRoot } from "react-dom/client";
import { useRef, useState, type CSSProperties } from "react";
import { Pin } from "lucide-react";
import { AppIcon } from "../../../src/components/AppIcon";
import { PaneResizer } from "../../../src/components/PaneResizer";
import { MarkdownEditor } from "../../../src/editor/product/MarkdownEditor";
import { NotePaneLayout } from "../../../src/features/vault/NotePaneLayout";
import { NoteToolbar } from "../../../src/features/vault/NoteToolbar";
import { TreeLevel, TreeNoteLock } from "../../../src/features/vault/VaultTree";
import { WorkspacePanelHeader, WorkspaceSidebar } from "../../../src/features/vault/WorkspaceChrome";
import { I18nProvider } from "../../../src/i18n";
import type { OpenDocument, UiPreferences, WorkspaceEditorMode } from "../../../src/types";
import "../../../src/styles.css";

const sample = '# Main page\n\nText with **bold**, *italic*, `code` and $x^2$.\n\n```ts\nconst title = "Mint Notes";\n```\n\n---\n\n> [!note] Note\n> Keep writing.';
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
declare global { interface Window { mintWorkspaceFixture: { saves(): number } } }
window.mintWorkspaceFixture = { saves: () => saves };

function Workspace() {
  const [search, setSearch] = useState(""), [mode, setMode] = useState<WorkspaceEditorMode>("live");
  const [markdown, setMarkdown] = useState(sample), [title, setTitle] = useState("Note title"), [locked, setLocked] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false), [outlineOpen, setOutlineOpen] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false), [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [treeWidth, setTreeWidth] = useState(297), [outlineWidth, setOutlineWidth] = useState(297);
  const [sortMode, setSortMode] = useState<UiPreferences["sortMode"]>("alphabetical"), [tab, setTab] = useState<UiPreferences["rightPanelTab"]>("outline");
  const [expanded, setExpanded] = useState(new Set(["folder-two", "subfolder"]));
  const searchInput = useRef<HTMLInputElement>(null), titleInput = useRef<HTMLInputElement>(null), area = useRef<HTMLDivElement>(null);
  return <div className={`app-shell ${treeOpen ? "tree-open" : ""} ${outlineOpen ? "outline-open" : ""} ${treeCollapsed ? "tree-collapsed" : ""} ${outlineCollapsed ? "outline-collapsed" : ""}`} style={{ "--tree-width": `${treeWidth}px`, "--outline-width": `${outlineWidth}px` } as CSSProperties}>
    <WorkspaceSidebar searchInput={searchInput} search={search} onSearchChange={setSearch} onCreate={() => {}} sortMode={sortMode} onSortChange={setSortMode}
      canLocate onLocate={() => {}} onCollapseAll={() => setExpanded(new Set())} onCollapse={() => setTreeCollapsed(true)} onClose={() => setTreeOpen(false)}
      displayName="User" username="username" avatarUrl={null} onLock={() => {}} onSettings={() => {}}
      pinned={<div className="pinned-section"><div className="tree-section-label"><AppIcon icon={Pin} size={8} />Pinned</div>{[selected, lockedNote].map(entry => <div key={entry.objectId} className={`tree-row ${entry === selected ? "active" : ""}`}><button className="tree-main"><span className="tree-spacer" /><span className="tree-title">{entry.title}</span><TreeNoteLock document={entry} /></button></div>)}</div>}
    >
      <div className="document-tree"><TreeLevel childrenByParent={tree} parentId={null} activeId={selected.objectId} selectedIds={new Set([selected.objectId])} expanded={expanded}
        draggingIds={new Set()} dropTarget={null} renamingDocumentId={null} onDropTarget={() => {}} onSelect={entry => { if (entry.kind === "folder") setExpanded(current => { const next = new Set(current); if (next.has(entry.objectId)) next.delete(entry.objectId); else next.add(entry.objectId); return next; }); }}
        onContext={() => {}} onDragSelection={() => []} onDragFinish={() => {}} onMove={() => {}} onRenameCommit={() => {}} onRenameCancel={() => {}} /></div>
    </WorkspaceSidebar>
    <PaneResizer label="Resize left panel" side="left" value={treeWidth} min={220} max={420} onResize={setTreeWidth} />
    <NotePaneLayout editorArea={area} toolbar={<NoteToolbar titleInput={titleInput} active title={title} titleReadOnly={locked} locked={locked} historyPreview={false}
      effectiveEditorMode={locked ? "reading" : mode} onOpenLeft={() => treeCollapsed ? setTreeCollapsed(false) : setTreeOpen(true)} onTitleChange={event => setTitle(event.target.value)}
      onTitleBlur={() => {}} onTitleKeyDown={() => {}} onModeChange={setMode} onToggleLock={() => setLocked(current => !current)} onAddImage={() => {}} onOpenRight={() => outlineCollapsed ? setOutlineCollapsed(false) : setOutlineOpen(true)}
    />} status={<footer className="status-bar"><span>Saved locally</span><span>42 words</span></footer>}>
      <MarkdownEditor documentKey="workspace-note" markdown={markdown} mode={locked ? "reading" : mode} onChange={text => { saves++; setMarkdown(text); }} />
    </NotePaneLayout>
    <PaneResizer label="Resize right panel" side="right" value={outlineWidth} min={200} max={420} onResize={setOutlineWidth} />
    <aside className="outline-pane"><WorkspacePanelHeader tab={tab} onTabChange={setTab} onCollapse={() => setOutlineCollapsed(true)} onClose={() => setOutlineOpen(false)} /><section className="right-panel-content"><nav className="outline-list">{tab === "outline" ? <button>Main page</button> : <p className="outline-empty">No history</p>}</nav></section></aside>
    {(treeOpen || outlineOpen) && <button className="drawer-scrim" aria-label="Close panels" onClick={() => { setTreeOpen(false); setOutlineOpen(false); }} />}
  </div>;
}

localStorage.setItem("webmd-notes-language", "en");
createRoot(window.document.getElementById("root")!).render(<I18nProvider><Workspace /></I18nProvider>);
