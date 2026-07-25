import { type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownAZ,
  ChevronDown,
  ChevronRight,
  Copy,
  Ellipsis,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  History as HistoryIcon,
  ImagePlus,
  ListCollapse,
  ListTree,
  LocateFixed,
  LockKeyhole,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { ApiError, api, uploadAttachmentChunk } from "./api";
import { AppIcon } from "./components/AppIcon";
import { PaneResizer } from "./components/PaneResizer";
import { HistoryPanel } from "./components/HistoryPanel";
import { Toast, type ToastNotice, type ToastTone } from "./components/Toast";
import { TreeRenameInput } from "./components/TreeRenameInput";
import { cryptoClient, type EncryptedProfileAvatar } from "./crypto/client";
import {
  broadcastAccountLogout,
  clearCurrentBrowserSessionGrant,
  clearPendingEndpointRevocation,
  forgetDeviceUnlock,
  flushPendingEndpointRevocations,
  getDeviceUnlock,
  grantCurrentBrowserSession,
  hasCurrentBrowserSessionGrant,
  hasDevicePin,
  listenForBrowserSessionGrantRequests,
  rememberDeviceUnlock,
  requestBrowserSessionGrant,
  restoreDeviceUnlock
} from "./crypto/deviceUnlock";
import { buildOutline } from "./editor/outline";
import { ReadOnlyMarkdown } from "./editor/ReadOnlyMarkdown";
import { TyporaEditor } from "./editor/TyporaEditor";
import { attachmentIdsIn, attachmentMarkdown, createLocalAttachment, decryptAttachmentBlob } from "./features/attachments";
import { documentPatchChanges } from "./features/documentPatch";
import { exportMarkdownZip, exportSingleMarkdown, importFiles } from "./features/importExport";
import { SettingsPanel } from "./features/SettingsPanel";
import {
  SyncCoordinator,
  acknowledgeByObjectId,
  mergeByObjectId,
  packBySerializedSize,
  type SyncIntent
} from "./features/syncCoordinator";
import { decryptAvailableLocalObjects, decryptFailureFingerprint } from "./features/vaultLoad";
import { canMoveDocument, compareDocuments, descendantsOf, isFolderDropZone, nextManualOrder, pinnedDocuments, reorderedSiblings, selectionRoots, siblingTitleExists, treeSelectionRange, uniqueSiblingTitle } from "./features/tree";
import { formatNoteTime } from "./features/noteTime";
import {
  DEFAULT_HISTORY_SETTINGS,
  historyContentChanged,
  historyContentSignature,
  localHistoryListItem,
  makeHistoryPayload,
  mergeHistoryItems,
  shouldCaptureHistoryBaseline
} from "./features/history";
import { focusAndSelectName } from "./features/focusName";
import { countText } from "./features/wordCount";
import { AuthScreen } from "./features/AuthScreen";
import { LockScreen } from "./features/LockScreen";
import { isLanguagePreference, translateError, useI18n, type Translate } from "./i18n";
import {
  makeWorkspaceDocument,
  parseWorkspaceState,
  WORKSPACE_OBJECT_ID,
  workspaceStateEquals,
  type WorkspaceState
} from "./features/workspace";
import {
  chunkKey,
  cursorKey,
  deleteLocalUserData,
  ignoredDecryptFailuresKey,
  historyKey,
  historySettingsKey,
  localDb,
  localKey,
  preferencesKey,
  type LocalEncryptedObject,
  type LocalHistorySnapshot,
  type HistoryOutboxEntry,
  type OutboxEntry,
  type DeviceUnlockCredential
} from "./storage/database";
import type {
  AuthEndpoint,
  EncryptedHistorySnapshot,
  HistoryCaptureKind,
  HistoryListItem,
  HistorySettings,
  NoteHistoryPayload,
  OpenAttachment,
  OpenDocument,
  SyncChange,
  UiPreferences,
  User,
  VaultObject
} from "./types";

type EditorMode = "live" | "source" | "readonly";
type SaveState = "ready" | "saving" | "local" | "syncing" | "synced" | "offline" | "error";
type CachedAttachmentUrl = { signature: string; url: string };
type CreateDocumentOptions = { focusName?: boolean };

const DEFAULT_PREFERENCES: UiPreferences = {
  theme: "system",
  fontSize: "standard",
  language: "system",
  sortMode: "alphabetical",
  treeCollapsed: false,
  outlineCollapsed: false,
  treeWidth: 272,
  outlineWidth: 236,
  rightPanelTab: "outline"
};

const TREE_WIDTH_MIN = 220;
const TREE_WIDTH_MAX = 420;
const OUTLINE_WIDTH_MIN = 200;
const OUTLINE_WIDTH_MAX = 420;
const MULTI_DRAG_TYPE = "application/x-webmd-objects";

function draggedIds(dataTransfer: DataTransfer): string[] {
  const multiple = dataTransfer.getData(MULTI_DRAG_TYPE);
  if (multiple) {
    try {
      const parsed = JSON.parse(multiple);
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) return parsed;
    } catch {
      // Fall back to the single-item payload used by older clients.
    }
  }
  const single = dataTransfer.getData("application/x-webmd-object");
  return single ? [single] : [];
}

function plainObject(object: OpenDocument | OpenAttachment): VaultObject {
  const { objectId: _objectId, serverRevision: _serverRevision, dirty: _dirty, ...plain } = object;
  return plain;
}

function makeDocument(
  documents: OpenDocument[],
  kind: "note" | "folder",
  title: string,
  parentId: string | null,
  markdown = ""
): OpenDocument {
  const now = new Date().toISOString();
  return {
    objectId: crypto.randomUUID(),
    kind,
    title,
    markdown,
    parentId,
    tags: [],
    favorite: false,
    deleted: false,
    createdAt: now,
    updatedAt: now,
    manualOrder: nextManualOrder(documents, parentId),
    attachmentIds: [],
    schemaVersion: 2,
    serverRevision: 0,
    dirty: true
  };
}

function statusText(state: SaveState, t: Translate) {
  return ({
    ready: t("app.save.ready"),
    saving: t("app.save.saving"),
    local: t("app.save.local"),
    syncing: t("app.save.syncing"),
    synced: t("app.save.synced"),
    offline: t("app.save.offline"),
    error: t("app.save.error")
  } satisfies Record<SaveState, string>)[state];
}

function attachmentDisplaySignature(attachment: OpenAttachment): string {
  return [attachment.objectId, attachment.deleted, attachment.updatedAt, attachment.sha256].join(":");
}

export default function App() {
  const { t } = useI18n();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<{ user: User; endpoint: AuthEndpoint } | null>(null);
  const [credential, setCredential] = useState<DeviceUnlockCredential | null>(null);
  const [restoringDevice, setRestoringDevice] = useState(true);

  useEffect(() => listenForBrowserSessionGrantRequests(), []);

  useEffect(() => {
    let active = true;
    void flushPendingEndpointRevocations().then(() => api<{ user: User; endpoint: AuthEndpoint }>("/api/auth/me"))
      .then(async ({ user: sessionUser, endpoint }) => {
        const stored = await getDeviceUnlock(sessionUser.id, endpoint.id);
        if (!stored) return;
        const browserSessionGranted = hasCurrentBrowserSessionGrant(endpoint.id) || await requestBrowserSessionGrant(endpoint.id);
        if (stored.mode === "session" && !browserSessionGranted) {
          await forgetDeviceUnlock(sessionUser.id);
          await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
          return;
        }
        if (!active) return;
        setSession({ user: sessionUser, endpoint });
        setCredential(stored);
        const needsPin = hasDevicePin(stored);
        if (!needsPin && await restoreDeviceUnlock(sessionUser.id, endpoint.id) && active) setUser(sessionUser);
      })
      .catch(async (value) => {
        if (!(value instanceof ApiError) || value.status !== 401) return;
        const credentials = await localDb.deviceCredentials.toArray();
        await Promise.all(credentials.map((entry) => forgetDeviceUnlock(entry.userId)));
      })
      .finally(() => { if (active) setRestoringDevice(false); });
    return () => { active = false; };
  }, []);

  const handleUnlocked = async (unlockedUser: User, endpoint: AuthEndpoint) => {
    await clearPendingEndpointRevocation(endpoint.id).catch(() => undefined);
    const stored = await rememberDeviceUnlock(unlockedUser.id, endpoint.id, endpoint.remembered ? "remembered" : "session").catch(() => undefined);
    setSession({ user: unlockedUser, endpoint });
    setCredential(stored ?? null);
    setUser(unlockedUser);
  };

  const logoutLockedSession = async () => {
    const endpointId = session?.endpoint.id;
    if (session) {
      await deleteLocalUserData(session.user.id);
      broadcastAccountLogout(session.user.id);
    }
    clearCurrentBrowserSessionGrant();
    await cryptoClient.lock().catch(() => undefined);
    const loggedOut = await api("/api/auth/logout", { method: "POST" }).then(() => true).catch(() => false);
    if (loggedOut && endpointId) await clearPendingEndpointRevocation(endpointId).catch(() => undefined);
    setUser(null);
    setSession(null);
    setCredential(null);
  };

  const handleTrustExhausted = async () => {
    const endpointId = session?.endpoint.id;
    if (session) await forgetDeviceUnlock(session.user.id).catch(() => undefined);
    clearCurrentBrowserSessionGrant();
    await cryptoClient.lock().catch(() => undefined);
    const loggedOut = await api("/api/auth/logout", { method: "POST" }).then(() => true).catch(() => false);
    if (loggedOut && endpointId) await clearPendingEndpointRevocation(endpointId).catch(() => undefined);
    setUser(null);
    setSession(null);
    setCredential(null);
  };

  useEffect(() => {
    const invalidate = () => {
      const current = session;
      void (async () => {
        if (current) await forgetDeviceUnlock(current.user.id).catch(() => undefined);
        await cryptoClient.lock().catch(() => undefined);
        setUser(null);
        setSession(null);
        setCredential(null);
      })();
    };
    window.addEventListener("webmd:session-invalid", invalidate);
    return () => window.removeEventListener("webmd:session-invalid", invalidate);
  }, [session]);

  useEffect(() => {
    const logoutAcrossTabs = (event: Event) => {
      const userId = (event as CustomEvent<{ userId?: string }>).detail?.userId;
      const current = session;
      if (!current || current.user.id !== userId) return;
      clearCurrentBrowserSessionGrant();
      setUser(null);
      setSession(null);
      setCredential(null);
      void cryptoClient.lock()
        .catch(() => undefined)
        .then(() => deleteLocalUserData(current.user.id).catch(() => undefined));
    };
    window.addEventListener("webmd:local-account-logout", logoutAcrossTabs);
    return () => window.removeEventListener("webmd:local-account-logout", logoutAcrossTabs);
  }, [session]);

  if (restoringDevice) return <main className="loading-shell"><div className="spinner" /><p>{t("lock.restoring")}</p></main>;
  if (!user && session && credential) return <LockScreen
    user={session.user}
    endpoint={session.endpoint}
    credential={credential}
    onUnlocked={async (refreshCredential) => {
      if (refreshCredential) {
        const next = await rememberDeviceUnlock(session.user.id, session.endpoint.id, credential.mode);
        setCredential(next);
      }
      grantCurrentBrowserSession(session.endpoint.id);
      setUser(session.user);
    }}
    onTrustExhausted={handleTrustExhausted}
    onLogout={logoutLockedSession}
  />;
  if (!user) return <AuthScreen onUnlocked={handleUnlocked} />;
  return <VaultApp
    key={user.id}
    user={user}
    endpoint={session!.endpoint}
    credential={credential}
    onCredentialChange={setCredential}
    onLocked={(logout) => {
      setUser(null);
      if (logout) { setSession(null); setCredential(null); }
      else void getDeviceUnlock(user.id, session!.endpoint.id).then((next) => setCredential(next ?? null));
    }}
  />;
}

