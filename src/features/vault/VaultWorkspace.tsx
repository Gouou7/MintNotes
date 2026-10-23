import {
  Copy,
  Ellipsis,
  History as HistoryIcon,
  Pin,
  RotateCcw,
  Trash2
} from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { AppIcon } from "../../components/AppIcon";
import { HistoryPanel } from "../../components/HistoryPanel";
import { PaneResizer } from "../../components/PaneResizer";
import { ToastStack } from "../../components/Toast";
import { MarkdownEditor } from "../../editor/product/MarkdownEditor";
import { ReadingEditor } from "../../editor/product/ReadingEditor";
import { translateError, useI18n } from "../../i18n";
import { type DeviceUnlockCredential } from "../../storage/database";
import type { AuthEndpoint, OpenDocument, OutlineItem, User } from "../../types";
import { DEFAULT_FONT_SIZE } from "../appearance";
import { attachmentIdsIn, attachmentMarkdown, decryptAttachmentBlob } from "../attachments";
import { focusAndSelectName } from "../focusName";
import { canDeleteHistory } from "../history";
import { ImportResultPanel } from "../ImportResultPanel";
import { isLockedNote } from "../noteLock";
import { formatNoteTime } from "../noteTime";
import { SettingsPanelLoading } from "../SettingsPanelLoading";
import { NameReservations } from "../siblingNames";
import { createHistorySync } from "./createHistorySync";
import { focusEditorFromTitle } from "./editorFocus";
import { NotePaneLayout } from "./NotePaneLayout";
import { EmptyEditor, NoteToolbar } from "./NoteToolbar";
import { attachmentGraphSignature, useAttachmentUrls } from "./useAttachmentUrls";
import { useDocumentSaveQueue } from "./useDocumentSaveQueue";
import { useImportExport } from "./useImportExport";
import { useNoteEditorIntegration } from "./useNoteEditorIntegration";
import { useObjectPersistence } from "./useObjectPersistence";
import { useSiblingNameRepair } from "./useSiblingNameRepair";
import { syncStatusDetailText, useSyncStatus, visibleSyncStatusText } from "./useSyncStatus";
import { useToastNotifications } from "./useToastNotifications";
import { useVaultDerivedView } from "./useVaultDerivedView";
import { useVaultDocuments } from "./useVaultDocuments";
import { useVaultHistory } from "./useVaultHistory";
import { useVaultHistoryActions } from "./useVaultHistoryActions";
import { useVaultLoad } from "./useVaultLoad";
import { useVaultLock } from "./useVaultLock";
import { useVaultModel } from "./useVaultModel";
import { useVaultPreferences } from "./useVaultPreferences";
import { useVaultProfile } from "./useVaultProfile";
import { useVaultSync } from "./useVaultSync";
import { useVaultTrash } from "./useVaultTrash";
import { useVaultTree } from "./useVaultTree";
import { useWorkspaceEditorMode } from "./useWorkspaceEditorMode";
import { useMobileDrawerGestures } from "./useWorkspaceInteractions";
import { useWorkspaceSelection } from "./useWorkspaceSelection";
import { ContextMenu, draggedDocumentIds, TreeLevel, TreeNoteLock } from "./VaultTree";
import { WorkspacePanelHeader, WorkspaceSidebar } from "./WorkspaceChrome";
import { WorkspaceOutline } from "./WorkspaceOutline";

const SettingsPanel = lazy(() => import("../SettingsPanel").then((module) => ({ default: module.SettingsPanel })));

const TREE_WIDTH_MIN = 220;
const TREE_WIDTH_MAX = 420;
const OUTLINE_WIDTH_MIN = 200;
const OUTLINE_WIDTH_MAX = 420;

