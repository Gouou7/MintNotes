import { ToastProvider } from "../../components/ui/toast";
import { Spinner } from "../../components/ui/spinner";
import { WorkspaceDrawer } from "./WorkspaceDrawer";
import { useMediaQuery } from "../useMediaQuery";
import { Button } from "@/components/ui/button";
import { Confirmation, useConfirmation } from "../../components/Confirmation";
import { useWorkspaceServices } from "../session/workspaceServices";
import { useStorageStatus } from "../storage/useStorageStatus";
import {
  Copy,
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
import type { OpenDocument, OutlineItem } from "../../types";
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
import { useWorkspaceClose } from "./useWorkspaceClose";
import { hasDevicePin } from "../../crypto/deviceUnlock";
import type { VaultAppProps } from "./VaultApp";
import { useVaultModel } from "./useVaultModel";
import { useVaultPreferences } from "./useVaultPreferences";
import { useVaultProfile } from "./useVaultProfile";
import { useVaultSync } from "./useVaultSync";
import { useVaultTrash } from "./useVaultTrash";
import { useVaultTree } from "./useVaultTree";
import { useWorkspaceEditorMode } from "./useWorkspaceEditorMode";
import { useMobileDrawerGestures, useWorkspaceAutoLock } from "./useWorkspaceInteractions";
import { useWorkspaceSelection } from "./useWorkspaceSelection";
import { draggedDocumentIds, TreeLevel, TreeNoteLock, TreeRowMenu, type TreeMenuActions } from "./VaultTree";
import { WorkspacePanelHeader, WorkspaceSidebar } from "./WorkspaceChrome";
import { WorkspaceOutline } from "./WorkspaceOutline";

const SettingsPanel = lazy(() => import("../SettingsPanel").then((module) => ({ default: module.SettingsPanel })));

const TREE_WIDTH_MIN = 220;
const TREE_WIDTH_MAX = 420;
const OUTLINE_WIDTH_MIN = 200;
const OUTLINE_WIDTH_MAX = 420;

export function VaultWorkspace(props: VaultAppProps) {
  return <ToastProvider limit={Infinity}><Workspace {...props} /></ToastProvider>;
}

function Workspace({
  user,
  endpoint,
  credential,
  serverSessionVerified,
  onCredentialChange,
  onDisplayNameChange,
  onUsernameChange,
  onLock,
  onLogout,
  renderAccountSwitcher,
  visible = true,
  registerClose
}: VaultAppProps) {
  const services = useWorkspaceServices();
  const confirmation = useConfirmation();
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const requestConfirmation: typeof confirmation.request = (options, signal) =>
    visibleRef.current ? confirmation.request(options, signal) : Promise.resolve(false);
  const shell = useRef<HTMLDivElement>(null);
  const compactTree = useMediaQuery("(max-width: 720px)");
  const compactRight = useMediaQuery("(max-width: 1100px)");
  useEffect(() => {
    if (!visible) confirmation.cancel();
  }, [visible, confirmation.cancel]);
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

  const { showMessage } = useToastNotifications();

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
    services,
    history,
    userId: user.id,
    logoutStarted,
    showMessage,
    t,
    generation,
    requestPush
  });

  const sync = useVaultSync({
    endpointId: endpoint.id,
    hasUnsavedChanges: () => syncStatus.failedLocalObjectIds.size > 0 || Boolean(selection.activeIdRef.current && documentIndexRef.current.get(selection.activeIdRef.current)?.title !== titleDraft),
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

  const storageStatus = useStorageStatus({ userId: user.id, endpointId: endpoint.id,
    online: serverSessionVerified, detailed: settingsOpen, enabled: workspaceLoaded && !logoutStarted.current, notify: showMessage,
    getUnsavedCount: () => new Set([...documentSaveQueue.pendingIds(), ...[...syncStatus.failedLocalObjectIds].filter((id) => documentIndexRef.current.get(id)?.kind === "note"),
      ...(selection.activeIdRef.current && documentIndexRef.current.get(selection.activeIdRef.current)?.title !== titleDraft ? [selection.activeIdRef.current] : [])]).size });

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
    confirm: requestConfirmation,
    sessionVerified: () => visibleRef.current && !logoutStarted.current && serverSessionVerifiedRef.current,
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
    confirm: requestConfirmation,
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
    confirm: requestConfirmation,
    userId: user.id, getDocuments: () => documentsRef.current, getAttachments: () => attachmentsRef.current,
    reservations: nameReservations.current, isActive: () => !logoutStarted.current,
    beforeExport: async () => { if (selection.activeIdRef.current) { if (documentIndexRef.current.get(selection.activeIdRef.current)?.title !== titleDraft && !await commitDocumentTitle(selection.activeIdRef.current, titleDraft)) throw new Error("Export title is not saved"); await flushDocument(selection.activeIdRef.current); } await documentSaveQueue.flushAll(); await objectPersistence.drainAll(); },
    readAttachment: (attachment, isActive, signal) => decryptAttachmentBlob(user.id, attachment, isActive, serverSessionVerifiedRef.current, signal, services),
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

  const closingWorkspace = useWorkspaceClose({
    cancelConfirmation: confirmation.cancel,
    logoutStarted, importExport, finishHistorySession, documentSaveQueue, objectPersistence,
    showMessage, t, stopSync, registerClose
  });
  useWorkspaceAutoLock({
    minutes: credential?.autoLockMinutes, userId: user.id, endpointId: endpoint.id, onLock
  });


  useMobileDrawerGestures({ treeOpen, outlineOpen, settingsOpen, setTreeOpen, setOutlineOpen });

  const jumpToHeading = (item: OutlineItem) => {
    documentNavigation.jumpToHeading(item);
    setOutlineOpen(false);
  };

  if (loading) return <main className="loading-shell"><Spinner className="spinner" aria-hidden="true" /><p>{t("app.loadingNotes")}</p></main>;

  if (loadFailure) return <main className="loading-shell" role="alert"><p>{loadFailure}</p></main>;

  const menuActions: TreeMenuActions = {
    selection: (entry) => selectedIds.has(entry.objectId) ? documents.filter((document) => selectedIds.has(document.objectId)) : [entry],
    documents, onSelect: selectDocument, onRename: renameDocument, onToggleLock: toggleNoteLock,
    onCreate: createNewDocument, onDuplicate: duplicateDocuments, onExport: exportDocuments, onPin: pinDocuments,
    onDelete: (ids) => setDeletedMany(ids, true), onRestore: (ids) => setDeletedMany(ids, false), onPurge: requestPurgeDocuments
  };

  const layoutStyle = {
    "--tree-width": `${preferences.treeWidth}px`,
    "--outline-width": `${preferences.outlineWidth}px`,
    "--font-adjust": `${preferences.fontSize - DEFAULT_FONT_SIZE}px`
  } as CSSProperties;

  const statusLabel = syncStatus.failedLocalObjectIds.size
    ? null
    : visibleSyncStatusText(syncStatus.visible, t);

  const statusDetail = syncStatusDetailText(syncStatus, t);

  const inTreeDrawer = compactTree && treeOpen;
  const inRightDrawer = compactRight && outlineOpen;
  const confirmDialog = visible && <Confirmation current={confirmation.current} />;
  const settingsDialog = settingsOpen && visible && !closingWorkspace && (
    <Suspense fallback={<SettingsPanelLoading onClose={() => setSettingsOpen(false)} />}>
      <SettingsPanel confirmationDialog={confirmDialog} storageStatus={storageStatus} user={{ ...user, displayName }}
        endpoint={endpoint} credential={credential} serverSessionVerified={serverSessionVerified} onCredentialChange={onCredentialChange}
        preferences={preferences} onPreferences={setPreferences} onClose={() => setSettingsOpen(false)} onLogout={onLogout}
        onImport={handleImport} onExport={() => exportRoot(null)}
        onDisplayName={(name) => { setDisplayName(name); onDisplayNameChange(name); }} onUsername={onUsernameChange}
        avatarUrl={avatarUrl} onAvatarChange={updateAvatarUrl} trashItems={trashItems} purging={purging}
        onRestoreTrash={(id) => setDeletedMany([id], false)} onPurgeTrash={(id) => requestPurgeDocuments([id])} onClearTrash={requestClearTrash}
        historySettings={historySettings} onHistorySettings={applyHistorySettings} onRefreshHistorySettings={refreshHistorySettings}
        onClearHistory={clearAllHistory} onNotify={showMessage} />
    </Suspense>
  );

  return (
    <div ref={shell} inert={closingWorkspace} className={`app-shell ${treeOpen ? "tree-open" : ""} ${outlineOpen ? "outline-open" : ""} ${settingsOpen ? "settings-open" : ""} ${preferences.treeCollapsed ? "tree-collapsed" : ""} ${preferences.outlineCollapsed ? "outline-collapsed" : ""}`} style={layoutStyle}>
      <WorkspaceDrawer compact={compactTree} open={visible && !closingWorkspace && treeOpen} side="left" title={t("app.openLeft")} container={shell} onClose={() => setTreeOpen(false)}>
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
        onLock={hasDevicePin(credential) ? onLock : undefined}
        accountSwitcher={hasDevicePin(credential) ? undefined : renderAccountSwitcher?.(avatarUrl)}
        onSettings={() => setSettingsOpen(true)}
        pinned={pinned.length > 0 && <div className="pinned-section" role="tree" aria-label={t("app.pinned")}>
          <div className="tree-section-label"><AppIcon icon={Pin} size={8} />{t("app.pinned")}</div>
          {pinned.map((entry) => <TreeRowMenu key={`pinned-${entry.objectId}`} document={entry} actions={menuActions} onOpen={() => openTreeContext(entry)} row={(more) => <div className={`tree-row pinned-row ${entry.objectId === activeId ? "active" : ""} ${selectedIds.has(entry.objectId) ? "selected" : ""}`} role="treeitem" aria-selected={selectedIds.has(entry.objectId)}>
            <Button className="tree-main" onClick={(event) => selectPinnedEntry(entry, event)} title={entry.kind === "folder" ? t("app.folderToggleHint") : undefined}><span className="tree-spacer" /><span className="tree-title">{entry.title || t("app.untitled")}</span>{entry.dirty && <i title={t("app.notSynced")} />}<TreeNoteLock document={entry} /></Button>
            {more}
          </div>} />)}
        </div>}
      >
        <div ref={documentTree} className="document-tree" role="tree" aria-multiselectable="true" onClick={(event) => { if (event.target === event.currentTarget) { setSelectedIds(new Set()); selectionAnchor.current = null; } }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTreeDropTarget(null); }} onDrop={(event) => { setTreeDropTarget(null); setTreeDraggingIds(new Set()); const ids = draggedDocumentIds(event.dataTransfer); if (ids.length) void moveDocuments(ids, null); }}>
          <TreeLevel menuActions={menuActions} childrenByParent={treeChildren} parentId={null} activeId={activeId} selectedIds={selectedIds} expanded={expanded} draggingIds={treeDraggingIds} dropTarget={treeDropTarget} renamingDocumentId={renamingDocumentId} onDropTarget={updateTreeDropTarget} onSelect={selectTreeEntry} onContext={openTreeContext} onDragSelection={beginTreeDrag} onDragFinish={() => setTreeDraggingIds(new Set())} onMove={moveDocuments} onRenameCommit={commitTreeRename} onRenameCancel={() => setRenamingDocumentId(null)} />
          {!searched.length && <p className="empty-tree">{t("app.noMatches")}</p>}
        </div>
      </WorkspaceSidebar>
      {inTreeDrawer && (settingsDialog || confirmDialog)}
      </WorkspaceDrawer>

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
          onOpenLeft={() => compactTree ? setTreeOpen(true) : setPreferences({ ...preferences, treeCollapsed: false })}
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
          onOpenRight={() => compactRight ? setOutlineOpen(true) : setPreferences({ ...preferences, outlineCollapsed: false })}
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
            <Button onClick={() => setHistoryPreview(null)}>{t("history.exitPreview")}</Button>
            <Button onClick={() => void restoreHistoryAsCopy()}><AppIcon icon={Copy} size={14} />{t("history.restoreCopy")}</Button>
            <Button className="primary" disabled={activeDocumentLocked} onClick={() => void restoreHistoryAsCurrent()} title={activeDocumentLocked ? t("app.unlockToEdit") : undefined}><AppIcon icon={RotateCcw} size={14} />{t("history.restoreCurrent")}</Button>
            <Button className="danger" disabled={!canDeleteHistory(historyPreview.item)} onClick={() => void deleteHistorySnapshot(historyPreview.item)} title={historyPreview.item.protected ? t("history.protectedDeleteHint") : t("history.deleteOne")} aria-label={t("history.deleteOne")}><AppIcon icon={Trash2} size={14} /></Button>
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

      <WorkspaceDrawer compact={compactRight} open={visible && !closingWorkspace && outlineOpen} side="right" title={t("app.rightPanel")} container={shell} onClose={() => setOutlineOpen(false)}>
      <aside className="outline-pane">
        <WorkspacePanelHeader
          tab={preferences.rightPanelTab}
          onTabChange={rightPanelTab => setPreferences({ ...preferences, rightPanelTab })}
          onCollapse={() => setPreferences({ ...preferences, outlineCollapsed: true })}
          onClose={() => setOutlineOpen(false)}
        >
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
        </WorkspacePanelHeader>
      </aside>
      {inRightDrawer && !settingsOpen && confirmDialog}
      </WorkspaceDrawer>

      {visible && importExport.result && <ImportResultPanel result={importExport.result} onClose={importExport.dismiss} />}
      {!settingsOpen && !inTreeDrawer && !inRightDrawer && confirmDialog}
      {!inTreeDrawer && settingsDialog}
      {visible && <ToastStack />}
    </div>
  );
}