function VaultApp({ user, endpoint, credential, onCredentialChange, onLocked }: {
  user: User;
  endpoint: AuthEndpoint;
  credential: DeviceUnlockCredential | null;
  onCredentialChange: (credential: DeviceUnlockCredential | null) => void;
  onLocked: (logout: boolean) => void;
}) {
  const { languagePreference, setLanguagePreference, t } = useI18n();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const avatarUrlRef = useRef<string | null>(null);
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const documentsRef = useRef<OpenDocument[]>([]);
  const documentIndexRef = useRef(new Map<string, OpenDocument>());
  const [attachments, setAttachments] = useState<OpenAttachment[]>([]);
  const attachmentsRef = useRef<OpenAttachment[]>([]);
  const attachmentIndexRef = useRef(new Map<string, OpenAttachment>());
  const [workspaceRecord, setWorkspaceRecord] = useState<OpenDocument | null>(null);
  const workspaceRecordRef = useRef<OpenDocument | null>(null);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const [editorSessionId, setEditorSessionId] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionAnchor = useRef<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [mode, setMode] = useState<EditorMode>("live");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [folderDropTarget, setFolderDropTarget] = useState<string | null>(null);
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState<UiPreferences>(() => ({ ...DEFAULT_PREFERENCES, language: languagePreference }));
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>(navigator.onLine ? "ready" : "offline");
  const [message, setMessage] = useState<ToastNotice | null>(null);
  const messageSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [attachmentUrls, setAttachmentUrls] = useState<Map<string, string>>(new Map());
  const attachmentUrlCache = useRef<Map<string, CachedAttachmentUrl>>(new Map());
  const [contextMenu, setContextMenu] = useState<{ objectId: string; x: number; y: number } | null>(null);
  const [purging, setPurging] = useState(false);
  const [historySettings, setHistorySettings] = useState<HistorySettings>(DEFAULT_HISTORY_SETTINGS);
  const historySettingsRef = useRef<HistorySettings>(DEFAULT_HISTORY_SETTINGS);
  const [historyItems, setHistoryItems] = useState<HistoryListItem[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<{ item: HistoryListItem; payload: NoteHistoryPayload } | null>(null);
  const historyLastSignature = useRef(new Map<string, string>());
  const historyLastCapturedAt = useRef(new Map<string, number>());
  const historyQuotaPaused = useRef(false);
  const historyIdleTimer = useRef<number | null>(null);
  const historyPeriodicTimer = useRef<number | null>(null);
  const historySession = useRef<{ noteId: string; active: boolean } | null>(null);
  const saveTimers = useRef(new Map<string, number>());
  const saveDeadlines = useRef(new Map<string, number>());
  const logoutStarted = useRef(false);
  const generation = useRef(0);
  const syncClientId = useRef(crypto.randomUUID());
  const syncCoordinator = useRef<SyncCoordinator | null>(null);
  const executeSyncRef = useRef<(intent: SyncIntent) => Promise<void>>(async () => undefined);
  const eventSource = useRef<EventSource | null>(null);
  const safetyTimer = useRef<number | null>(null);
  const fallbackTimer = useRef<number | null>(null);
  const fallbackDelay = useRef(60_000);
  const syncStatusTimer = useRef<number | null>(null);
  const deferredActiveRemote = useRef<OpenDocument | null>(null);
  const deferredActiveRemoteId = useRef<string | null>(null);
  const documentTree = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const editorArea = useRef<HTMLDivElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const pendingTitleFocus = useRef<string | null>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // React StrictMode replays effect setup and cleanup once in development.
    // Reset the barrier on every real setup so that replay cannot make the
    // subsequent vault-load effect look like a logout.
    logoutStarted.current = false;
    return () => {
      logoutStarted.current = true;
      for (const timer of saveTimers.current.values()) window.clearTimeout(timer);
      saveTimers.current.clear();
      saveDeadlines.current.clear();
      if (historyIdleTimer.current !== null) window.clearTimeout(historyIdleTimer.current);
      if (historyPeriodicTimer.current !== null) window.clearTimeout(historyPeriodicTimer.current);
      historyIdleTimer.current = null;
      historyPeriodicTimer.current = null;
    };
  }, []);

  const showMessage = (text: string, tone: ToastTone = "warning", action?: ToastNotice["action"]) => {
    setMessage({ id: ++messageSequence.current, text, tone, action });
  };

  const applyHistorySettings = (settings: HistorySettings) => {
    historySettingsRef.current = settings;
    historyQuotaPaused.current = settings.usedBytes >= settings.quotaBytes;
    setHistorySettings(settings);
    void localDb.meta.put({ key: historySettingsKey(user.id), value: JSON.stringify(settings) });
  };

  const refreshHistorySettings = async (): Promise<HistorySettings> => {
    const settings = await api<HistorySettings>("/api/account/note-history-settings");
    applyHistorySettings(settings);
    return settings;
  };

  useEffect(() => {
    let cancelled = false;
    void localDb.meta.get(historySettingsKey(user.id))
      .then((stored) => {
        if (!stored || cancelled) return;
        const parsed = JSON.parse(stored.value) as Partial<HistorySettings>;
        applyHistorySettings({ ...DEFAULT_HISTORY_SETTINGS, ...parsed });
      })
      .catch(() => undefined)
      .then(() => refreshHistorySettings())
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [user.id]);

  useEffect(() => {
    if (historySettings.enabled) return;
    if (historyIdleTimer.current !== null) window.clearTimeout(historyIdleTimer.current);
    if (historyPeriodicTimer.current !== null) window.clearTimeout(historyPeriodicTimer.current);
    historyIdleTimer.current = null;
    historyPeriodicTimer.current = null;
    if (historySession.current) historySession.current.active = false;
  }, [historySettings.enabled]);

  const localHistoryForNote = async (noteId: string): Promise<LocalHistorySnapshot[]> => {
    const rows = await localDb.historySnapshots.where("[userId+noteId]").equals([user.id, noteId]).toArray();
    return rows.sort((left, right) => (
      right.capturedAt.localeCompare(left.capturedAt) || right.historyId.localeCompare(left.historyId)
    ));
  };

  const saveHistorySnapshot = async (
    document: OpenDocument,
    captureKind: HistoryCaptureKind
  ): Promise<LocalHistorySnapshot | null> => {
    if (logoutStarted.current || document.kind !== "note" || document.deleted) return null;
    const capturedAt = new Date().toISOString();
    const payload = makeHistoryPayload({
      ...document,
      attachmentIds: [...new Set([...document.attachmentIds, ...attachmentIdsIn(document.markdown)])]
    }, capturedAt);
    const signature = historyContentSignature(payload);
    let latestSignature = historyLastSignature.current.get(document.objectId);
    if (latestSignature === undefined) {
      const latest = (await localHistoryForNote(document.objectId))[0];
      if (latest) {
        try {
          const decrypted = await cryptoClient.decryptHistory(
            user.id,
            latest.noteId,
            latest.historyId,
            latest.capturedAt,
            latest.captureKind,
            latest.ciphertext,
            latest.nonce
          );
          latestSignature = historyContentSignature(decrypted);
          historyLastSignature.current.set(document.objectId, latestSignature);
          historyLastCapturedAt.current.set(document.objectId, new Date(latest.capturedAt).getTime());
        } catch {
          // A damaged cached snapshot must not block a new valid checkpoint.
        }
      }
    }
    if (latestSignature === signature) return null;

    const historyId = crypto.randomUUID();
    const encrypted = await cryptoClient.encryptHistory(
      user.id,
      document.objectId,
      historyId,
      capturedAt,
      captureKind,
      payload
    );
    const key = historyKey(user.id, document.objectId, historyId);
    const nextGeneration = Date.now() * 1000 + ++generation.current;
    const snapshot: LocalHistorySnapshot = {
      key,
      userId: user.id,
      noteId: document.objectId,
      historyId,
      capturedAt,
      captureKind,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      encryptionVersion: encrypted.encryptionVersion,
      byteSize: encrypted.ciphertext.length,
      pending: true
    };
    const outbox: HistoryOutboxEntry = {
      ...snapshot,
      idempotencyKey: crypto.randomUUID(),
      generation: nextGeneration
    };
    await localDb.transaction("rw", localDb.historySnapshots, localDb.historyOutbox, async () => {
      if (logoutStarted.current) return;
      await localDb.historySnapshots.put(snapshot);
      await localDb.historyOutbox.put(outbox);
    });
    if (logoutStarted.current) return null;
    historyLastSignature.current.set(document.objectId, signature);
    historyLastCapturedAt.current.set(document.objectId, new Date(capturedAt).getTime());
    setHistorySettings((current) => {
      const next = {
        ...current,
        count: current.count + 1,
        usedBytes: current.usedBytes + snapshot.byteSize
      };
      historySettingsRef.current = next;
      return next;
    });
    if (activeIdRef.current === document.objectId) {
      setHistoryItems((current) => mergeHistoryItems([localHistoryListItem(snapshot)], current));
    }
    requestPush("editor");
    return snapshot;
  };

  const loadHistory = async (noteId: string, cursor: string | null = null, append = false) => {
    setHistoryLoading(true);
    try {
      const local = await localHistoryForNote(noteId);
      const localItems = local.map(localHistoryListItem);
      if (!navigator.onLine) {
        setHistoryItems((current) => append ? mergeHistoryItems(current, localItems) : localItems);
        setHistoryCursor(null);
        setHistoryHasMore(false);
        return;
      }
      const query = new URLSearchParams({ limit: "50" });
      if (cursor) query.set("cursor", cursor);
      const response = await api<{
        items: HistoryListItem[];
        nextCursor: string | null;
        clearedBefore: string | null;
      }>(`/api/notes/${noteId}/history?${query}`);
      if (response.clearedBefore) {
        const stale = local.filter((item) => item.capturedAt <= response.clearedBefore!);
        if (stale.length) {
          await localDb.transaction("rw", localDb.historySnapshots, localDb.historyOutbox, async () => {
            await localDb.historySnapshots.bulkDelete(stale.map((item) => item.key));
            await localDb.historyOutbox.bulkDelete(stale.map((item) => item.key));
          });
        }
      }
      const pending = localItems.filter((item) => item.pending && (!response.clearedBefore || item.capturedAt > response.clearedBefore));
      setHistoryItems((current) => append
        ? mergeHistoryItems(current, response.items, pending)
        : mergeHistoryItems(response.items, pending));
      setHistoryCursor(response.nextCursor);
      setHistoryHasMore(Boolean(response.nextCursor));
      const newest = mergeHistoryItems(response.items, pending)[0];
      if (newest) historyLastCapturedAt.current.set(noteId, new Date(newest.capturedAt).getTime());
    } catch (error) {
      const local = await localHistoryForNote(noteId);
      setHistoryItems((current) => append ? mergeHistoryItems(current, local.map(localHistoryListItem)) : local.map(localHistoryListItem));
      setHistoryCursor(null);
      setHistoryHasMore(false);
      if (!(error instanceof ApiError && error.status === 404)) {
        showMessage(translateError(error, t, "notice.historyLoadFailed"));
      }
    } finally {
      setHistoryLoading(false);
    }
  };

  const selectHistorySnapshot = async (item: HistoryListItem) => {
    try {
      const key = historyKey(user.id, item.noteId, item.historyId);
      let snapshot = await localDb.historySnapshots.get(key);
      if (!snapshot) {
        const remote = await api<EncryptedHistorySnapshot>(`/api/notes/${item.noteId}/history/${item.historyId}`);
        snapshot = { ...remote, key, userId: user.id };
        await localDb.historySnapshots.put(snapshot);
      }
      const payload = await cryptoClient.decryptHistory(
        user.id,
        snapshot.noteId,
        snapshot.historyId,
        snapshot.capturedAt,
        snapshot.captureKind,
        snapshot.ciphertext,
        snapshot.nonce
      );
      if (payload.schemaVersion !== 1) throw new Error(t("history.unsupported"));
      setHistoryPreview({ item, payload });
      setOutlineOpen(false);
    } catch (error) {
      showMessage(translateError(error, t, "notice.historyDecryptFailed"), "critical");
    }
  };

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const updateAvatarUrl = (avatar: { mime: string; data: ArrayBuffer } | null) => {
    if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current);
    const next = avatar ? URL.createObjectURL(new Blob([avatar.data], { type: avatar.mime })) : null;
    avatarUrlRef.current = next;
    setAvatarUrl(next);
  };

  useEffect(() => {
    let cancelled = false;
    void api<{ avatar: (EncryptedProfileAvatar & { updatedAt: string }) | null }>("/api/account/avatar")
      .then(async ({ avatar }) => avatar ? cryptoClient.decryptProfileAvatar(user.id, avatar) : null)
      .then((avatar) => { if (!cancelled) updateAvatarUrl(avatar); })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current);
      avatarUrlRef.current = null;
    };
  }, [user.id]);

  const replaceDocuments = (next: OpenDocument[] | ((current: OpenDocument[]) => OpenDocument[])) => {
    const value = typeof next === "function" ? next(documentsRef.current) : next;
    documentsRef.current = value;
    documentIndexRef.current = new Map(value.map((entry) => [entry.objectId, entry]));
    setDocuments(value);
  };
  const replaceAttachments = (next: OpenAttachment[] | ((current: OpenAttachment[]) => OpenAttachment[])) => {
    const value = typeof next === "function" ? next(attachmentsRef.current) : next;
    attachmentsRef.current = value;
    attachmentIndexRef.current = new Map(value.map((entry) => [entry.objectId, entry]));
    setAttachments(value);
  };
  const replaceWorkspaceRecord = (record: OpenDocument | null, applyState = true) => {
    workspaceRecordRef.current = record;
    setWorkspaceRecord(record);
    if (!record || !applyState) return;
    const state = parseWorkspaceState(record);
    if (!state) return;
    setPreferences((current) => ({
      ...current,
      treeCollapsed: state.treeCollapsed,
      outlineCollapsed: state.outlineCollapsed
    }));
    setMode(state.editorMode);
    const active = state.activeNoteId
      ? documentsRef.current.find((entry) => entry.objectId === state.activeNoteId && entry.kind === "note" && !entry.deleted)
      : null;
    if (active) {
      activeIdRef.current = active.objectId;
      setActiveId(active.objectId);
      setSelectedIds(new Set([active.objectId]));
      selectionAnchor.current = active.objectId;
    }
  };
  const upsertDocument = (document: OpenDocument) => replaceDocuments((current) => (
    documentIndexRef.current.has(document.objectId)
      ? current.map((entry) => entry.objectId === document.objectId ? document : entry)
      : [...current, document]
  ));
  const upsertAttachment = (attachment: OpenAttachment) => replaceAttachments((current) => (
    attachmentIndexRef.current.has(attachment.objectId)
      ? current.map((entry) => entry.objectId === attachment.objectId ? attachment : entry)
      : [...current, attachment]
  ));
  const applyDeferredActiveRemote = (objectId: string) => {
    if (deferredActiveRemoteId.current !== objectId) return;
    const remote = deferredActiveRemote.current;
    if (remote) replaceDocuments(mergeByObjectId(documentsRef.current, [remote]));
    else replaceDocuments((current) => current.filter((entry) => entry.objectId !== objectId));
    deferredActiveRemoteId.current = null;
    deferredActiveRemote.current = null;
  };

  const persistObject = async <T extends OpenDocument | OpenAttachment>(
    object: T,
    options: { commitState?: boolean } = {}
  ): Promise<T> => {
    if (logoutStarted.current) return object;
    setSaveState("saving");
    const key = localKey(user.id, object.objectId);
    const pending = await localDb.outbox.get(key);
    if (logoutStarted.current) return object;
    const baseRevision = pending?.baseRevision ?? object.serverRevision;
    const intendedRevision = baseRevision + 1;
    const next = {
      ...object,
      updatedAt: new Date().toISOString(),
      serverRevision: baseRevision,
      dirty: true
    } as T;
    const encrypted = await cryptoClient.encryptObject(user.id, object.objectId, object.kind, intendedRevision, plainObject(next));
    if (logoutStarted.current) return object;
    const nextGeneration = Date.now() * 1000 + ++generation.current;
    const localObject: LocalEncryptedObject = {
      key,
      userId: user.id,
      objectId: object.objectId,
      objectType: object.kind,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      encryptionVersion: encrypted.encryptionVersion,
      revision: intendedRevision,
      deleted: next.deleted,
      updatedAt: next.updatedAt
    };
    const outbox: OutboxEntry = {
      ...localObject,
      operation: "upsert",
      baseRevision,
      idempotencyKey: crypto.randomUUID(),
      generation: nextGeneration
    };
    await localDb.transaction("rw", localDb.objects, localDb.outbox, async () => {
      if (logoutStarted.current) return;
      await localDb.objects.put(localObject);
      await localDb.outbox.put(outbox);
    });
    if (logoutStarted.current) return object;
    if (options.commitState !== false) {
      if (next.objectId === WORKSPACE_OBJECT_ID) replaceWorkspaceRecord(next as OpenDocument, false);
      else if (next.kind === "attachment") upsertAttachment(next as OpenAttachment);
      else upsertDocument(next as OpenDocument);
    }
    setSaveState(navigator.onLine ? "local" : "offline");
    return next;
  };

  const flushDocument = async (objectId: string) => {
    const timer = saveTimers.current.get(objectId);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    saveTimers.current.delete(objectId);
    saveDeadlines.current.delete(objectId);
    if (logoutStarted.current) return;
    const current = objectId === WORKSPACE_OBJECT_ID
      ? workspaceRecordRef.current
      : documentIndexRef.current.get(objectId);
    if (current) await persistObject(current);
  };

  const queueDocument = (document: OpenDocument, delay = 500, maxWait = 5_000) => {
    if (logoutStarted.current) return;
    upsertDocument(document);
    const existing = saveTimers.current.get(document.objectId);
    if (existing !== undefined) window.clearTimeout(existing);
    const now = Date.now();
    const deadline = saveDeadlines.current.get(document.objectId) ?? now + maxWait;
    saveDeadlines.current.set(document.objectId, deadline);
    const wait = Math.max(0, Math.min(delay, deadline - now));
    saveTimers.current.set(document.objectId, window.setTimeout(() => {
      saveTimers.current.delete(document.objectId);
      saveDeadlines.current.delete(document.objectId);
      if (logoutStarted.current) return;
      const current = documentIndexRef.current.get(document.objectId);
      if (current) void persistObject(current).then(() => requestPush("editor"));
    }, wait));
  };

  const queueWorkspace = (state: WorkspaceState, delay = 1_500, maxWait = 10_000) => {
    if (logoutStarted.current) return;
    const document = makeWorkspaceDocument(state, workspaceRecordRef.current);
    replaceWorkspaceRecord(document, false);
    const existing = saveTimers.current.get(WORKSPACE_OBJECT_ID);
    if (existing !== undefined) window.clearTimeout(existing);
    const now = Date.now();
    const deadline = saveDeadlines.current.get(WORKSPACE_OBJECT_ID) ?? now + maxWait;
    saveDeadlines.current.set(WORKSPACE_OBJECT_ID, deadline);
    const wait = Math.max(0, Math.min(delay, deadline - now));
    saveTimers.current.set(WORKSPACE_OBJECT_ID, window.setTimeout(() => {
      saveTimers.current.delete(WORKSPACE_OBJECT_ID);
      saveDeadlines.current.delete(WORKSPACE_OBJECT_ID);
      if (logoutStarted.current) return;
      const current = workspaceRecordRef.current;
      if (current) void persistObject(current).then(() => requestPush("editor"));
    }, wait));
  };

  const clearHistorySessionTimers = () => {
    if (historyIdleTimer.current !== null) window.clearTimeout(historyIdleTimer.current);
    if (historyPeriodicTimer.current !== null) window.clearTimeout(historyPeriodicTimer.current);
    historyIdleTimer.current = null;
    historyPeriodicTimer.current = null;
  };

  const captureHistoryAfterLocalSave = async (noteId: string, captureKind: HistoryCaptureKind) => {
    await flushDocument(noteId);
    const current = documentIndexRef.current.get(noteId);
    if (current?.kind === "note" && !current.deleted) await saveHistorySnapshot(current, captureKind);
  };

  const finishHistorySession = async (capture = true) => {
    const session = historySession.current;
    clearHistorySessionTimers();
    if (!session?.active) return;
    historySession.current = { ...session, active: false };
    if (capture && historySettingsRef.current.enabled && !historyQuotaPaused.current) {
      await captureHistoryAfterLocalSave(session.noteId, "idle");
    }
  };

  const scheduleHistoryEdit = (before: OpenDocument, after: OpenDocument) => {
    if (
      !historySettingsRef.current.enabled
      || historyQuotaPaused.current
      || before.kind !== "note"
      || !historyContentChanged(before, after)
    ) return;
    const now = Date.now();
    const intervalMs = historySettingsRef.current.intervalMinutes * 60_000;
    if (!historySession.current?.active || historySession.current.noteId !== before.objectId) {
      clearHistorySessionTimers();
      historySession.current = { noteId: before.objectId, active: true };
      const lastCapturedAt = historyLastCapturedAt.current.get(before.objectId) ?? 0;
      if (shouldCaptureHistoryBaseline(lastCapturedAt || undefined, now, historySettingsRef.current.intervalMinutes)) {
        void saveHistorySnapshot(before, "baseline").catch((error) => {
          showMessage(translateError(error, t, "notice.historySaveFailed"));
        });
      }
    }
    if (historyIdleTimer.current !== null) window.clearTimeout(historyIdleTimer.current);
    historyIdleTimer.current = window.setTimeout(() => {
      historyIdleTimer.current = null;
      void finishHistorySession(true).catch((error) => showMessage(translateError(error, t, "notice.historySaveFailed")));
    }, 2 * 60_000);

    const armPeriodic = () => {
      historyPeriodicTimer.current = window.setTimeout(() => {
        historyPeriodicTimer.current = null;
        const session = historySession.current;
        if (!session?.active || historyQuotaPaused.current) return;
        void captureHistoryAfterLocalSave(session.noteId, "interval")
          .catch((error) => showMessage(translateError(error, t, "notice.historySaveFailed")))
          .finally(() => {
            if (historySession.current?.active && !historyQuotaPaused.current) armPeriodic();
          });
      }, intervalMs);
    };
    if (historyPeriodicTimer.current === null) armPeriodic();
  };

  const patchDocument = (objectId: string, patch: Partial<OpenDocument>, delay = 500) => {
    const current = documentIndexRef.current.get(objectId);
    if (!current || !documentPatchChanges(current, patch)) return;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString(), dirty: true };
    scheduleHistoryEdit(current, next);
    queueDocument(next, delay);
  };

  const beginTreeRename = (objectId: string) => {
    const target = documentIndexRef.current.get(objectId);
    if (!target || target.deleted) return;
    const ancestors = new Set<string>();
    let ancestorId = target.parentId;
    while (ancestorId) {
      ancestors.add(ancestorId);
      ancestorId = documentIndexRef.current.get(ancestorId)?.parentId ?? null;
    }
    setSearch("");
    setExpanded((current) => new Set([...current, ...ancestors]));
    setSelectedIds(new Set([objectId]));
    selectionAnchor.current = objectId;
    setRenamingDocumentId(objectId);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      documentTree.current
        ?.querySelector<HTMLElement>(`[data-object-id="${objectId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }));
  };

  const createDocument = async (kind: "note" | "folder", title: string, parentId: string | null, markdown = "", options: CreateDocumentOptions = {}) => {
    const defaultTitle = kind === "note" ? t("app.untitled") : t("app.newFolder");
    const documentTitle = uniqueSiblingTitle(documentsRef.current, title.trim() || defaultTitle, parentId);
    const document = makeDocument(documentsRef.current, kind, documentTitle, parentId, markdown);
    if (options.focusName) setSearch("");
    upsertDocument(document);
    setSelectedIds(new Set([document.objectId]));
    selectionAnchor.current = document.objectId;
    if (kind === "folder") {
      const foldersToExpand = new Set([document.objectId]);
      let ancestorId = parentId;
      while (ancestorId) {
        foldersToExpand.add(ancestorId);
        ancestorId = documentIndexRef.current.get(ancestorId)?.parentId ?? null;
      }
      setExpanded((current) => new Set([...current, ...foldersToExpand]));
    }
    await persistObject(document);
    if (kind === "folder" && options.focusName) {
      beginTreeRename(document.objectId);
    }
    if (kind === "note") {
      const previousActiveId = activeIdRef.current;
      if (previousActiveId && previousActiveId !== document.objectId) applyDeferredActiveRemote(previousActiveId);
      if (options.focusName) pendingTitleFocus.current = document.objectId;
      setMode("live");
      activeIdRef.current = document.objectId;
      setActiveId(document.objectId);
      setEditorSessionId((current) => current + 1);
      if (options.focusName) setTreeOpen(false);
    }
    requestPush("structural");
    return document.objectId;
  };

  const createNewDocument = (kind: "note" | "folder", parentId: string | null) => createDocument(
    kind,
    kind === "note" ? t("app.untitled") : t("app.newFolder"),
    parentId,
    "",
    { focusName: true }
  );

  const preserveConflict = async (
    entry: OutboxEntry,
    commitState = true,
    rebindActive = true
  ): Promise<OpenDocument | null> => {
    if (entry.objectId === WORKSPACE_OBJECT_ID) return null;
    const local = await cryptoClient.decryptObject(user.id, entry.objectId, entry.objectType, entry.revision, entry.ciphertext, entry.nonce);
    if (local.kind === "attachment") {
      showMessage(t("notice.attachmentConflict"), "critical");
      return null;
    }
    const conflict = makeDocument(documentsRef.current, local.kind, `${local.title} (${t("app.conflictSuffix")})`, local.parentId, local.markdown);
    conflict.tags = local.tags;
    conflict.favorite = local.favorite;
    conflict.attachmentIds = local.attachmentIds;
    const persisted = await persistObject(conflict, { commitState });
    requestPush("structural");
    if (rebindActive && activeIdRef.current === entry.objectId) {
      activeIdRef.current = persisted.objectId;
      setActiveId(persisted.objectId);
      setSelectedIds(new Set([persisted.objectId]));
      selectionAnchor.current = persisted.objectId;
    }
    showMessage(t("notice.documentConflict", { title: local.title }), "critical");
    return persisted;
  };

  const removePurgedLocal = async (objectId: string, commitState = true) => {
    await localDb.transaction("rw", [
      localDb.objects,
      localDb.outbox,
      localDb.attachmentChunks,
      localDb.attachmentOutbox,
      localDb.historySnapshots,
      localDb.historyOutbox
    ], async () => {
      await localDb.objects.delete(localKey(user.id, objectId));
      await localDb.outbox.delete(localKey(user.id, objectId));
      await localDb.attachmentChunks.where("[userId+attachmentId]").equals([user.id, objectId]).delete();
      await localDb.attachmentOutbox.where("[userId+attachmentId]").equals([user.id, objectId]).delete();
      await localDb.historySnapshots.where("[userId+noteId]").equals([user.id, objectId]).delete();
      await localDb.historyOutbox.where("[userId+noteId]").equals([user.id, objectId]).delete();
    });
    if (!commitState) return;
    replaceDocuments((all) => all.filter((entry) => entry.objectId !== objectId));
    replaceAttachments((all) => all.filter((entry) => entry.objectId !== objectId));
    if (objectId === WORKSPACE_OBJECT_ID) replaceWorkspaceRecord(null, false);
    setSelectedIds((current) => {
      if (!current.has(objectId)) return current;
      const next = new Set(current);
      next.delete(objectId);
      return next;
    });
    if (selectionAnchor.current === objectId) selectionAnchor.current = null;
  };

  const pullChanges = async ({ applyWorkspace = false }: { applyWorkspace?: boolean } = {}) => {
    if (logoutStarted.current) return new Set<string>();
    let cursor = Number((await localDb.meta.get(cursorKey(user.id)))?.value ?? 0);
    let hasMore = true;
    const failedObjectIds = new Set<string>();
    const pendingByKey = new Map(
      (await localDb.outbox.where("userId").equals(user.id).toArray()).map((entry) => [entry.key, entry])
    );
    const documentUpserts = new Map<string, OpenDocument>();
    const attachmentUpserts = new Map<string, OpenAttachment>();
    const removedDocumentIds = new Set<string>();
    const removedAttachmentIds = new Set<string>();
    let remoteWorkspace: OpenDocument | null = null;
    let workspaceRebaseRevision: number | null = null;
    let workspaceToRebase: OpenDocument | null = null;
    let activeConflictId: string | null = null;
    let deferredActiveChanged = false;
    let deferredActiveDeleted = false;

    while (hasMore) {
      if (logoutStarted.current) return failedObjectIds;
      const result = await api<{ changes: SyncChange[]; cursor: number; hasMore: boolean }>(`/api/sync?since=${cursor}&limit=500&compact=1`);
      if (logoutStarted.current) return failedObjectIds;
      const localPuts: LocalEncryptedObject[] = [];
      const purgedIds: string[] = [];
      const outboxDeletes: string[] = [];

      for (const change of result.changes) {
        if (change.purged) {
          purgedIds.push(change.objectId);
          pendingByKey.delete(localKey(user.id, change.objectId));
          if (change.objectId === activeIdRef.current) {
            deferredActiveRemoteId.current = change.objectId;
            deferredActiveRemote.current = null;
            deferredActiveChanged = true;
            deferredActiveDeleted = true;
          } else {
            removedDocumentIds.add(change.objectId);
            removedAttachmentIds.add(change.objectId);
          }
          if (change.objectId === WORKSPACE_OBJECT_ID) remoteWorkspace = null;
          failedObjectIds.delete(change.objectId);
          continue;
        }
        const key = localKey(user.id, change.objectId);
        const pending = pendingByKey.get(key);
        // Never let a remote pull replace plaintext that is still waiting for
        // the local encryption debounce. The subsequent conditional push will
        // preserve it or create a conflict copy if the server also changed.
        if (saveTimers.current.has(change.objectId)) continue;
        if (pending && change.revision > pending.baseRevision) {
          if (change.objectId === WORKSPACE_OBJECT_ID) {
            workspaceRebaseRevision = change.revision;
            workspaceToRebase = workspaceRecordRef.current;
          } else if (pending.operation === "upsert") {
            const wasActive = activeIdRef.current === change.objectId;
            const conflict = await preserveConflict(pending, false, false);
            if (conflict) {
              documentUpserts.set(conflict.objectId, conflict);
              if (wasActive) {
                activeConflictId = conflict.objectId;
                deferredActiveRemoteId.current = null;
                deferredActiveRemote.current = null;
              }
            }
          }
          outboxDeletes.push(key);
          pendingByKey.delete(key);
        } else if (pending) {
          continue;
        }
        let decrypted: VaultObject;
        try {
          decrypted = await cryptoClient.decryptObject(user.id, change.objectId, change.objectType, change.revision, change.ciphertext, change.nonce);
        } catch {
          // Keep the last known-good local ciphertext and decrypted document.
          // A later revision in the same pull may still repair this object.
          failedObjectIds.add(change.objectId);
          continue;
        }
        const localObject: LocalEncryptedObject = {
          key,
          userId: user.id,
          objectId: change.objectId,
          objectType: change.objectType,
          ciphertext: change.ciphertext,
          nonce: change.nonce,
          encryptionVersion: change.encryptionVersion,
          revision: change.revision,
          deleted: change.deleted,
          updatedAt: change.serverUpdatedAt
        };
        localPuts.push(localObject);
        const open = { ...decrypted, objectId: change.objectId, serverRevision: change.revision, dirty: false };
        if (change.objectId === WORKSPACE_OBJECT_ID && decrypted.kind === "note") {
          remoteWorkspace = open as OpenDocument;
          if (workspaceToRebase) workspaceRebaseRevision = change.revision;
        } else if (decrypted.kind === "attachment") {
          attachmentUpserts.set(change.objectId, open as OpenAttachment);
          removedAttachmentIds.delete(change.objectId);
        } else if (change.objectId === activeIdRef.current && activeConflictId === null) {
          deferredActiveRemoteId.current = change.objectId;
          deferredActiveRemote.current = open as OpenDocument;
          deferredActiveChanged = true;
          deferredActiveDeleted = (open as OpenDocument).deleted;
        } else {
          documentUpserts.set(change.objectId, open as OpenDocument);
          removedDocumentIds.delete(change.objectId);
        }
        failedObjectIds.delete(change.objectId);
      }

      cursor = result.cursor;
      hasMore = result.hasMore;
      if (logoutStarted.current) return failedObjectIds;
      await localDb.transaction(
        "rw",
        localDb.objects,
        localDb.outbox,
        localDb.attachmentChunks,
        localDb.attachmentOutbox,
        localDb.meta,
        async () => {
          if (logoutStarted.current) return;
          if (localPuts.length) await localDb.objects.bulkPut(localPuts);
          if (outboxDeletes.length) await localDb.outbox.bulkDelete(outboxDeletes);
          for (const objectId of purgedIds) {
            const key = localKey(user.id, objectId);
            await localDb.objects.delete(key);
            await localDb.outbox.delete(key);
            await localDb.attachmentChunks.where("[userId+attachmentId]").equals([user.id, objectId]).delete();
            await localDb.attachmentOutbox.where("[userId+attachmentId]").equals([user.id, objectId]).delete();
          }
          await localDb.meta.put({ key: cursorKey(user.id), value: String(cursor) });
        }
      );
      if (logoutStarted.current) return failedObjectIds;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }

    if (logoutStarted.current) return failedObjectIds;
    if (documentUpserts.size || removedDocumentIds.size) {
      replaceDocuments(mergeByObjectId(documentsRef.current, documentUpserts.values(), removedDocumentIds));
    }
    if (attachmentUpserts.size || removedAttachmentIds.size) {
      replaceAttachments(mergeByObjectId(attachmentsRef.current, attachmentUpserts.values(), removedAttachmentIds));
    }
    if (activeConflictId) {
      activeIdRef.current = activeConflictId;
      setActiveId(activeConflictId);
      setSelectedIds(new Set([activeConflictId]));
      selectionAnchor.current = activeConflictId;
    }
    if (remoteWorkspace) replaceWorkspaceRecord(remoteWorkspace, applyWorkspace && !workspaceToRebase);
    else if (removedDocumentIds.has(WORKSPACE_OBJECT_ID)) replaceWorkspaceRecord(null, false);

    if (workspaceRebaseRevision !== null && workspaceToRebase) {
      await persistObject({
        ...workspaceToRebase,
        serverRevision: workspaceRebaseRevision,
        dirty: true
      });
      requestPush("structural");
    }
    if (removedDocumentIds.size || removedAttachmentIds.size) {
      setSelectedIds((current) => new Set([...current].filter((id) => !removedDocumentIds.has(id) && !removedAttachmentIds.has(id))));
      if (selectionAnchor.current && (removedDocumentIds.has(selectionAnchor.current) || removedAttachmentIds.has(selectionAnchor.current))) {
        selectionAnchor.current = null;
      }
    }
    if (deferredActiveChanged) {
      showMessage(
        deferredActiveDeleted
          ? t("notice.activeRemoteDeleted")
          : t("notice.activeRemoteUpdated"),
        "info"
      );
    }
    return failedObjectIds;
  };

  const outboxPayload = (entry: OutboxEntry) => ({
    objectId: entry.objectId,
    objectType: entry.objectType,
    ciphertext: entry.ciphertext,
    nonce: entry.nonce,
    encryptionVersion: entry.encryptionVersion,
    baseRevision: entry.baseRevision,
    idempotencyKey: entry.idempotencyKey,
    deleted: entry.deleted
  });

  type BatchWriteResult =
    | { objectId: string; status: "accepted"; revision: number; sequence: number }
    | { objectId: string; status: "idempotent"; revision: number }
    | { objectId: string; status: "conflict"; currentRevision: number; reason: "revision" | "objectType" };

  const pushHistoryPending = async (): Promise<boolean> => {
    const entries = await localDb.historyOutbox.where("userId").equals(user.id).sortBy("generation");
    let pushed = false;
    for (const entry of entries) {
      if (logoutStarted.current) return pushed;
      try {
        await api(`/api/notes/${entry.noteId}/history/${entry.historyId}`, {
          method: "POST",
          body: JSON.stringify({
            capturedAt: entry.capturedAt,
            captureKind: entry.captureKind,
            ciphertext: entry.ciphertext,
            nonce: entry.nonce,
            encryptionVersion: entry.encryptionVersion,
            idempotencyKey: entry.idempotencyKey
          })
        });
        const current = await localDb.historyOutbox.get(entry.key);
        if (!current || current.generation === entry.generation) {
          await localDb.historyOutbox.delete(entry.key);
          await localDb.historySnapshots.update(entry.key, { pending: false });
          setHistoryItems((items) => items.map((item) => (
            item.historyId === entry.historyId ? { ...item, pending: false } : item
          )));
        }
        pushed = true;
        historyQuotaPaused.current = false;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          await localDb.transaction("rw", localDb.historySnapshots, localDb.historyOutbox, async () => {
            await localDb.historySnapshots.delete(entry.key);
            await localDb.historyOutbox.delete(entry.key);
          });
          setHistoryItems((items) => items.filter((item) => item.historyId !== entry.historyId));
          continue;
        }
        if (error instanceof ApiError && error.status === 413) {
          if (!historyQuotaPaused.current) showMessage(t("notice.historyQuotaReached"), "warning");
          historyQuotaPaused.current = true;
          break;
        }
        if (error instanceof ApiError && error.status === 404) break;
        throw error;
      }
    }
    return pushed;
  };

  const pushPending = async (): Promise<boolean> => {
    if (logoutStarted.current) return false;
    const chunkEntries = await localDb.attachmentOutbox.where("userId").equals(user.id).sortBy("generation");
    for (const entry of chunkEntries) {
      if (logoutStarted.current) return false;
      await uploadAttachmentChunk(`/api/attachments/${entry.attachmentId}/chunks/${entry.chunkIndex}`, entry.ciphertext, {
        "X-WebMD-Nonce": entry.nonce,
        "X-WebMD-Total-Chunks": String(entry.totalChunks),
        "X-WebMD-Encryption-Version": String(entry.encryptionVersion),
        "X-WebMD-Idempotency-Key": entry.idempotencyKey,
        "X-WebMD-Sync-Client": syncClientId.current
      });
      if (logoutStarted.current) return false;
      const current = await localDb.attachmentOutbox.get(entry.key);
      if (current?.generation === entry.generation) await localDb.attachmentOutbox.delete(entry.key);
    }

    const storedEntries = await localDb.outbox.where("userId").equals(user.id).sortBy("generation");
    if (logoutStarted.current) return false;
    const purgeEntries = storedEntries.filter((entry) => entry.operation === "purge");
    if (purgeEntries.length) await localDb.outbox.bulkDelete(purgeEntries.map((entry) => entry.key));
    const entries = storedEntries.filter((entry) => entry.operation === "upsert");
    if (!entries.length) return (await pushHistoryPending()) || chunkEntries.length > 0;

    const packed = packBySerializedSize(
      entries,
      (batch) => JSON.stringify({ objects: batch.map(outboxPayload) })
    );
    const documentAcks = new Map<string, number>();
    const attachmentAcks = new Map<string, number>();
    let workspaceAck: number | null = null;
    let conflictDetected = false;

    const acceptResult = async (entry: OutboxEntry, result: BatchWriteResult) => {
      if (logoutStarted.current) return;
      if (result.status === "conflict") {
        conflictDetected = true;
        return;
      }
      const current = await localDb.outbox.get(entry.key);
      if (!current || current.generation === entry.generation) {
        await localDb.outbox.delete(entry.key);
        if (entry.objectId === WORKSPACE_OBJECT_ID) workspaceAck = result.revision;
        else if (entry.objectType === "attachment") attachmentAcks.set(entry.objectId, result.revision);
        else documentAcks.set(entry.objectId, result.revision);
        return;
      }
      const newest = await cryptoClient.decryptObject(
        user.id,
        current.objectId,
        current.objectType,
        current.revision,
        current.ciphertext,
        current.nonce
      );
      await localDb.outbox.delete(entry.key);
      await persistObject({
        ...newest,
        objectId: current.objectId,
        serverRevision: result.revision,
        dirty: true
      });
      requestPush("editor");
    };

    for (const batch of packed.batches) {
      if (logoutStarted.current) return false;
      const response = await api<{ results: BatchWriteResult[] }>("/api/objects/batch", {
        method: "POST",
        headers: { "X-WebMD-Sync-Client": syncClientId.current },
        body: JSON.stringify({ objects: batch.map(outboxPayload) })
      });
      if (logoutStarted.current) return false;
      for (let index = 0; index < batch.length; index += 1) {
        await acceptResult(batch[index], response.results[index]);
      }
    }
    for (const entry of packed.oversized) {
      if (logoutStarted.current) return false;
      try {
        const result = await api<{ revision: number }>(`/api/objects/${entry.objectId}`, {
          method: "PUT",
          headers: { "X-WebMD-Sync-Client": syncClientId.current },
          body: JSON.stringify(outboxPayload(entry))
        });
        if (logoutStarted.current) return false;
        await acceptResult(entry, { objectId: entry.objectId, status: "accepted", revision: result.revision, sequence: 0 });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) conflictDetected = true;
        else throw error;
      }
    }

    if (logoutStarted.current) return false;
    if (documentAcks.size) replaceDocuments(acknowledgeByObjectId(documentsRef.current, documentAcks));
    if (attachmentAcks.size) replaceAttachments(acknowledgeByObjectId(attachmentsRef.current, attachmentAcks));
    if (workspaceAck !== null && workspaceRecordRef.current) {
      replaceWorkspaceRecord({ ...workspaceRecordRef.current, serverRevision: workspaceAck, dirty: false }, false);
    }
    if (conflictDetected) {
      await localDb.meta.put({ key: cursorKey(user.id), value: "0" });
      requestPull(0);
    }
    await pushHistoryPending();
    return true;
  };

  const executeSync = async (intent: SyncIntent) => {
    if (logoutStarted.current) return;
    if (!navigator.onLine) {
      setSaveState("offline");
      return;
    }
    const queued = await localDb.outbox.where("userId").equals(user.id).count()
      + await localDb.attachmentOutbox.where("userId").equals(user.id).count()
      + await localDb.historyOutbox.where("userId").equals(user.id).count();
    if (logoutStarted.current) return;
    if (!intent.pull && (!intent.push || queued === 0)) return;

    if (syncStatusTimer.current !== null) window.clearTimeout(syncStatusTimer.current);
    syncStatusTimer.current = window.setTimeout(() => setSaveState("syncing"), 200);
    try {
      if (intent.pull) {
        const currentActiveId = activeIdRef.current;
        if (currentActiveId && saveTimers.current.has(currentActiveId)) await flushDocument(currentActiveId);
        const failedPulls = await pullChanges();
        if (failedPulls.size) {
          showMessage(t("notice.remoteIntegrity", { count: failedPulls.size }), "critical");
        }
      }
      if (intent.push) await pushPending();
      if (logoutStarted.current) return;
      const remaining = await localDb.outbox.where("userId").equals(user.id).count()
        + await localDb.attachmentOutbox.where("userId").equals(user.id).count()
        + await localDb.historyOutbox.where("userId").equals(user.id).count();
      setSaveState(remaining ? "local" : "synced");
    } catch (error) {
      if (logoutStarted.current) return;
      setSaveState(navigator.onLine ? "error" : "offline");
      showMessage(translateError(error, t, "notice.syncFailed"));
      requestFallbackPull();
    } finally {
      if (syncStatusTimer.current !== null) window.clearTimeout(syncStatusTimer.current);
      syncStatusTimer.current = null;
    }
  };

  executeSyncRef.current = executeSync;

  function requestPush(kind: "editor" | "structural" = "editor") {
    if (logoutStarted.current) return;
    syncCoordinator.current?.request(
      { push: true },
      kind === "structural"
        ? { delayMs: 250, maxWaitMs: 2_000 }
        : { delayMs: 2_000, maxWaitMs: 15_000 }
    );
  }

  function requestPull(delayMs = 250) {
    if (logoutStarted.current) return;
    syncCoordinator.current?.request({ pull: true }, { delayMs, maxWaitMs: Math.max(1_000, delayMs) });
  }

  function requestFallbackPull() {
    if (logoutStarted.current) return;
    if (fallbackTimer.current !== null || document.visibilityState !== "visible" || !navigator.onLine) return;
    const delay = fallbackDelay.current;
    fallbackTimer.current = window.setTimeout(() => {
      fallbackTimer.current = null;
      requestPull(0);
      fallbackDelay.current = Math.min(300_000, Math.max(60_000, delay * 2));
      if (eventSource.current?.readyState !== EventSource.OPEN) requestFallbackPull();
    }, delay);
  }

  const synchronize = async () => {
    if (logoutStarted.current) return;
    await syncCoordinator.current?.runNow({ pull: true, push: true });
  };

  useEffect(() => {
    const coordinator = new SyncCoordinator({
      execute: (intent) => executeSyncRef.current(intent),
      canRun: () => navigator.onLine && document.visibilityState === "visible"
    });
    syncCoordinator.current = coordinator;
    return () => {
      coordinator.dispose();
      if (syncCoordinator.current === coordinator) syncCoordinator.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [stored, pending, storedPreferences, ignoredFailuresRecord] = await Promise.all([
          localDb.objects.where("userId").equals(user.id).toArray(),
          localDb.outbox.where("userId").equals(user.id).toArray(),
          localDb.meta.get(preferencesKey(user.id)),
          localDb.meta.get(ignoredDecryptFailuresKey(user.id))
        ]);
        if (cancelled || logoutStarted.current) return;
        if (storedPreferences) {
          const storedUiPreferences = JSON.parse(storedPreferences.value) as Partial<UiPreferences>;
          setPreferences({
            ...DEFAULT_PREFERENCES,
            ...storedUiPreferences,
            language: isLanguagePreference(storedUiPreferences.language) ? storedUiPreferences.language : languagePreference
          });
        }
        setPreferencesLoaded(true);
        const pendingByKey = new Map(pending.map((entry) => [entry.key, entry]));
        const decryptableStored: LocalEncryptedObject[] = [];
        for (const object of stored) {
          const queued = pendingByKey.get(object.key);
          if (queued?.operation === "purge") {
            await localDb.outbox.delete(queued.key);
            pendingByKey.delete(object.key);
          }
          decryptableStored.push(object);
        }
        const opened = await decryptAvailableLocalObjects(decryptableStored, pendingByKey, (object) => (
          cryptoClient.decryptObject(user.id, object.objectId, object.objectType, object.revision, object.ciphertext, object.nonce)
        ));
        const failedLocalObjects = opened.failed;
        if (cancelled || logoutStarted.current) return;
        // Commit every successfully decrypted record before any network work.
        // One damaged/stale ciphertext must never make the entire vault look
        // empty, and the original encrypted record remains untouched in Dexie.
        const localWorkspace = opened.documents.find((entry) => entry.objectId === WORKSPACE_OBJECT_ID) ?? null;
        replaceDocuments(opened.documents.filter((entry) => entry.objectId !== WORKSPACE_OBJECT_ID));
        replaceAttachments(opened.attachments);
        if (localWorkspace) replaceWorkspaceRecord(localWorkspace);

        let ignoredFailureFingerprints = new Set<string>();
        try {
          const parsed = JSON.parse(ignoredFailuresRecord?.value ?? "[]");
          if (Array.isArray(parsed)) ignoredFailureFingerprints = new Set(parsed.filter((value): value is string => typeof value === "string"));
        } catch {
          // A malformed local preference must not block vault loading.
        }
        const repairableFailures = failedLocalObjects.filter((object) => !ignoredFailureFingerprints.has(decryptFailureFingerprint(object)));
        const canRepairFromServer = repairableFailures.length > 0
          && repairableFailures.every((object) => !pendingByKey.has(object.key));
        const mustVerifyServerFromStart = canRepairFromServer || (stored.length === 0 && pending.length === 0);
        if (mustVerifyServerFromStart && !logoutStarted.current) await localDb.meta.put({ key: cursorKey(user.id), value: "0" });
        let initialPullError: unknown;
        let failedRemoteIds = new Set<string>();
        try {
          failedRemoteIds = await pullChanges({ applyWorkspace: true });
        } catch (error) {
          initialPullError = error;
        }

        const loadedIds = new Set([
          ...documentsRef.current.map((entry) => entry.objectId),
          ...attachmentsRef.current.map((entry) => entry.objectId),
          ...(workspaceRecordRef.current ? [WORKSPACE_OBJECT_ID] : [])
        ]);
        const unresolved = failedLocalObjects.filter((object) => !loadedIds.has(object.objectId));
        const visibleFailures = unresolved.filter((object) => !ignoredFailureFingerprints.has(decryptFailureFingerprint(object)));
        if (logoutStarted.current) return;
        if (unresolved.length) {
          const pendingFailures = visibleFailures.filter((object) => pendingByKey.has(object.key)).length;
          if (visibleFailures.length) showMessage(
            t("notice.localDecryptFailed", {
              count: visibleFailures.length,
              detail: pendingFailures
                ? t("notice.pendingDecryptFailed", { count: pendingFailures })
                : t("notice.ciphertextRetained")
            }),
            "critical",
            {
              label: t("notice.ignoreRevision"),
              run: async () => {
                const fingerprints = new Set(ignoredFailureFingerprints);
                for (const object of visibleFailures) fingerprints.add(decryptFailureFingerprint(object));
                await localDb.meta.put({ key: ignoredDecryptFailuresKey(user.id), value: JSON.stringify([...fingerprints]) });
                setMessage(null);
              }
            }
          );
        } else if (failedRemoteIds.size) {
          showMessage(t("notice.remoteIntegrityOthers", { count: failedRemoteIds.size }), "critical");
        } else if (initialPullError) {
          showMessage(navigator.onLine ? t("notice.localRestoredSyncRetry") : t("notice.loadedOffline"), "warning");
        }

        const storedContent = stored.filter((entry) => entry.objectId !== WORKSPACE_OBJECT_ID);
        const pendingContent = pending.filter((entry) => entry.objectId !== WORKSPACE_OBJECT_ID);
        const verifiedEmptyVault = storedContent.length === 0 && pendingContent.length === 0 && !initialPullError && failedRemoteIds.size === 0;
        if (verifiedEmptyVault && !documentsRef.current.some((entry) => entry.kind === "note" && !entry.deleted)) {
          await createDocument("note", t("app.welcomeTitle"), null, t("app.welcomeMarkdown"));
        }
        const remembered = workspaceRecordRef.current ? parseWorkspaceState(workspaceRecordRef.current) : null;
        const restored = remembered?.activeNoteId
          ? documentsRef.current.find((entry) => entry.objectId === remembered.activeNoteId && entry.kind === "note" && !entry.deleted)
          : null;
        const initial = restored ?? documentsRef.current.find((entry) => entry.kind === "note" && !entry.deleted);
        if (initial) {
          activeIdRef.current = initial.objectId;
          setActiveId(initial.objectId);
          setSelectedIds(new Set([initial.objectId]));
          selectionAnchor.current = initial.objectId;
        }
        setWorkspaceLoaded(true);
        setLoading(false);
        requestPush("structural");
      } catch (error) {
        if (cancelled || logoutStarted.current) return;
        showMessage(translateError(error, t, "notice.openDatabaseFailed"), "critical");
        setSaveState("error");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user.id]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    const timer = window.setTimeout(() => {
      if (!logoutStarted.current) void localDb.meta.put({ key: preferencesKey(user.id), value: JSON.stringify(preferences) });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [preferences, preferencesLoaded, user.id]);

  useEffect(() => {
    if (preferencesLoaded) setLanguagePreference(preferences.language);
  }, [preferences.language, preferencesLoaded, setLanguagePreference]);

  useEffect(() => {
    if (!workspaceLoaded) return;
    const state: WorkspaceState = {
      version: 1,
      activeNoteId: activeId,
      openNoteIds: activeId ? [activeId] : [],
      editorMode: mode,
      treeCollapsed: preferences.treeCollapsed,
      outlineCollapsed: preferences.outlineCollapsed
    };
    if (!workspaceStateEquals(workspaceRecord ? parseWorkspaceState(workspaceRecord) : null, state)) queueWorkspace(state);
  }, [activeId, mode, preferences.treeCollapsed, preferences.outlineCollapsed, workspaceLoaded]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = preferences.theme === "system" ? (query.matches ? "dark" : "light") : preferences.theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [preferences.theme]);

  useEffect(() => {
    if (!workspaceLoaded) return;
    const closeEvents = () => {
      eventSource.current?.close();
      eventSource.current = null;
      if (safetyTimer.current !== null) window.clearInterval(safetyTimer.current);
      safetyTimer.current = null;
    };
    const clearFallback = () => {
      if (fallbackTimer.current !== null) window.clearTimeout(fallbackTimer.current);
      fallbackTimer.current = null;
    };
    const openEvents = async () => {
      if (logoutStarted.current || !navigator.onLine || document.visibilityState !== "visible" || eventSource.current) return;
      const cursor = Number((await localDb.meta.get(cursorKey(user.id)))?.value ?? 0);
      if (logoutStarted.current || !navigator.onLine || document.visibilityState !== "visible" || eventSource.current) return;
      const source = new EventSource(
        `/api/sync/events?since=${cursor}&clientId=${encodeURIComponent(syncClientId.current)}`,
        { withCredentials: true }
      );
      eventSource.current = source;
      source.onopen = () => {
        fallbackDelay.current = 60_000;
        clearFallback();
      };
      source.addEventListener("changed", () => requestPull(250));
      source.onerror = () => requestFallbackPull();
      safetyTimer.current = window.setInterval(() => requestPull(0), 5 * 60_000);
    };
    const online = () => {
      clearFallback();
      void syncCoordinator.current?.runNow({ pull: true, push: true }).finally(() => void openEvents());
    };
    const offline = () => {
      closeEvents();
      clearFallback();
      setSaveState("offline");
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        closeEvents();
        clearFallback();
        void finishHistorySession(true);
        for (const id of [...saveTimers.current.keys()]) void flushDocument(id);
      } else {
        void syncCoordinator.current?.runNow({ pull: true, push: true }).finally(() => void openEvents());
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visibility);
    void openEvents();
    return () => {
      closeEvents();
      clearFallback();
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [workspaceLoaded, user.id]);

  const indexedActiveDocument = activeId ? documentIndexRef.current.get(activeId) : null;
  const activeDocument = indexedActiveDocument?.kind === "note" ? indexedActiveDocument : null;
  useEffect(() => {
    setHistoryPreview(null);
    setHistoryItems([]);
    setHistoryCursor(null);
    setHistoryHasMore(false);
    historySession.current = null;
    clearHistorySessionTimers();
    if (activeDocument && preferences.rightPanelTab === "history") void loadHistory(activeDocument.objectId);
  }, [activeDocument?.objectId]);
  useEffect(() => {
    if (preferences.rightPanelTab === "history" && activeDocument) void loadHistory(activeDocument.objectId);
  }, [preferences.rightPanelTab]);
  useEffect(() => setTitleDraft(activeDocument?.title ?? ""), [activeDocument?.objectId, activeDocument?.title]);
  useEffect(() => {
    if (!activeDocument || pendingTitleFocus.current !== activeDocument.objectId) return;
    const frame = window.requestAnimationFrame(() => {
      if (focusAndSelectName(titleInput.current)) pendingTitleFocus.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeDocument?.objectId, editorSessionId]);
  const displayedMarkdown = historyPreview?.payload.markdown ?? activeDocument?.markdown ?? "";
  const outline = useMemo(() => buildOutline(displayedMarkdown), [displayedMarkdown]);
  const statistics = useMemo(() => countText(displayedMarkdown), [displayedMarkdown]);
  const activeAttachmentIds = useMemo(() => [...new Set([
    ...(historyPreview?.payload.attachmentIds ?? activeDocument?.attachmentIds ?? []),
    ...attachmentIdsIn(displayedMarkdown)
  ])], [activeDocument?.attachmentIds.join("|"), displayedMarkdown, historyPreview?.item.historyId]);
  const activeAttachmentSignature = useMemo(() => activeAttachmentIds.map((id) => {
    const attachment = attachmentIndexRef.current.get(id);
    return attachment ? attachmentDisplaySignature(attachment) : `${id}:missing`;
  }).join("|"), [activeAttachmentIds.join("|"), attachments]);

  useEffect(() => {
    let cancelled = false;
    const createdUrls: string[] = [];
    void (async () => {
      const previous = attachmentUrlCache.current;
      const nextCache = new Map<string, CachedAttachmentUrl>();
      const nextUrls = new Map<string, string>();
      for (const id of activeAttachmentIds) {
        const normalizedId = id.toLowerCase();
        const attachment = attachmentsRef.current.find((entry) => entry.objectId === id && !entry.deleted);
        if (!attachment) continue;
        const signature = attachmentDisplaySignature(attachment);
        const cached = previous.get(normalizedId);
        if (cached?.signature === signature) {
          nextCache.set(normalizedId, cached);
          nextUrls.set(normalizedId, cached.url);
          continue;
        }
        try {
          const url = URL.createObjectURL(await decryptAttachmentBlob(user.id, attachment, () => !logoutStarted.current));
          if (cancelled) { URL.revokeObjectURL(url); continue; }
          createdUrls.push(url);
          const entry = { signature, url };
          nextCache.set(normalizedId, entry);
          nextUrls.set(normalizedId, url);
        } catch (error) {
          if (!cancelled) showMessage(translateError(error, t, "notice.attachmentLoadFailed"));
        }
      }
      if (cancelled) return;
      for (const [id, cached] of previous) {
        if (nextCache.get(id)?.url !== cached.url) URL.revokeObjectURL(cached.url);
      }
      attachmentUrlCache.current = nextCache;
      setAttachmentUrls(nextUrls);
    })();
    return () => {
      cancelled = true;
      for (const url of createdUrls) {
        if (![...attachmentUrlCache.current.values()].some((entry) => entry.url === url)) URL.revokeObjectURL(url);
      }
    };
  }, [activeDocument?.objectId, activeAttachmentSignature]);

  useEffect(() => () => {
    for (const cached of attachmentUrlCache.current.values()) URL.revokeObjectURL(cached.url);
    attachmentUrlCache.current.clear();
  }, []);

  const visibleDocuments = useMemo(() => documents.filter((entry) => !entry.deleted), [documents]);
  const trashItems = useMemo(() => documents.filter((entry) => entry.deleted), [documents]);
  const searched = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return visibleDocuments;
    const included = new Set(visibleDocuments.filter((entry) => `${entry.title}\n${entry.markdown}`.toLowerCase().includes(normalized)).map((entry) => entry.objectId));
    for (const id of [...included]) {
      let parentId = documentIndexRef.current.get(id)?.parentId;
      while (parentId) {
        included.add(parentId);
        parentId = documentIndexRef.current.get(parentId)?.parentId;
      }
    }
    return visibleDocuments.filter((entry) => included.has(entry.objectId));
  }, [visibleDocuments, search, documents]);
  const treeChildren = useMemo(() => {
    const indexed = new Map<string | null, OpenDocument[]>();
    for (const entry of searched) {
      const siblings = indexed.get(entry.parentId) ?? [];
      siblings.push(entry);
      indexed.set(entry.parentId, siblings);
    }
    for (const siblings of indexed.values()) siblings.sort(compareDocuments(preferences.sortMode));
    return indexed;
  }, [searched, preferences.sortMode]);
  const visibleTree = useMemo(() => {
    const ordered: OpenDocument[] = [];
    const visit = (parentId: string | null) => {
      for (const entry of treeChildren.get(parentId) ?? []) {
        ordered.push(entry);
        if (entry.kind === "folder" && expanded.has(entry.objectId)) visit(entry.objectId);
      }
    };
    visit(null);
    return ordered;
  }, [treeChildren, expanded]);
  const pinned = useMemo(() => pinnedDocuments(searched, preferences.sortMode), [searched, preferences.sortMode]);

  const selectDocument = async (objectId: string) => {
    const currentActiveId = activeIdRef.current;
    if (currentActiveId && currentActiveId !== objectId) {
      await finishHistorySession(true);
      await flushDocument(currentActiveId);
      applyDeferredActiveRemote(currentActiveId);
      setEditorSessionId((current) => current + 1);
    }
    setHistoryPreview(null);
    activeIdRef.current = objectId;
    setActiveId(objectId);
    setTreeOpen(false);
  };

  const selectTreeEntry = (entry: OpenDocument, event: ReactMouseEvent<HTMLButtonElement>) => {
    const additive = event.ctrlKey || event.metaKey;
    if (event.shiftKey) {
      const anchorId = selectionAnchor.current;
      const anchorVisible = anchorId ? visibleTree.some((item) => item.objectId === anchorId) : false;
      const range = treeSelectionRange(visibleTree, anchorId, entry.objectId);
      setSelectedIds((current) => additive ? new Set([...current, ...range]) : new Set(range));
      if (!anchorVisible) selectionAnchor.current = entry.objectId;
      return;
    }
    selectionAnchor.current = entry.objectId;
    if (additive) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(entry.objectId)) next.delete(entry.objectId); else next.add(entry.objectId);
        return next;
      });
      return;
    }
    setSelectedIds(new Set([entry.objectId]));
    if (entry.kind === "folder") {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(entry.objectId)) next.delete(entry.objectId); else next.add(entry.objectId);
        return next;
      });
    } else {
      void selectDocument(entry.objectId);
    }
  };

  const openTreeContext = (entry: OpenDocument, x: number, y: number) => {
    if (!selectedIds.has(entry.objectId)) {
      setSelectedIds(new Set([entry.objectId]));
      selectionAnchor.current = entry.objectId;
    }
    setContextMenu({ objectId: entry.objectId, x, y });
  };

  const beginTreeDrag = (entry: OpenDocument): string[] => {
    if (selectedIds.has(entry.objectId)) return selectionRoots(documentsRef.current, selectedIds);
    setSelectedIds(new Set([entry.objectId]));
    selectionAnchor.current = entry.objectId;
    return [entry.objectId];
  };

  const setDeletedMany = async (objectIds: string[], deleted: boolean) => {
    const roots = selectionRoots(documentsRef.current, objectIds);
    const ids = new Set(roots.flatMap((objectId) => [...descendantsOf(documentsRef.current, objectId)]));
    if (!ids.size) return;
    if (!deleted) {
      const restoring = documentsRef.current.filter((entry) => ids.has(entry.objectId));
      const conflict = restoring.find((entry, index) => (
        documentsRef.current.some((sibling) => !sibling.deleted && !ids.has(sibling.objectId) && sibling.parentId === entry.parentId && sibling.title === entry.title)
        || restoring.some((sibling, siblingIndex) => siblingIndex < index && sibling.parentId === entry.parentId && sibling.title === entry.title)
      ));
      if (conflict) return showMessage(t("notice.restoreNameConflict", { title: conflict.title }));
    }
    const noteIds = new Set([...ids].filter((id) => documentsRef.current.find((entry) => entry.objectId === id)?.kind === "note"));
    const ownedAttachments = attachmentsRef.current.filter((entry) => noteIds.has(entry.ownerNoteId));
    for (const id of ids) {
      const document = documentsRef.current.find((entry) => entry.objectId === id);
      if (document) await persistObject({ ...document, deleted, dirty: true });
    }
    for (const attachment of ownedAttachments) await persistObject({ ...attachment, deleted, dirty: true });
    if (deleted && ids.has(activeIdRef.current ?? "")) {
      activeIdRef.current = null;
      setActiveId(null);
      setEditorSessionId((current) => current + 1);
    }
    setSelectedIds((current) => new Set([...current].filter((id) => !ids.has(id))));
    if (selectionAnchor.current && ids.has(selectionAnchor.current)) selectionAnchor.current = null;
    requestPush("structural");
  };

  const requestPurgeDocuments = (objectIds: string[]) => {
    const roots = selectionRoots(documentsRef.current, objectIds);
    const targets = roots.map((id) => documentsRef.current.find((entry) => entry.objectId === id && entry.deleted)).filter(Boolean) as OpenDocument[];
    if (!targets.length) return;
    const label = targets.length === 1
      ? t("notice.purgeSingleLabel", { title: targets[0].title })
      : t("notice.purgeMultipleLabel", { count: targets.length });
    if (window.confirm(t("notice.purgeConfirm", { label }))) {
      void purgeTrash(roots);
    }
  };

  const requestClearTrash = () => {
    if (!documentsRef.current.some((entry) => entry.deleted) && !attachmentsRef.current.some((entry) => entry.deleted)) return;
    if (window.confirm(t("notice.clearTrashConfirm"))) {
      void purgeTrash(null);
    }
  };

  const purgeTrash = async (objectIds: string[] | null) => {
    if (purging) return;
    if (!navigator.onLine) return showMessage(t("notice.purgeOnlineOnly"));
    setPurging(true);
    try {
      await synchronize();
      const documentIds = objectIds === null
        ? new Set(documentsRef.current.filter((entry) => entry.deleted).map((entry) => entry.objectId))
        : new Set(selectionRoots(documentsRef.current, objectIds).flatMap((objectId) => [...descendantsOf(documentsRef.current, objectId)]));
      const noteIds = new Set([...documentIds].filter((id) => documentsRef.current.find((entry) => entry.objectId === id)?.kind === "note"));
      const targets = [
        ...documentsRef.current.filter((entry) => documentIds.has(entry.objectId) && entry.deleted),
        ...attachmentsRef.current.filter((entry) => entry.deleted && (objectIds === null || noteIds.has(entry.ownerNoteId)))
      ];
      if (!targets.length) return;
      if (targets.some((entry) => entry.dirty || entry.serverRevision < 1)) {
        return showMessage(t("notice.purgeWaitSync"));
      }
      for (let index = 0; index < targets.length; index += 1000) {
        const batch = targets.slice(index, index + 1000);
        await api("/api/objects/purge", {
          method: "POST",
          headers: { "X-WebMD-Sync-Client": syncClientId.current },
          body: JSON.stringify({ objects: batch.map((entry) => ({ objectId: entry.objectId, baseRevision: entry.serverRevision })) })
        });
        for (const entry of batch) await removePurgedLocal(entry.objectId);
      }
      showMessage(t("notice.purgeComplete"), "info");
      requestPush("structural");
    } catch (error) {
      showMessage(translateError(error, t, "notice.purgeFailed"), "critical");
    } finally {
      setPurging(false);
    }
  };

  const moveDocument = async (objectId: string, parentId: string | null, beforeId: string | null = null) => {
    if (!canMoveDocument(documentsRef.current, objectId, parentId)) return showMessage(t("notice.moveIntoDescendant"));
    const moving = documentsRef.current.find((entry) => entry.objectId === objectId);
    if (!moving) return;
    if (moving.parentId !== parentId && siblingTitleExists(documentsRef.current, moving.title, parentId, objectId)) {
      return showMessage(t("notice.moveNameConflict", { title: moving.title }));
    }
    if (preferences.sortMode === "manual") {
      for (const change of reorderedSiblings(documentsRef.current, objectId, parentId, beforeId)) {
        const document = documentsRef.current.find((entry) => entry.objectId === change.objectId);
        if (document && (document.parentId !== change.parentId || document.manualOrder !== change.manualOrder)) await persistObject({ ...document, ...change, dirty: true });
      }
    } else {
      await persistObject({ ...moving, parentId, manualOrder: nextManualOrder(documentsRef.current, parentId), dirty: true });
    }
    if (parentId) setExpanded((current) => new Set(current).add(parentId));
    requestPush("structural");
  };

  const moveDocuments = async (objectIds: string[], parentId: string | null, beforeId: string | null = null) => {
    const roots = selectionRoots(documentsRef.current, objectIds);
    if (!roots.length) return;
    const moving = roots.map((id) => documentsRef.current.find((entry) => entry.objectId === id)).filter(Boolean) as OpenDocument[];
    const movingTreeIds = new Set(roots.flatMap((id) => [...descendantsOf(documentsRef.current, id)]));
    if (parentId && movingTreeIds.has(parentId)) return showMessage(t("notice.batchMoveIntoDescendant"));
    const duplicateTitle = moving.find((entry, index) => moving.some((other, otherIndex) => otherIndex < index && other.title === entry.title));
    const destinationConflict = moving.find((entry) => documentsRef.current.some((sibling) => (
      !sibling.deleted && !movingTreeIds.has(sibling.objectId) && sibling.parentId === parentId && sibling.title === entry.title
    )));
    if (duplicateTitle || destinationConflict) {
      const title = (duplicateTitle ?? destinationConflict)!.title;
      return showMessage(t("notice.batchMoveNameConflict", { title }));
    }
    if (beforeId && movingTreeIds.has(beforeId)) beforeId = null;
    for (const entry of moving) await moveDocument(entry.objectId, parentId, beforeId);
    setSelectedIds(new Set(roots));
    selectionAnchor.current = roots[roots.length - 1] ?? null;
  };

  const addAttachment = async (noteId: string, file: File) => {
    showMessage(t("notice.encryptingAttachment", { name: file.name }), "info");
    const attachment = await createLocalAttachment(user.id, noteId, file, () => !logoutStarted.current);
    await persistObject(attachment);
    const note = documentsRef.current.find((entry) => entry.objectId === noteId && entry.kind === "note");
    if (note) patchDocument(note.objectId, { attachmentIds: [...new Set([...note.attachmentIds, attachment.objectId])] }, 0);
    showMessage(t("notice.attachmentSaved", { name: attachment.originalName }), "info");
    requestPush("structural");
    return attachment;
  };

  const duplicateDocument = async (objectId: string, parentOverride?: string | null): Promise<string | null> => {
    const source = documentsRef.current.find((entry) => entry.objectId === objectId);
    if (!source) return null;
    if (source.kind === "folder") {
      const folderId = await createDocument("folder", `${source.title} ${t("app.copySuffix")}`, parentOverride === undefined ? source.parentId : parentOverride);
      const children = documentsRef.current.filter((entry) => entry.parentId === source.objectId && !entry.deleted).sort(compareDocuments("manual"));
      for (const child of children) await duplicateDocument(child.objectId, folderId);
      return folderId;
    }
    const noteId = await createDocument("note", `${source.title} ${t("app.copySuffix")}`, parentOverride === undefined ? source.parentId : parentOverride, source.markdown);
    let markdown = source.markdown;
    const newIds: string[] = [];
    for (const oldId of source.attachmentIds) {
      const old = attachmentsRef.current.find((entry) => entry.objectId === oldId && !entry.deleted);
      if (!old) continue;
      const blob = await decryptAttachmentBlob(user.id, old, () => !logoutStarted.current);
      const created = await addAttachment(noteId, new File([blob], old.originalName, { type: old.mime }));
      markdown = markdown.split(`webmd-attachment:${oldId}`).join(`webmd-attachment:${created.objectId}`);
      newIds.push(created.objectId);
    }
    const copy = documentsRef.current.find((entry) => entry.objectId === noteId);
    if (copy) await persistObject({ ...copy, markdown, attachmentIds: newIds, dirty: true });
    return noteId;
  };

  const duplicateDocuments = async (objectIds: string[]) => {
    const roots = selectionRoots(documentsRef.current, objectIds);
    const created: string[] = [];
    for (const objectId of roots) {
      const id = await duplicateDocument(objectId);
      if (id) created.push(id);
    }
    if (created.length) {
      setSelectedIds(new Set(created));
      selectionAnchor.current = created[created.length - 1];
      showMessage(t("notice.copiesCreated", { count: created.length }), "info");
    }
  };

  const saveCurrentHistory = async () => {
    if (!activeDocument) return;
    try {
      await flushDocument(activeDocument.objectId);
      const current = documentIndexRef.current.get(activeDocument.objectId);
      const saved = current ? await saveHistorySnapshot(current, "manual") : null;
      showMessage(saved ? t("notice.historySaved") : t("notice.historyUnchanged"), "info");
    } catch (error) {
      showMessage(translateError(error, t, "notice.historySaveFailed"), "critical");
    }
  };

  const deleteHistorySnapshot = async (item: HistoryListItem) => {
    if (!navigator.onLine) return showMessage(t("notice.historyDeleteOnlineOnly"));
    if (!window.confirm(t("history.deleteConfirm", { date: formatNoteTime(item.capturedAt) }))) return;
    try {
      await api(`/api/notes/${item.noteId}/history/${item.historyId}`, { method: "DELETE" });
      const key = historyKey(user.id, item.noteId, item.historyId);
      await localDb.transaction("rw", localDb.historySnapshots, localDb.historyOutbox, async () => {
        await localDb.historySnapshots.delete(key);
        await localDb.historyOutbox.delete(key);
      });
      setHistoryItems((current) => current.filter((entry) => entry.historyId !== item.historyId));
      if (historyPreview?.item.historyId === item.historyId) setHistoryPreview(null);
      await refreshHistorySettings().catch(() => undefined);
      showMessage(t("notice.historyDeleted"), "info");
    } catch (error) {
      showMessage(translateError(error, t, "notice.historyDeleteFailed"), "critical");
    }
  };

  const clearCurrentHistory = async () => {
    if (!activeDocument) return;
    if (!navigator.onLine) return showMessage(t("notice.historyDeleteOnlineOnly"));
    if (!window.confirm(t("history.clearNoteConfirm", { title: activeDocument.title }))) return;
    try {
      await api(`/api/notes/${activeDocument.objectId}/history`, { method: "DELETE" });
      await localDb.transaction("rw", localDb.historySnapshots, localDb.historyOutbox, async () => {
        await localDb.historySnapshots.where("[userId+noteId]").equals([user.id, activeDocument.objectId]).delete();
        await localDb.historyOutbox.where("[userId+noteId]").equals([user.id, activeDocument.objectId]).delete();
      });
      historyLastCapturedAt.current.delete(activeDocument.objectId);
      historyLastSignature.current.delete(activeDocument.objectId);
      setHistoryItems([]);
      setHistoryPreview(null);
      await refreshHistorySettings().catch(() => undefined);
      showMessage(t("notice.historyCleared"), "info");
    } catch (error) {
      showMessage(translateError(error, t, "notice.historyClearFailed"), "critical");
    }
  };

  const clearAllHistory = async () => {
    if (!navigator.onLine) return showMessage(t("notice.historyDeleteOnlineOnly"));
    if (!window.confirm(t("history.clearAllConfirm"))) return;
    try {
      await api("/api/account/note-history", { method: "DELETE" });
      await localDb.transaction("rw", localDb.historySnapshots, localDb.historyOutbox, async () => {
        await localDb.historySnapshots.where("userId").equals(user.id).delete();
        await localDb.historyOutbox.where("userId").equals(user.id).delete();
      });
      historyLastCapturedAt.current.clear();
      historyLastSignature.current.clear();
      setHistoryItems([]);
      setHistoryPreview(null);
      await refreshHistorySettings();
      showMessage(t("notice.historyAllCleared"), "info");
    } catch (error) {
      showMessage(translateError(error, t, "notice.historyClearFailed"), "critical");
    }
  };

  const restoreHistoryAsCurrent = async () => {
    if (!activeDocument || !historyPreview) return;
    const missing = attachmentIdsIn(historyPreview.payload.markdown)
      .filter((id) => !attachmentIndexRef.current.get(id) || attachmentIndexRef.current.get(id)?.deleted);
    if (missing.length && !window.confirm(t("history.restoreMissingAttachments", { count: missing.length }))) return;
    try {
      await flushDocument(activeDocument.objectId);
      const current = documentIndexRef.current.get(activeDocument.objectId);
      if (!current) return;
      await saveHistorySnapshot(current, "restore-safety");
      const title = siblingTitleExists(documentsRef.current, historyPreview.payload.title, current.parentId, current.objectId)
        ? uniqueSiblingTitle(documentsRef.current, historyPreview.payload.title, current.parentId)
        : historyPreview.payload.title;
      const restored = await persistObject({
        ...current,
        title,
        markdown: historyPreview.payload.markdown,
        tags: [...historyPreview.payload.tags],
        attachmentIds: [...new Set([
          ...current.attachmentIds,
          ...historyPreview.payload.attachmentIds,
          ...attachmentIdsIn(historyPreview.payload.markdown)
        ])],
        dirty: true
      });
      setTitleDraft(restored.title);
      setHistoryPreview(null);
      setEditorSessionId((value) => value + 1);
      requestPush("editor");
      showMessage(t("notice.historyRestored"), "info");
    } catch (error) {
      showMessage(translateError(error, t, "notice.historyRestoreFailed"), "critical");
    }
  };

  const restoreHistoryAsCopy = async () => {
    if (!activeDocument || !historyPreview) return;
    try {
      const referencedIds = [...new Set(attachmentIdsIn(historyPreview.payload.markdown))];
      const sources: Array<{ attachment: OpenAttachment; blob: Blob }> = [];
      for (const attachmentId of referencedIds) {
        const attachment = attachmentIndexRef.current.get(attachmentId);
        if (!attachment || attachment.deleted) throw new Error(t("history.copyMissingAttachment", { attachment: attachmentId }));
        sources.push({
          attachment,
          blob: await decryptAttachmentBlob(user.id, attachment, () => !logoutStarted.current)
        });
      }
      const title = uniqueSiblingTitle(
        documentsRef.current,
        t("history.restoredCopyTitle", { title: historyPreview.payload.title, date: formatNoteTime(historyPreview.item.capturedAt) }),
        activeDocument.parentId
      );
      const copy = makeDocument(documentsRef.current, "note", title, activeDocument.parentId, historyPreview.payload.markdown);
      copy.tags = [...historyPreview.payload.tags];
      let markdown = copy.markdown;
      const attachmentIds: string[] = [];
      const createdAttachments: OpenAttachment[] = [];
      try {
        for (const source of sources) {
          const attachment = await createLocalAttachment(
            user.id,
            copy.objectId,
            new File([source.blob], source.attachment.originalName, { type: source.attachment.mime }),
            () => !logoutStarted.current
          );
          createdAttachments.push(attachment);
          await persistObject(attachment);
          markdown = markdown.split(`webmd-attachment:${source.attachment.objectId}`).join(`webmd-attachment:${attachment.objectId}`);
          attachmentIds.push(attachment.objectId);
        }
        const persisted = await persistObject({ ...copy, markdown, attachmentIds, dirty: true });
        activeIdRef.current = persisted.objectId;
        setActiveId(persisted.objectId);
        setSelectedIds(new Set([persisted.objectId]));
        selectionAnchor.current = persisted.objectId;
        setHistoryPreview(null);
        setEditorSessionId((value) => value + 1);
        requestPush("structural");
        showMessage(t("notice.historyCopyRestored"), "info");
      } catch (error) {
        for (const attachment of createdAttachments) await removePurgedLocal(attachment.objectId, false);
        throw error;
      }
    } catch (error) {
      showMessage(translateError(error, t, "notice.historyCopyFailed"), "critical");
    }
  };

  const pinDocuments = async (objectIds: string[], pinned: boolean) => {
    for (const objectId of objectIds) {
      const target = documentsRef.current.find((entry) => entry.objectId === objectId && !entry.deleted);
      if (target && target.favorite !== pinned) await persistObject({ ...target, favorite: pinned, dirty: true });
    }
    requestPush("structural");
  };

  const updateDocumentTitle = async (objectId: string, value: string): Promise<boolean> => {
    const target = documentsRef.current.find((entry) => entry.objectId === objectId);
    if (!target) return false;
    const title = value.trim();
    if (!title) {
      showMessage(t("notice.nameRequired"));
      return false;
    }
    if (title === target.title) return true;
    if (siblingTitleExists(documentsRef.current, title, target.parentId, target.objectId)) {
      showMessage(t("notice.renameConflict", { title }));
      return false;
    }
    const next = { ...target, title, dirty: true };
    scheduleHistoryEdit(target, next);
    await persistObject(next);
    requestPush("structural");
    return true;
  };

  const commitTreeRename = (objectId: string, value: string) => {
    setRenamingDocumentId((current) => current === objectId ? null : current);
    void updateDocumentTitle(objectId, value);
  };

  const renameDocument = (objectId: string) => beginTreeRename(objectId);

  const exportRoot = async (objectId: string | null = null) => {
    const root = objectId ? documentsRef.current.find((entry) => entry.objectId === objectId) : null;
    const label = root ? `“${root.title}”` : t("notice.allNotes");
    if (!window.confirm(t("notice.exportConfirm", { label }))) return;
    if (root?.kind === "note" && !attachmentIdsIn(root.markdown).length) return exportSingleMarkdown(root);
    await exportMarkdownZip(
      documentsRef.current,
      attachmentsRef.current,
      (attachment) => decryptAttachmentBlob(user.id, attachment, () => !logoutStarted.current),
      objectId
    );
  };

  const exportDocuments = async (objectIds: string[]) => {
    const roots = selectionRoots(documentsRef.current, objectIds);
    if (roots.length === 1) return exportRoot(roots[0]);
    if (!roots.length || !window.confirm(t("notice.exportSelectionConfirm", { count: roots.length }))) return;
    await exportMarkdownZip(
      documentsRef.current,
      attachmentsRef.current,
      (attachment) => decryptAttachmentBlob(user.id, attachment, () => !logoutStarted.current),
      roots
    );
  };

  const handleImport = async (files: File[]) => {
    if (!files.length) return;
    try {
      showMessage(t("notice.importing"), "info");
      const count = await importFiles(files, {
        createFolder: (title, parentId) => createDocument("folder", title, parentId),
        createNote: (title, markdown, parentId) => createDocument("note", title, parentId, markdown),
        attachImage: async (noteId, file) => (await addAttachment(noteId, file)).objectId,
        updateNote: async (noteId, markdown, attachmentIds) => {
          const note = documentsRef.current.find((entry) => entry.objectId === noteId);
          if (note) await persistObject({ ...note, markdown, attachmentIds, dirty: true });
        }
      });
      showMessage(t("notice.imported", { count }), "info");
    } catch (error) {
      showMessage(translateError(error, t, "notice.importFailed"));
    }
  };

  const lock = async (logout = false) => {
    if (logoutStarted.current) return;
    if (!logout) {
      await finishHistorySession(true);
      for (const id of [...saveTimers.current.keys()]) await flushDocument(id);
    } else {
      logoutStarted.current = true;
      for (const timer of saveTimers.current.values()) window.clearTimeout(timer);
      saveTimers.current.clear();
      saveDeadlines.current.clear();
      try {
        await deleteLocalUserData(user.id);
      } catch (error) {
        logoutStarted.current = false;
        for (const document of documentsRef.current) {
          if (document.dirty) queueDocument(document, 0);
        }
        showMessage(translateError(error, t, "notice.logoutLocalClearFailed"), "critical");
        return;
      }
      clearCurrentBrowserSessionGrant();
      broadcastAccountLogout(user.id);
      syncCoordinator.current?.dispose();
      syncCoordinator.current = null;
      eventSource.current?.close();
      eventSource.current = null;
      if (safetyTimer.current !== null) window.clearInterval(safetyTimer.current);
      safetyTimer.current = null;
      if (fallbackTimer.current !== null) window.clearTimeout(fallbackTimer.current);
      fallbackTimer.current = null;
      if (syncStatusTimer.current !== null) window.clearTimeout(syncStatusTimer.current);
      syncStatusTimer.current = null;
    }
    await cryptoClient.lock();
    documentsRef.current = [];
    documentIndexRef.current.clear();
    attachmentsRef.current = [];
    attachmentIndexRef.current.clear();
    for (const cached of attachmentUrlCache.current.values()) URL.revokeObjectURL(cached.url);
    attachmentUrlCache.current.clear();
    onLocked(logout);
    if (logout) void api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  };

  const manualLock = () => {
    if (!hasDevicePin(credential)) {
      showMessage(t("notice.configurePin"));
      return;
    }
    void lock(false);
  };

  const lockFunction = useRef(lock);
  lockFunction.current = lock;
  useEffect(() => {
    if (!credential?.autoLockMinutes) return;
    const timeoutMs = credential.autoLockMinutes * 60 * 1000;
    let timer = 0;
    let lastArm = 0;
    const arm = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void lockFunction.current(false), timeoutMs); };
    const activity = () => {
      const now = Date.now();
      if (now - lastArm < 1000) return;
      lastArm = now;
      arm();
    };
    for (const eventName of ["pointermove", "pointerdown", "keydown", "input", "touchstart", "scroll"] as const) window.addEventListener(eventName, activity, { passive: true });
    arm();
    return () => {
      window.clearTimeout(timer);
      for (const eventName of ["pointermove", "pointerdown", "keydown", "input", "touchstart", "scroll"] as const) window.removeEventListener(eventName, activity);
    };
  }, [credential?.autoLockMinutes]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); };
  }, []);

  const jumpToHeading = (index: number) => {
    editorArea.current?.querySelectorAll("h1,h2,h3,h4,h5,h6").item(index)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setOutlineOpen(false);
  };

  const revealActiveDocument = () => {
    if (!activeDocument) return;
    const ancestors = new Set<string>();
    const seen = new Set<string>();
    let parentId = activeDocument.parentId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      ancestors.add(parentId);
      parentId = documentIndexRef.current.get(parentId)?.parentId ?? null;
    }
    setSearch("");
    setExpanded((current) => new Set([...current, ...ancestors]));
    setSelectedIds(new Set([activeDocument.objectId]));
    selectionAnchor.current = activeDocument.objectId;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      documentTree.current
        ?.querySelector<HTMLElement>(`[data-object-id="${activeDocument.objectId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }));
  };

  if (loading) return <main className="loading-shell"><div className="spinner" /><p>{t("app.loadingNotes")}</p></main>;

  const contextDocument = contextMenu ? documentIndexRef.current.get(contextMenu.objectId) ?? null : null;
  const contextDocuments = contextDocument
    ? documents.filter((entry) => selectedIds.has(contextDocument.objectId) ? selectedIds.has(entry.objectId) : entry.objectId === contextDocument.objectId)
    : [];
  const layoutStyle = {
    "--tree-width": `${preferences.treeWidth}px`,
    "--outline-width": `${preferences.outlineWidth}px`
  } as CSSProperties;
  return (
    <div className={`app-shell font-${preferences.fontSize} ${treeOpen ? "tree-open" : ""} ${outlineOpen ? "outline-open" : ""} ${preferences.treeCollapsed ? "tree-collapsed" : ""} ${preferences.outlineCollapsed ? "outline-collapsed" : ""}`} style={layoutStyle}>
      <aside className="tree-pane">
        <header className="side-header"><img className="brand-small" src="/icon.svg" alt="" aria-hidden="true" /><strong>Mint Notes</strong><button className="desktop-collapse" onClick={() => setPreferences({ ...preferences, treeCollapsed: true })} title={t("app.collapseDirectory")} aria-label={t("app.collapseDirectory")}><AppIcon icon={PanelLeftClose} /></button><button onClick={() => setTreeOpen(false)} className="mobile-only" aria-label={t("app.closeDirectory")}><AppIcon icon={X} /></button></header>
        {pinned.length > 0 && <div className="pinned-section" role="tree" aria-label={t("app.pinned")}>
          <div className="tree-section-label"><AppIcon icon={Pin} size={13} />{t("app.pinned")}</div>
          {pinned.map((entry) => <div className={`tree-row pinned-row ${entry.objectId === activeId ? "active" : ""} ${selectedIds.has(entry.objectId) ? "selected" : ""}`} key={`pinned-${entry.objectId}`} role="treeitem" aria-selected={selectedIds.has(entry.objectId)} onContextMenu={(event) => { event.preventDefault(); openTreeContext(entry, event.clientX, event.clientY); }}>
            <button className="tree-main" onClick={(event) => selectTreeEntry(entry, event)} title={entry.kind === "folder" ? t("app.folderToggleHint") : undefined}><span className="tree-spacer" /><span><AppIcon icon={entry.kind === "folder" ? Folder : FileText} size={17} /></span><span>{entry.title || t("app.untitled")}</span>{entry.dirty && <i title={t("app.notSynced")} />}</button>
            <button className="tree-more" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); openTreeContext(entry, rect.right, rect.bottom); }} aria-label={t("app.openMenu", { title: entry.title })}><AppIcon icon={Ellipsis} size={17} /></button>
          </div>)}
        </div>}
        <div className="search-box">
          <AppIcon icon={Search} size={16} />
          <input ref={searchInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("app.search")} />
          {search && <button type="button" className="search-clear" onClick={() => { setSearch(""); searchInput.current?.focus(); }} title={t("app.clearSearch")} aria-label={t("app.clearSearch")}><AppIcon icon={X} size={15} /></button>}
        </div>
        <nav className="tree-actions" aria-label={t("app.noteActions")}>
          <button onClick={() => void createNewDocument("note", null)} title={t("app.newNote")} aria-label={t("app.newNote")}><AppIcon icon={FilePlus2} /></button>
          <button onClick={() => void createNewDocument("folder", null)} title={t("app.createFolder")} aria-label={t("app.createFolder")}><AppIcon icon={FolderPlus} /></button>
          <span className="tree-view-actions">
            <button onClick={() => setExpanded(new Set())} title={t("app.collapseAll")} aria-label={t("app.collapseAll")}><AppIcon icon={ListCollapse} /></button>
            <button disabled={!activeDocument} onClick={revealActiveDocument} title={t("app.locateCurrent")} aria-label={t("app.locateCurrent")}><AppIcon icon={LocateFixed} /></button>
            <label className="tree-sort-action" title={t("app.sort")}><AppIcon icon={ArrowDownAZ} /><select value={preferences.sortMode} onChange={(event) => setPreferences({ ...preferences, sortMode: event.target.value as UiPreferences["sortMode"] })} aria-label={t("app.sort")}><option value="alphabetical">A–Z</option><option value="created">{t("app.sortCreated")}</option><option value="updated">{t("app.sortUpdated")}</option><option value="manual">{t("app.sortManual")}</option></select></label>
          </span>
        </nav>
        <div ref={documentTree} className="document-tree" role="tree" aria-multiselectable="true" onClick={(event) => { if (event.target === event.currentTarget) { setSelectedIds(new Set()); selectionAnchor.current = null; } }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFolderDropTarget(null); }} onDrop={(event) => { setFolderDropTarget(null); const ids = draggedIds(event.dataTransfer); if (ids.length) void moveDocuments(ids, null); }}>
          <TreeLevel childrenByParent={treeChildren} parentId={null} activeId={activeId} selectedIds={selectedIds} expanded={expanded} dropTargetId={folderDropTarget} renamingDocumentId={renamingDocumentId} onDropTarget={setFolderDropTarget} onSelect={selectTreeEntry} onContext={openTreeContext} onDragSelection={beginTreeDrag} onMove={moveDocuments} onRenameCommit={commitTreeRename} onRenameCancel={() => setRenamingDocumentId(null)} />
          {!searched.length && <p className="empty-tree">{t("app.noMatches")}</p>}
        </div>
        <footer className="side-footer">
          <div className="sidebar-user" title={`@${user.username}`}>
            <span className="sidebar-avatar" aria-hidden="true">{avatarUrl ? <img src={avatarUrl} alt="" /> : (displayName.trim().charAt(0).toLocaleUpperCase() || user.username.charAt(0).toLocaleUpperCase())}</span>
            <span className="sidebar-user-name"><strong>{displayName}</strong><small>@{user.username}</small></span>
          </div>
          <div className="side-footer-actions"><button onClick={() => setSettingsOpen(true)} title={t("settings.title")} aria-label={t("settings.title")}><AppIcon icon={Settings} size={17} /></button><button onClick={manualLock} title={t("app.lock")} aria-label={t("app.lock")}><AppIcon icon={LockKeyhole} size={17} /></button></div>
        </footer>
      </aside>

      <PaneResizer label={t("app.resizeLeft")} side="left" value={preferences.treeWidth} min={TREE_WIDTH_MIN} max={TREE_WIDTH_MAX} onResize={(treeWidth) => setPreferences((current) => ({ ...current, treeWidth }))} />

      <main className="note-pane">
        <header className="note-toolbar">
          <button className="pane-toggle" onClick={() => preferences.treeCollapsed ? setPreferences({ ...preferences, treeCollapsed: false }) : setTreeOpen(true)} aria-label={t("app.openLeft")}><AppIcon icon={PanelLeftOpen} /></button>
          {activeDocument ? <input ref={titleInput} className="title-input" value={historyPreview?.payload.title ?? titleDraft} readOnly={Boolean(historyPreview)} onChange={(event) => setTitleDraft(event.target.value)} onBlur={(event) => {
            if (historyPreview) return;
            const noteId = activeDocument.objectId;
            void updateDocumentTitle(noteId, event.currentTarget.value).then((updated) => {
              if (!updated) setTitleDraft(documentIndexRef.current.get(noteId)?.title ?? "");
            });
          }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} aria-label={t("app.noteTitle")} /> : <strong>{t("app.selectNote")}</strong>}
          <div className="mode-switch" aria-label={t("app.displayMode")}><button disabled={Boolean(historyPreview)} className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}>{t("app.modeLive")}</button><button disabled={Boolean(historyPreview)} className={mode === "source" ? "active" : ""} onClick={() => setMode("source")}>{t("app.modeSource")}</button><button disabled={Boolean(historyPreview)} className={mode === "readonly" ? "active" : ""} onClick={() => setMode("readonly")}>{t("app.modeReading")}</button></div>
          <input ref={attachmentInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            const noteId = activeDocument?.objectId;
            event.target.value = "";
            if (file && noteId) void addAttachment(noteId, file).then((attachment) => {
              const latest = documentIndexRef.current.get(noteId);
              if (latest) patchDocument(noteId, { markdown: latest.markdown + attachmentMarkdown(attachment.objectId, attachment.originalName) }, 0);
            });
          }} />
          {activeDocument && !historyPreview && <button className="toolbar-icon" onClick={() => attachmentInput.current?.click()} title={t("app.addImage")} aria-label={t("app.addImage")}><AppIcon icon={ImagePlus} /></button>}
          <button className="toolbar-icon right-pane-toggle" onClick={() => preferences.outlineCollapsed ? setPreferences({ ...preferences, outlineCollapsed: false }) : setOutlineOpen(true)} aria-label={t("app.openRight")}><AppIcon icon={PanelRightOpen} /></button>
        </header>
        {historyPreview && <div className="history-preview-banner">
          <span><AppIcon icon={HistoryIcon} size={16} /><strong>{t("history.preview")}</strong><small>{formatNoteTime(historyPreview.item.capturedAt)}</small></span>
          <div>
            <button onClick={() => setHistoryPreview(null)}>{t("history.exitPreview")}</button>
            <button onClick={() => void restoreHistoryAsCopy()}><AppIcon icon={Copy} size={14} />{t("history.restoreCopy")}</button>
            <button className="primary" onClick={() => void restoreHistoryAsCurrent()}><AppIcon icon={RotateCcw} size={14} />{t("history.restoreCurrent")}</button>
            <button className="danger" onClick={() => void deleteHistorySnapshot(historyPreview.item)} title={t("history.deleteOne")} aria-label={t("history.deleteOne")}><AppIcon icon={Trash2} size={14} /></button>
          </div>
        </div>}
        <div className="editor-area" ref={editorArea}>
          {activeDocument ? historyPreview
            ? <ReadOnlyMarkdown markdown={historyPreview.payload.markdown} attachmentUrls={attachmentUrls} />
            : mode === "readonly"
            ? <ReadOnlyMarkdown markdown={activeDocument.markdown} attachmentUrls={attachmentUrls} />
            : <TyporaEditor key={`${editorSessionId}:${mode}`} markdown={activeDocument.markdown} mode={mode} attachmentUrls={attachmentUrls} onChange={(markdown) => {
              const latest = documentIndexRef.current.get(activeDocument.objectId);
              if (!latest || markdown === latest.markdown) return;
              patchDocument(latest.objectId, { markdown, attachmentIds: [...new Set([...latest.attachmentIds, ...attachmentIdsIn(markdown)])] });
            }} onImageDrop={async (file) => { const attachment = await addAttachment(activeDocument.objectId, file); return attachmentMarkdown(attachment.objectId, attachment.originalName); }} />
            : <div className="empty-editor"><div className="empty-icon"><AppIcon icon={Sparkles} size={34} /></div><h2>{t("app.emptyTitle")}</h2><p>{t("app.emptyDescription")}</p></div>}
        </div>
        <footer className="status-bar">
          <span className="status-meta" title={activeDocument ? `${t("app.createdAt", { date: formatNoteTime(activeDocument.createdAt) })} · ${t("app.updatedAt", { date: formatNoteTime(activeDocument.updatedAt) })} · ${statusText(saveState, t)}` : statusText(saveState, t)}>
            {activeDocument && <><span>{t("app.createdAt", { date: formatNoteTime(activeDocument.createdAt) })}</span><span aria-hidden="true">·</span><span>{t("app.updatedAt", { date: formatNoteTime(activeDocument.updatedAt) })}</span><span aria-hidden="true">·</span></>}
            <span className={`status-${saveState}`}>{statusText(saveState, t)}</span>
          </span>
          <span className="status-count" title={t("app.countHelp")}>{t("app.count", { words: statistics.words, characters: statistics.characters })}</span>
        </footer>
      </main>

      <PaneResizer label={t("app.resizeRight")} side="right" value={preferences.outlineWidth} min={OUTLINE_WIDTH_MIN} max={OUTLINE_WIDTH_MAX} onResize={(outlineWidth) => setPreferences((current) => ({ ...current, outlineWidth }))} />

      <aside className="outline-pane">
        <header className="side-header right-panel-header">
          <nav className="right-panel-tabs" aria-label={t("app.rightPanel")}>
            <button className={preferences.rightPanelTab === "outline" ? "active" : ""} aria-current={preferences.rightPanelTab === "outline" ? "page" : undefined} onClick={() => setPreferences({ ...preferences, rightPanelTab: "outline" })}><AppIcon icon={ListTree} size={16} />{t("app.outline")}</button>
            <button className={preferences.rightPanelTab === "history" ? "active" : ""} aria-current={preferences.rightPanelTab === "history" ? "page" : undefined} onClick={() => setPreferences({ ...preferences, rightPanelTab: "history" })}><AppIcon icon={HistoryIcon} size={16} />{t("history.title")}</button>
          </nav>
          <button className="desktop-collapse" onClick={() => setPreferences({ ...preferences, outlineCollapsed: true })} title={t("app.collapseRight")} aria-label={t("app.collapseRight")}><AppIcon icon={PanelRightClose} /></button>
          <button onClick={() => setOutlineOpen(false)} className="mobile-outline-close" aria-label={t("app.closeRight")}><AppIcon icon={X} /></button>
        </header>
        <section className="right-panel-content" aria-label={preferences.rightPanelTab === "outline" ? t("app.noteOutline") : t("history.list")}>
          {preferences.rightPanelTab === "outline"
            ? <nav className="outline-list">{outline.map((item) => <button key={item.id} style={{ paddingLeft: `${16 + (item.level - 1) * 14}px` }} onClick={() => jumpToHeading(item.index)}>{item.text}</button>)}{!outline.length && <p className="outline-empty">{t("app.outlineEmpty")}</p>}</nav>
            : <HistoryPanel
                items={historyItems}
                selectedId={historyPreview?.item.historyId ?? null}
                loading={historyLoading}
                hasMore={historyHasMore}
                disabled={!activeDocument}
                onSelect={(item) => void selectHistorySnapshot(item)}
                onSave={() => void saveCurrentHistory()}
                onDelete={(item) => void deleteHistorySnapshot(item)}
                onClear={() => void clearCurrentHistory()}
                onLoadMore={() => activeDocument && void loadHistory(activeDocument.objectId, historyCursor, true)}
              />}
        </section>
      </aside>

      {(treeOpen || outlineOpen) && <button className="drawer-scrim" onClick={() => { setTreeOpen(false); setOutlineOpen(false); }} aria-label={t("app.closeSidebars")} />}
      {contextMenu && contextDocument && <ContextMenu document={contextDocument} selection={contextDocuments} documents={documents} position={contextMenu} onClose={() => setContextMenu(null)} onSelect={selectDocument} onRename={renameDocument} onMove={moveDocuments} onCreate={createNewDocument} onDuplicate={duplicateDocuments} onExport={exportDocuments} onPin={pinDocuments} onDelete={(ids) => setDeletedMany(ids, true)} onRestore={(ids) => setDeletedMany(ids, false)} onPurge={requestPurgeDocuments} />}
      {settingsOpen && <SettingsPanel user={{ ...user, displayName }} endpoint={endpoint} credential={credential} onCredentialChange={onCredentialChange} preferences={preferences} onPreferences={setPreferences} onClose={() => setSettingsOpen(false)} onLogout={() => lock(true)} onImport={handleImport} onExport={() => exportRoot(null)} onDisplayName={setDisplayName} avatarUrl={avatarUrl} onAvatarChange={updateAvatarUrl} trashItems={trashItems} purging={purging} onRestoreTrash={(objectId) => setDeletedMany([objectId], false)} onPurgeTrash={(objectId) => requestPurgeDocuments([objectId])} onClearTrash={requestClearTrash} historySettings={historySettings} onHistorySettings={applyHistorySettings} onRefreshHistorySettings={refreshHistorySettings} onClearHistory={clearAllHistory} onNotify={showMessage} />}
      {message && <Toast notice={message} onDismiss={() => setMessage(null)} />}
    </div>
  );
}