export function VaultWorkspace({
  user,
  endpoint,
  credential,
  serverSessionVerified,
  onCredentialChange,
  onDisplayNameChange,
  onUsernameChange,
  onLocked
}: {
  user: User;
  endpoint: AuthEndpoint;
  credential: DeviceUnlockCredential | null;
  serverSessionVerified: boolean;
  onCredentialChange: (credential: DeviceUnlockCredential | null) => void;
  onDisplayNameChange: (displayName: string) => void;
  onUsernameChange: (username: string) => void;
  onLocked: (logout: boolean) => void;
}) {
  const { formatDateTime, languagePreference, setLanguagePreference, t } = useI18n();

  const [displayName, setDisplayName] = useState(user.displayName);

  const model = useVaultModel();
  const {
    documents,
    documentsRef,
    documentIndexRef,
    attachments,
    attachmentsRef,
    attachmentIndexRef,
    upsertDocument,
    upsertAttachment
  } = model;

  const nameReservations = useRef(new NameReservations());

  const nameDocuments = () => [...documentsRef.current, ...nameReservations.current.documents()];

  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);

  const selection = useWorkspaceSelection();
  const { activeId, selectedIds, setSelectedIds, selectionAnchor } = selection;

  const [editorSessionId, setEditorSessionId] = useState(0);

  const [titleDraft, setTitleDraft] = useState("");

  const [search, setSearch] = useState("");

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [treeOpen, setTreeOpen] = useState(false);

  const [outlineOpen, setOutlineOpen] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const logoutStarted = useRef(false);

  const generation = useRef(0);

  const serverSessionVerifiedRef = useRef(serverSessionVerified);

  const searchInput = useRef<HTMLInputElement>(null);

  const titleInput = useRef<HTMLInputElement>(null);

  const pendingTitleFocus = useRef<string | null>(null);

  const attachmentInput = useRef<HTMLInputElement>(null);

  const {
    status: syncStatus,
    setPhase: setSaveState,
    setSyncError,
    setUnavailable,
    markLocalFailure,
    markLocalSuccess
  } = useSyncStatus(serverSessionVerified);

  const { notices, showMessage, dismissMessage } = useToastNotifications();

  useEffect(() => {
    serverSessionVerifiedRef.current = serverSessionVerified;
  }, [serverSessionVerified]);

  useEffect(() => {
    // React StrictMode replays effect setup and cleanup once in development.
    // Reset the barrier on every real setup so that replay cannot make the
    // subsequent vault-load effect look like a logout.
    logoutStarted.current = false;
    return () => {
      logoutStarted.current = true;
      clearHistorySessionTimers();
    };
  }, []);

  const { preferences, setPreferences, setPreferencesLoaded } = useVaultPreferences({
    selection,
    languagePreference,
    logoutStarted,
    userId: user.id,
    setLanguagePreference,
    workspaceLoaded
  });

  const indexedActiveDocument = activeId ? documentIndexRef.current.get(activeId) : null;

  const activeDocument = indexedActiveDocument?.kind === "note" ? indexedActiveDocument : null;

  const activeDocumentLocked = isLockedNote(activeDocument);

  const history = useVaultHistory({
    model,
    selection,
    userId: user.id,
    generation,
    logoutStarted,
    serverSessionVerified,
    t,
    requestPush,
    showMessage,
    setOutlineOpen,
    flushDocument: (id) => flushDocument(id),
    activeDocument,
    preferences
  });
  const {
    historySettings,
    historyItems,
    historyCursor,
    historyHasMore,
    historyLoading,
    historyPreview,
    setHistoryPreview,
    renamingHistoryId,
    setRenamingHistoryId,
    applyHistorySettings,
    refreshHistorySettings,
    loadHistory,
    selectHistorySnapshot,
    finishHistorySession,
    scheduleHistoryEdit,
    clearHistorySessionTimers
  } = history;

  const objectPersistence = useObjectPersistence({
    userId: user.id,
    generation,
    isActive: () => !logoutStarted.current,
    canSynchronize: () => serverSessionVerifiedRef.current,
    setSaveState: (phase) => phase === "offline" ? setUnavailable() : setSaveState(phase),
    onPersistenceError: (objectId) => {
      markLocalFailure(objectId);
      showMessage(t("notice.localSaveFailed"), "critical");
    },
    onPersistenceSuccess: markLocalSuccess,
    upsertDocument,
    upsertAttachment,
    getServerRevision: (objectId) => documentIndexRef.current.get(objectId)?.serverRevision ?? attachmentIndexRef.current.get(objectId)?.serverRevision
  });

  const persistObject = objectPersistence.persistObject;

  const documentSaveQueue = useDocumentSaveQueue({
    isActive: () => !logoutStarted.current,
    getDocument: (objectId) => documentIndexRef.current.get(objectId),
    upsertDocument,
    persistDocument: async (document, isCurrent) => {
      return persistObject(document, { commitState: isCurrent });
    },
    onPersisted: () => requestPush("editor")
  });

  const flushDocument = async (objectId: string) => {
    await documentSaveQueue.flush(objectId);
    await objectPersistence.drain(objectId);
  };

  const queueDocument = (document: OpenDocument, delay = 500, maxWait = 5_000) => {
    documentSaveQueue.queue(document, delay, maxWait);
  };

  const editorMode = useWorkspaceEditorMode({ preferences, document: activeDocument, previewing: Boolean(historyPreview), onPreferences: setPreferences });

  const { effectiveMode, navigation: documentNavigation } = editorMode;

  const editorModeRef = useRef({ readOnly: editorMode.readOnly, previewing: Boolean(historyPreview) });

  editorModeRef.current = { readOnly: editorMode.readOnly, previewing: Boolean(historyPreview) };

  const {
    patchDocument,
    createDocument,
    createNewDocument,
    persistDocumentCopy,
    moveDocuments,
    addAttachment,
    duplicateDocuments,
    pinDocuments,
    commitDocumentTitle,
    toggleNoteLock,
    toggleActiveNoteLock,
    commitTreeRename,
    renameDocument
  } = useVaultDocuments({
    model,
    selection,
    scheduleHistoryEdit,
    queueDocument,
    t,
    nameDocuments,
    setSearch,
    setExpanded,
    persistObject,
    beginTreeRename: (id) => tree.beginTreeRename(id),
    applyDeferredActiveRemote: (id) => sync.applyDeferredActiveRemote(id),
    pendingTitleFocus,
    setEditorSessionId,
    setTreeOpen,
    requestPush,
    nameReservations,
    userId: user.id,
    logoutStarted,
    serverSessionVerified,
    removePurgedLocal: (id, commit) => sync.removePurgedLocal(id, commit),
    showMessage,
    preferences,
    titleDraft,
    flushDocument,
    documentNavigation,
    historyPreview,
    setRenamingDocumentId: (next) => tree.setRenamingDocumentId(next)
  });

  const { pushHistoryPending, pushHistoryMetadataPending } = createHistorySync({
    history,
    userId: user.id,
    logoutStarted,
    showMessage,
    t,
    generation,
    requestPush
  });

  const sync = useVaultSync({
    model,
    selection,
    userId: user.id,
    showMessage,
    t,
    persistDocumentCopy,
    generation,
    logoutStarted,
    documentSaveQueue,
    nameReservations,
    objectPersistence,
    pushHistoryPending,
    pushHistoryMetadataPending,
    serverSessionVerifiedRef,
    setUnavailable,
    setSaveState,
    setSyncError,
    workspaceLoaded,
    serverSessionVerified,
    finishHistorySession,
    flushDocument
  });
  const {
    syncClientId,
    applyDeferredActiveRemote,
    removePurgedLocal,
    pullChanges,
    synchronize,
    stopSync
  } = sync;

  function requestPush(kind: "editor" | "structural" = "editor") {
    sync.requestPush(kind);
  }

  const { loading, loadFailure } = useVaultLoad({
    model,
    selection,
    userId: user.id,
    logoutStarted,
    languagePreference,
    setPreferences,
    setPreferencesLoaded,
    serverSessionVerifiedRef,
    pullChanges,
    showMessage,
    t,
    createDocument,
    setUnavailable,
    setSaveState,
    setSyncError,
    setWorkspaceLoaded,
    requestPush
  });

  const {
    saveCurrentHistory,
    renameHistorySnapshot,
    toggleHistoryProtection,
    deleteHistorySnapshot,
    clearCurrentHistory,
    clearAllHistory,
    restoreHistoryAsCurrent,
    restoreHistoryAsCopy
  } = useVaultHistoryActions({
    model,
    selection,
    history,
    activeDocument,
    flushDocument,
    formatDateTime,
    showMessage,
    t,
    userId: user.id,
    requestPush,
    serverSessionVerified,
    synchronize,
    nameDocuments,
    persistObject,
    setTitleDraft,
    setEditorSessionId,
    persistDocumentCopy
  });

  const { purging, setDeletedMany, requestPurgeDocuments, requestClearTrash } = useVaultTrash({
    model,
    selection,
    showMessage,
    t,
    nameReservations,
    persistObject,
    setEditorSessionId,
    requestPush,
    serverSessionVerified,
    documentSaveQueue,
    objectPersistence,
    synchronize,
    userId: user.id,
    syncClientId,
    removePurgedLocal
  });

  const { avatarUrl, updateAvatarUrl } = useVaultProfile({
    serverSessionVerified,
    userId: user.id
  });

  const noteEditor = useNoteEditorIntegration({
    document: activeDocument, previewing: Boolean(historyPreview), readOnly: editorMode.readOnly,
    findDocument: id => documentIndexRef.current.get(id), patchDocument,
    saveImage: async (id, file) => {
      try { const attachment = await addAttachment(id, file); return attachmentMarkdown(attachment.objectId, attachment.originalName); }
      catch (error) { showMessage(translateError(error, t, "notice.attachmentSaveFailed"), "critical"); return null; }
    },
  });

  useEffect(() => setTitleDraft(activeDocument?.title ?? ""), [activeDocument?.objectId, activeDocument?.title]);

  useEffect(() => {
    if (!activeDocument || pendingTitleFocus.current !== activeDocument.objectId) return;
    const frame = window.requestAnimationFrame(() => {
      if (focusAndSelectName(titleInput.current)) pendingTitleFocus.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeDocument?.objectId, editorSessionId]);

  const displayedMarkdown = historyPreview?.payload.markdown ?? activeDocument?.markdown ?? "";

  const {
    outline,
    statistics,
    trashItems,
    searched,
    treeChildren,
    visibleTree,
    pinned
  } = useVaultDerivedView({
    documents,
    documentKey: historyPreview?.item.historyId ?? activeDocument?.objectId ?? "",
    markdown: displayedMarkdown,
    search,
    expanded,
    sortMode: preferences.sortMode
  });

  const activeAttachmentIds = useMemo(() => [...new Set([
    ...(historyPreview?.payload.attachmentIds ?? activeDocument?.attachmentIds ?? []),
    ...attachmentIdsIn(displayedMarkdown)
  ])], [activeDocument?.attachmentIds.join("|"), displayedMarkdown, historyPreview?.item.historyId]);

  const activeAttachmentSignature = useMemo(
    () => attachmentGraphSignature(activeAttachmentIds, attachmentIndexRef.current),
    [activeAttachmentIds.join("|"), attachments]
  );

  const attachmentUrlController = useAttachmentUrls({
    userId: user.id,
    activeDocumentId: activeDocument?.objectId ?? null,
    attachmentIds: activeAttachmentIds,
    signature: activeAttachmentSignature,
    attachments: attachmentsRef,
    isActive: () => !logoutStarted.current,
    allowNetwork: serverSessionVerified,
    onError: (error) => showMessage(translateError(error, t, "notice.attachmentLoadFailed"))
  });

  const attachmentUrls = attachmentUrlController.urls;

  const attachmentUrlCache = attachmentUrlController.cache;

  const tree = useVaultTree({
    model,
    selection,
    showMessage,
    t,
    setSearch,
    setExpanded,
    finishHistorySession,
    flushDocument,
    applyDeferredActiveRemote,
    setEditorSessionId,
    setHistoryPreview,
    setTreeOpen,
    visibleTree,
    activeDocument,
    documentNavigation
  });
  const {
    treeDraggingIds,
    setTreeDraggingIds,
    treeDropTarget,
    setTreeDropTarget,
    renamingDocumentId,
    setRenamingDocumentId,
    contextMenu,
    setContextMenu,
    documentTree,
    selectDocument,
    selectPinnedEntry,
    openWikiLink,
    selectTreeEntry,
    openTreeContext,
    beginTreeDrag,
    updateTreeDropTarget,
    revealActiveDocument
  } = tree;

  const importExport = useImportExport({
    userId: user.id, getDocuments: () => documentsRef.current, getAttachments: () => attachmentsRef.current,
    reservations: nameReservations.current, isActive: () => !logoutStarted.current,
    readAttachment: (attachment, isActive, signal) => decryptAttachmentBlob(user.id, attachment, isActive, serverSessionVerifiedRef.current, signal),
    publish: (document, importedAttachments) => {
      for (const attachment of importedAttachments) upsertAttachment(attachment);
      upsertDocument(document);
      requestPush("structural");
    },
    onImported: selectDocument,
    onResult: () => setSettingsOpen(false), notify: showMessage, t
  });

  const { exportRoot, exportDocuments, handleImport } = importExport;

  useSiblingNameRepair({
    documents, enabled: workspaceLoaded && !logoutStarted.current, getDocuments: () => documentsRef.current,
    queueDocument, onRepair: (count) => showMessage(t("transfer.namesRepaired", { count }), "info")
  });

  const { lock, manualLock } = useVaultLock({
    model,
    logoutStarted,
    importExport,
    finishHistorySession,
    documentSaveQueue,
    objectPersistence,
    showMessage,
    t,
    userId: user.id,
    queueDocument,
    stopSync,
    attachmentUrlCache,
    onLocked,
    endpoint,
    credential
  });

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); };
  }, []);

  useMobileDrawerGestures({ treeOpen, outlineOpen, settingsOpen, setTreeOpen, setOutlineOpen });

  const jumpToHeading = (item: OutlineItem) => {
    documentNavigation.jumpToHeading(item);
    setOutlineOpen(false);
  };

  if (loading) return <main className="loading-shell"><div className="spinner" /><p>{t("app.loadingNotes")}</p></main>;

  if (loadFailure) return <main className="loading-shell" role="alert"><p>{loadFailure}</p></main>;

  const contextDocument = contextMenu ? documentIndexRef.current.get(contextMenu.objectId) ?? null : null;

  const contextDocuments = contextDocument
    ? documents.filter((entry) => selectedIds.has(contextDocument.objectId) ? selectedIds.has(entry.objectId) : entry.objectId === contextDocument.objectId)
    : [];

  const layoutStyle = {
    "--tree-width": `${preferences.treeWidth}px`,
    "--outline-width": `${preferences.outlineWidth}px`,
    "--font-adjust": `${preferences.fontSize - DEFAULT_FONT_SIZE}px`
  } as CSSProperties;

  const statusLabel = syncStatus.failedLocalObjectIds.size
    ? null
    : visibleSyncStatusText(syncStatus.visible, t);

  const statusDetail = syncStatusDetailText(syncStatus, t);

  return (
    <div className={`app-shell ${treeOpen ? "tree-open" : ""} ${outlineOpen ? "outline-open" : ""} ${settingsOpen ? "settings-open" : ""} ${preferences.treeCollapsed ? "tree-collapsed" : ""} ${preferences.outlineCollapsed ? "outline-collapsed" : ""}`} style={layoutStyle}>
      <WorkspaceSidebar
        searchInput={searchInput}
        search={search}
        onSearchChange={setSearch}
        onCreate={kind => { void createNewDocument(kind, null); }}
        sortMode={preferences.sortMode}
        onSortChange={sortMode => setPreferences({ ...preferences, sortMode })}
        canLocate={Boolean(activeDocument)}
        onLocate={revealActiveDocument}
        onCollapseAll={() => setExpanded(new Set())}
        onCollapse={() => setPreferences({ ...preferences, treeCollapsed: true })}
        onClose={() => setTreeOpen(false)}
        displayName={displayName}
        username={user.username}
        avatarUrl={avatarUrl}
        onLock={manualLock}
        onSettings={() => setSettingsOpen(true)}
        pinned={pinned.length > 0 && <div className="pinned-section" role="tree" aria-label={t("app.pinned")}>
          <div className="tree-section-label"><AppIcon icon={Pin} size={8} />{t("app.pinned")}</div>
          {pinned.map((entry) => <div className={`tree-row pinned-row ${entry.objectId === activeId ? "active" : ""} ${selectedIds.has(entry.objectId) ? "selected" : ""}`} key={`pinned-${entry.objectId}`} role="treeitem" aria-selected={selectedIds.has(entry.objectId)} onContextMenu={(event) => { event.preventDefault(); openTreeContext(entry, event.clientX, event.clientY); }}>
            <button className="tree-main" onClick={(event) => selectPinnedEntry(entry, event)} title={entry.kind === "folder" ? t("app.folderToggleHint") : undefined}><span className="tree-spacer" /><span className="tree-title">{entry.title || t("app.untitled")}</span>{entry.dirty && <i title={t("app.notSynced")} />}<TreeNoteLock document={entry} /></button>
            <button className="tree-more" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); openTreeContext(entry, rect.right, rect.bottom); }} aria-label={t("app.openMenu", { title: entry.title })}><AppIcon icon={Ellipsis} size={16} /></button>
          </div>)}
        </div>}
      >
        <div ref={documentTree} className="document-tree" role="tree" aria-multiselectable="true" onClick={(event) => { if (event.target === event.currentTarget) { setSelectedIds(new Set()); selectionAnchor.current = null; } }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTreeDropTarget(null); }} onDrop={(event) => { setTreeDropTarget(null); setTreeDraggingIds(new Set()); const ids = draggedDocumentIds(event.dataTransfer); if (ids.length) void moveDocuments(ids, null); }}>
          <TreeLevel childrenByParent={treeChildren} parentId={null} activeId={activeId} selectedIds={selectedIds} expanded={expanded} draggingIds={treeDraggingIds} dropTarget={treeDropTarget} renamingDocumentId={renamingDocumentId} onDropTarget={updateTreeDropTarget} onSelect={selectTreeEntry} onContext={openTreeContext} onDragSelection={beginTreeDrag} onDragFinish={() => setTreeDraggingIds(new Set())} onMove={moveDocuments} onRenameCommit={commitTreeRename} onRenameCancel={() => setRenamingDocumentId(null)} />
          {!searched.length && <p className="empty-tree">{t("app.noMatches")}</p>}
        </div>
      </WorkspaceSidebar>

      <PaneResizer label={t("app.resizeLeft")} side="left" value={preferences.treeWidth} min={TREE_WIDTH_MIN} max={TREE_WIDTH_MAX} onResize={(treeWidth) => setPreferences((current) => ({ ...current, treeWidth }))} />

      <NotePaneLayout
        editorArea={documentNavigation.editorArea}
        toolbar={<>
        <NoteToolbar
          titleInput={titleInput}
          active={Boolean(activeDocument)}
          title={historyPreview?.payload.title ?? titleDraft}
          titleReadOnly={Boolean(historyPreview) || editorMode.readOnly}
          locked={activeDocumentLocked}
          historyPreview={Boolean(historyPreview)}
          sourceMode={editorMode.sourceMode}
          readOnly={editorMode.readOnly}
          onOpenLeft={() => preferences.treeCollapsed ? setPreferences({ ...preferences, treeCollapsed: false }) : setTreeOpen(true)}
          onTitleChange={(event) => setTitleDraft(event.target.value)}
          onTitleBlur={(event) => {
            if (historyPreview || editorMode.readOnly) return;
            if (!activeDocument) return;
            const noteId = activeDocument.objectId;
            void commitDocumentTitle(noteId, event.currentTarget.value).then((updated) => {
              if (!updated) setTitleDraft(documentIndexRef.current.get(noteId)?.title ?? "");
            });
          }}
          onTitleKeyDown={(event) => { focusEditorFromTitle(event, documentNavigation.editorSurface.current); }}
          onToggleSource={editorMode.toggleSource}
          onToggleReadOnly={editorMode.toggleReadOnly}
          onToggleLock={() => void toggleActiveNoteLock()}
          onAddImage={() => attachmentInput.current?.click()}
          onOpenRight={() => preferences.outlineCollapsed ? setPreferences({ ...preferences, outlineCollapsed: false }) : setOutlineOpen(true)}
        />
        <input ref={attachmentInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            const noteId = activeDocument?.objectId;
            event.target.value = "";
            if (file && noteId && !editorMode.readOnly && !historyPreview) void addAttachment(noteId, file).then((attachment) => {
              const latest = documentIndexRef.current.get(noteId);
              if (latest && !latest.deleted && !latest.locked && !editorModeRef.current.readOnly && !editorModeRef.current.previewing) patchDocument(noteId, { markdown: latest.markdown + attachmentMarkdown(attachment.objectId, attachment.originalName) }, 0);
            }).catch((error) => showMessage(translateError(error, t, "notice.attachmentSaveFailed"), "critical"));
          }} />
        </>}
        historyBanner={historyPreview && <div className="history-preview-banner">
          <span><AppIcon icon={HistoryIcon} size={16} /><strong>{t("history.preview")}</strong><small>{formatNoteTime(historyPreview.item.capturedAt)}</small></span>
          <div>
            <button onClick={() => setHistoryPreview(null)}>{t("history.exitPreview")}</button>
            <button onClick={() => void restoreHistoryAsCopy()}><AppIcon icon={Copy} size={14} />{t("history.restoreCopy")}</button>
            <button className="primary" disabled={activeDocumentLocked} onClick={() => void restoreHistoryAsCurrent()} title={activeDocumentLocked ? t("app.unlockToEdit") : undefined}><AppIcon icon={RotateCcw} size={14} />{t("history.restoreCurrent")}</button>
            <button className="danger" disabled={!canDeleteHistory(historyPreview.item)} onClick={() => void deleteHistorySnapshot(historyPreview.item)} title={historyPreview.item.protected ? t("history.protectedDeleteHint") : t("history.deleteOne")} aria-label={t("history.deleteOne")}><AppIcon icon={Trash2} size={14} /></button>
          </div>
        </div>}
        status={<footer className="status-bar">
          <span className="status-meta" title={activeDocument ? `${t("app.createdAt", { date: formatNoteTime(activeDocument.createdAt) })} · ${t("app.updatedAt", { date: formatNoteTime(activeDocument.updatedAt) })} · ${statusDetail}` : statusDetail}>
            {activeDocument && <span className="status-note-time"><span>{t("app.createdAt", { date: formatNoteTime(activeDocument.createdAt) })}</span><span aria-hidden="true">·</span><span>{t("app.updatedAt", { date: formatNoteTime(activeDocument.updatedAt) })}</span>{statusLabel && <span aria-hidden="true">·</span>}</span>}
            {statusLabel && <span className={`status-${syncStatus.visible}`}>{statusLabel}</span>}
          </span>
          <span className="status-count" title={t("app.countHelp")}>{t("app.count", { words: statistics.words, characters: statistics.characters })}</span>
        </footer>}
      >
          {activeDocument ? historyPreview
            ? <ReadingEditor markdown={historyPreview.payload.markdown} wrapCodeBlocks={preferences.wrapCodeBlocks} attachmentUrls={attachmentUrls} onWikiLink={openWikiLink} />
            : <MarkdownEditor ref={documentNavigation.editorSurface} key={editorSessionId} documentKey={activeDocument.objectId} markdown={activeDocument.markdown} mode={effectiveMode} readOnly={editorMode.readOnly} wrapCodeBlocks={preferences.wrapCodeBlocks} emptyHint={t("app.emptyNoteHint")} attachmentUrls={attachmentUrls} attachmentsPending={attachmentUrlController.loading} onChange={noteEditor.onChange} onWikiLink={openWikiLink} onImageInsert={noteEditor.onImageInsert} onInsertionCancelled={() => showMessage(t("editor.insertRetry"), "critical")} onModeChange={editorMode.onModeChange} />
            : <EmptyEditor />}
      </NotePaneLayout>

      <PaneResizer label={t("app.resizeRight")} side="right" value={preferences.outlineWidth} min={OUTLINE_WIDTH_MIN} max={OUTLINE_WIDTH_MAX} onResize={(outlineWidth) => setPreferences((current) => ({ ...current, outlineWidth }))} />

      <aside className="outline-pane">
        <WorkspacePanelHeader
          tab={preferences.rightPanelTab}
          onTabChange={rightPanelTab => setPreferences({ ...preferences, rightPanelTab })}
          onCollapse={() => setPreferences({ ...preferences, outlineCollapsed: true })}
          onClose={() => setOutlineOpen(false)}
        />
        <section className="right-panel-content" aria-label={preferences.rightPanelTab === "outline" ? t("app.noteOutline") : t("history.list")}>
          {preferences.rightPanelTab === "outline"
            ? <WorkspaceOutline key={historyPreview?.item.historyId ?? activeDocument?.objectId ?? ""} items={outline} editorArea={documentNavigation.editorArea}
                mode={historyPreview ? "reading" : effectiveMode} collapsed={preferences.outlineCollapsed} open={outlineOpen} onSelect={jumpToHeading} />
            : <HistoryPanel
                items={historyItems}
                selectedId={historyPreview?.item.historyId ?? null}
                loading={historyLoading}
                hasMore={historyHasMore}
                disabled={!activeDocument}
                onSelect={(item) => void selectHistorySnapshot(item)}
                onSave={() => void saveCurrentHistory()}
                renamingId={renamingHistoryId}
                onBeginRename={(item) => setRenamingHistoryId(item.historyId)}
                onRename={(item, name) => { void renameHistorySnapshot(item, name); }}
                onRenameCancel={() => setRenamingHistoryId(null)}
                onToggleProtection={(item) => { void toggleHistoryProtection(item); }}
                onDelete={(item) => void deleteHistorySnapshot(item)}
                onClear={() => void clearCurrentHistory()}
                onLoadMore={() => activeDocument && void loadHistory(activeDocument.objectId, historyCursor, true)}
              />}
        </section>
      </aside>

      {(treeOpen || outlineOpen) && <button className="drawer-scrim" onClick={() => { setTreeOpen(false); setOutlineOpen(false); }} aria-label={t("app.closeSidebars")} />}
      {importExport.result && <ImportResultPanel result={importExport.result} onClose={importExport.dismiss} />}
      {contextMenu && contextDocument && <ContextMenu document={contextDocument} selection={contextDocuments} documents={documents} position={contextMenu} onClose={() => setContextMenu(null)} onSelect={selectDocument} onRename={renameDocument} onToggleLock={toggleNoteLock} onCreate={createNewDocument} onDuplicate={duplicateDocuments} onExport={exportDocuments} onPin={pinDocuments} onDelete={(ids) => setDeletedMany(ids, true)} onRestore={(ids) => setDeletedMany(ids, false)} onPurge={requestPurgeDocuments} />}
      {settingsOpen && <Suspense fallback={<SettingsPanelLoading onClose={() => setSettingsOpen(false)} />}><SettingsPanel user={{ ...user, displayName }} endpoint={endpoint} credential={credential} serverSessionVerified={serverSessionVerified} onCredentialChange={onCredentialChange} preferences={preferences} onPreferences={setPreferences} onClose={() => setSettingsOpen(false)} onLogout={() => lock(true)} onImport={handleImport} onExport={() => exportRoot(null)} onDisplayName={(nextDisplayName) => { setDisplayName(nextDisplayName); onDisplayNameChange(nextDisplayName); }} onUsername={onUsernameChange} avatarUrl={avatarUrl} onAvatarChange={updateAvatarUrl} trashItems={trashItems} purging={purging} onRestoreTrash={(objectId) => setDeletedMany([objectId], false)} onPurgeTrash={(objectId) => requestPurgeDocuments([objectId])} onClearTrash={requestClearTrash} historySettings={historySettings} onHistorySettings={applyHistorySettings} onRefreshHistorySettings={refreshHistorySettings} onClearHistory={clearAllHistory} onNotify={showMessage} /></Suspense>}
      <ToastStack notices={notices} onDismiss={dismissMessage} />
    </div>
  );
}