function TreeLevel({ childrenByParent, parentId, activeId, selectedIds, expanded, dropTargetId, renamingDocumentId, onDropTarget, onSelect, onContext, onDragSelection, onMove, onRenameCommit, onRenameCancel }: {
  childrenByParent: Map<string | null, OpenDocument[]>;
  parentId: string | null;
  activeId: string | null;
  selectedIds: Set<string>;
  expanded: Set<string>;
  dropTargetId: string | null;
  renamingDocumentId: string | null;
  onDropTarget: (objectId: string | null) => void;
  onSelect: (document: OpenDocument, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onContext: (document: OpenDocument, x: number, y: number) => void;
  onDragSelection: (document: OpenDocument) => string[];
  onMove: (ids: string[], parentId: string | null, beforeId?: string | null) => void;
  onRenameCommit: (objectId: string, value: string) => void;
  onRenameCancel: () => void;
}) {
  const { t } = useI18n();
  const children = childrenByParent.get(parentId) ?? [];
  return children.map((entry, entryIndex) => (
    <div className="tree-node" key={entry.objectId}>
      <div
        className={`tree-row ${entry.objectId === activeId ? "active" : ""} ${selectedIds.has(entry.objectId) ? "selected" : ""} ${dropTargetId === entry.objectId ? "drop-target" : ""}`}
        data-object-id={entry.objectId}
        role="treeitem"
        aria-selected={selectedIds.has(entry.objectId)}
        draggable={!entry.deleted && renamingDocumentId !== entry.objectId}
        onDragStart={(event) => {
          const ids = onDragSelection(entry);
          event.dataTransfer.setData(MULTI_DRAG_TYPE, JSON.stringify(ids));
          event.dataTransfer.setData("application/x-webmd-object", ids[0] ?? entry.objectId);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => onDropTarget(null)}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(MULTI_DRAG_TYPE) && !event.dataTransfer.types.includes("application/x-webmd-object")) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientY - rect.top) / rect.height;
          onDropTarget(isFolderDropZone(entry.kind, ratio) ? entry.objectId : null);
        }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && dropTargetId === entry.objectId) onDropTarget(null); }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDropTarget(null);
          const ids = draggedIds(event.dataTransfer);
          if (!ids.length) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientY - rect.top) / rect.height;
          if (isFolderDropZone(entry.kind, ratio)) onMove(ids, entry.objectId);
          else onMove(ids, entry.parentId, ratio < .5 ? entry.objectId : (children[entryIndex + 1]?.objectId ?? null));
        }}
        onContextMenu={(event) => { event.preventDefault(); onContext(entry, event.clientX, event.clientY); }}
      >
        {renamingDocumentId === entry.objectId
          ? <div className="tree-main tree-main-renaming"><span className={entry.kind === "note" ? "tree-spacer" : undefined}>{entry.kind === "folder" && <AppIcon icon={expanded.has(entry.objectId) ? ChevronDown : ChevronRight} size={14} />}</span><span><AppIcon icon={entry.kind === "folder" ? Folder : FileText} size={17} /></span><TreeRenameInput initialValue={entry.title} label={t("app.rename")} onCommit={(value) => onRenameCommit(entry.objectId, value)} onCancel={onRenameCancel} /></div>
          : entry.kind === "folder"
            ? <button className="tree-main" onClick={(event) => onSelect(entry, event)}><span><AppIcon icon={expanded.has(entry.objectId) ? ChevronDown : ChevronRight} size={14} /></span><span><AppIcon icon={Folder} size={17} /></span><span>{entry.title}</span></button>
            : <button className="tree-main" onClick={(event) => onSelect(entry, event)}><span className="tree-spacer" /><span><AppIcon icon={FileText} size={17} /></span><span>{entry.title || t("app.untitled")}</span>{entry.dirty && <i title={t("app.notSynced")} />}</button>}
        <button className="tree-more" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); onContext(entry, rect.right, rect.bottom); }} aria-label={t("app.openMenu", { title: entry.title })}><AppIcon icon={Ellipsis} size={17} /></button>
      </div>
      {entry.kind === "folder" && expanded.has(entry.objectId) && <div className="tree-children" role="group"><TreeLevel childrenByParent={childrenByParent} parentId={entry.objectId} activeId={activeId} selectedIds={selectedIds} expanded={expanded} dropTargetId={dropTargetId} renamingDocumentId={renamingDocumentId} onDropTarget={onDropTarget} onSelect={onSelect} onContext={onContext} onDragSelection={onDragSelection} onMove={onMove} onRenameCommit={onRenameCommit} onRenameCancel={onRenameCancel} /></div>}
    </div>
  )) as ReactNode;
}

function ContextMenu({ document, selection, documents, position, onClose, onSelect, onRename, onMove, onCreate, onDuplicate, onExport, onPin, onDelete, onRestore, onPurge }: {
  document: OpenDocument;
  selection: OpenDocument[];
  documents: OpenDocument[];
  position: { x: number; y: number };
  onClose: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string) => void;
  onMove: (ids: string[], parentId: string | null) => void;
  onCreate: (kind: "note" | "folder", parentId: string | null) => Promise<string>;
  onDuplicate: (ids: string[]) => Promise<void>;
  onExport: (ids: string[]) => Promise<void>;
  onPin: (ids: string[], pinned: boolean) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
  onRestore: (ids: string[]) => Promise<void>;
  onPurge: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const selected = selection.length ? selection : [document];
  const selectedIds = selected.map((entry) => entry.objectId);
  const roots = selectionRoots(documents, selectedIds);
  const single = selected.length === 1;
  const deleted = selected.every((entry) => entry.deleted);
  const allPinned = selected.every((entry) => entry.favorite);
  const folders = documents.filter((entry) => entry.kind === "folder" && !entry.deleted && !selectedIds.includes(entry.objectId) && roots.every((id) => canMoveDocument(documents, id, entry.objectId)));
  const act = (callback: () => unknown | Promise<unknown>) => { onClose(); void callback(); };
  return (
    <div className="context-menu" style={{ left: Math.min(position.x, window.innerWidth - 230), top: Math.min(position.y, window.innerHeight - 430) }} onPointerDown={(event) => event.stopPropagation()}>
      {!single && <p className="context-selection-count">{t("app.selectedCount", { count: selected.length })}</p>}
      {single && document.kind === "note" && <button onClick={() => act(() => onSelect(document.objectId))}>{t("app.open")}</button>}
      {!deleted && <>{single && <button onClick={() => act(() => onRename(document.objectId))}>{t("app.rename")}</button>}<button onClick={() => act(() => onPin(selectedIds, !allPinned))}>{allPinned ? t("app.unpin") : t("app.pinned")}</button></>}
      {!deleted && single && document.kind === "folder" && <><button onClick={() => act(() => onCreate("note", document.objectId))}>{t("app.createNoteInFolder")}</button><button onClick={() => act(() => onCreate("folder", document.objectId))}>{t("app.createSubfolder")}</button></>}
      {!deleted && <button onClick={() => act(() => onDuplicate(selectedIds))}>{t("app.duplicate")}</button>}
      <button onClick={() => act(() => onExport(selectedIds))}>{t("app.export")}</button>
      {!deleted && <details><summary>{t("app.moveTo")}</summary><button onClick={() => act(() => onMove(selectedIds, null))}>{t("app.rootDirectory")}</button>{folders.map((folder) => <button key={folder.objectId} onClick={() => act(() => onMove(selectedIds, folder.objectId))}>{folder.title}</button>)}</details>}
      <hr />
      {deleted ? <><button onClick={() => act(() => onRestore(selectedIds))}>{t("app.restore")}</button><button className="danger" onClick={() => act(() => onPurge(selectedIds))}>{t("app.permanentDeleteEllipsis")}</button></> : <button className="danger" onClick={() => act(() => onDelete(selectedIds))}>{t("app.moveToTrash")}</button>}
    </div>
  );
}
