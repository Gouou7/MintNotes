import { useWorkspaceServices } from "../session/workspaceServices";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { ApiError } from "../../api";
import { isLanguagePreference, translateError, type Translate } from "../../i18n";
import {
  cursorKey,
  ignoredDecryptFailuresKey,
  localDb,
  localKey,
  preferencesKey,
  type LocalEncryptedObject
} from "../../storage/database";
import type { LanguagePreference, UiPreferences } from "../../types";
import { normalizeFontSize, normalizeWrapCodeBlocks } from "../appearance";
import { decryptAvailableLocalObjects, decryptFailureFingerprint, shouldCreateWelcomeNote } from "../vaultLoad";
import { parseLegacyWorkspaceState, resolveDeviceActiveNoteId, resolveDeviceWorkspacePreferences, WORKSPACE_OBJECT_ID } from "../workspace";
import { SyncCursorResetRequired } from "./pullController";
import type { SaveState } from "./useSyncStatus";
import { countPendingSyncEntries, settledSyncPhase, synchronizationFailure, type SyncFailure } from "./useSyncStatus";
import type { useToastNotifications } from "./useToastNotifications";
import type { CreateDocumentOptions } from "./useVaultDocuments";
import type { useVaultModel } from "./useVaultModel";
import { DEFAULT_PREFERENCES } from "./useVaultPreferences";
import type { useWorkspaceSelection } from "./useWorkspaceSelection";

interface Options {
  model: ReturnType<typeof useVaultModel>;
  selection: ReturnType<typeof useWorkspaceSelection>;
  userId: string;
  logoutStarted: RefObject<boolean>;
  languagePreference: LanguagePreference;
  setPreferences: Dispatch<SetStateAction<UiPreferences>>;
  setPreferencesLoaded: Dispatch<SetStateAction<boolean>>;
  serverSessionVerifiedRef: RefObject<boolean>;
  pullChanges: () => Promise<Set<string>>;
  showMessage: ReturnType<typeof useToastNotifications>["showMessage"];
  t: Translate;
  createDocument: (kind: "note" | "folder", title: string, parentId: string | null, markdown?: string, options?: CreateDocumentOptions) => Promise<string>;
  setUnavailable: () => void;
  setSaveState: (phase: Exclude<SaveState, "error">) => void;
  setSyncError: (failure: SyncFailure) => void;
  setWorkspaceLoaded: Dispatch<SetStateAction<boolean>>;
  requestPush: (kind?: "editor" | "structural") => void;
}

/** 本地保险库加载、损坏记录隔离与首次远端校验。 */
export function useVaultLoad(options: Options) {
  const { cryptoClient } = useWorkspaceServices();
  const {
    model,
    selection,
    userId,
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
  } = options;
  const { replaceDocuments, replaceAttachments, documentsRef, attachmentsRef } = model;
  const { activateDocument } = selection;

  const [loading, setLoading] = useState(true);

  const [loadFailure, setLoadFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [stored, pending, storedPreferences, ignoredFailuresRecord] = await Promise.all([
          localDb.objects.where("userId").equals(userId).toArray(),
          localDb.outbox.where("userId").equals(userId).toArray(),
          localDb.meta.get(preferencesKey(userId)),
          localDb.meta.get(ignoredDecryptFailuresKey(userId))
        ]);
        if (cancelled || logoutStarted.current) return;
        let storedUiPreferences: Partial<UiPreferences> = {};
        try {
          storedUiPreferences = JSON.parse(storedPreferences?.value ?? "{}") as Partial<UiPreferences>;
        } catch {
          // Malformed device-local preferences fall back to defaults.
        }
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
          cryptoClient.decryptObject(userId, object.objectId, object.objectType, object.revision, object.ciphertext, object.nonce)
        ));
        if (cancelled || logoutStarted.current) return;
        // Commit every successfully decrypted record before any network work.
        // One damaged/stale ciphertext must never make the entire vault look
        // empty, and the original encrypted record remains untouched in Dexie.
        const localWorkspace = opened.documents.find((entry) => entry.objectId === WORKSPACE_OBJECT_ID) ?? null;
        const legacyWorkspace = localWorkspace ? parseLegacyWorkspaceState(localWorkspace) : null;
        const deviceWorkspace = resolveDeviceWorkspacePreferences(storedUiPreferences, legacyWorkspace);
        const loadedPreferences: UiPreferences = {
          ...DEFAULT_PREFERENCES,
          ...storedUiPreferences,
          ...deviceWorkspace,
          fontSize: normalizeFontSize(storedUiPreferences.fontSize),
          wrapCodeBlocks: normalizeWrapCodeBlocks(storedUiPreferences.wrapCodeBlocks),
          language: isLanguagePreference(storedUiPreferences.language) ? storedUiPreferences.language : languagePreference
        };
        await localDb.transaction("rw", localDb.objects, localDb.outbox, localDb.meta, async () => {
          await localDb.objects.delete(localKey(userId, WORKSPACE_OBJECT_ID));
          await localDb.outbox.delete(localKey(userId, WORKSPACE_OBJECT_ID));
          await localDb.meta.put({ key: preferencesKey(userId), value: JSON.stringify(loadedPreferences) });
        });
        pendingByKey.delete(localKey(userId, WORKSPACE_OBJECT_ID));
        replaceDocuments(opened.documents.filter((entry) => entry.objectId !== WORKSPACE_OBJECT_ID));
        replaceAttachments(opened.attachments);
        setPreferences(loadedPreferences);
        setPreferencesLoaded(true);

        const failedLocalObjects = opened.failed.filter((object) => object.objectId !== WORKSPACE_OBJECT_ID);
        const storedContent = stored.filter((entry) => entry.objectId !== WORKSPACE_OBJECT_ID);
        const pendingContent = pending.filter((entry) => entry.objectId !== WORKSPACE_OBJECT_ID);

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
        const mustVerifyServerFromStart = canRepairFromServer || (storedContent.length === 0 && pendingContent.length === 0);
        if (mustVerifyServerFromStart && !logoutStarted.current) await localDb.meta.put({ key: cursorKey(userId), value: "0" });
        const attemptedInitialPull = serverSessionVerifiedRef.current;
        let initialPullFailure: { error: unknown } | undefined;
        let failedRemoteIds = new Set<string>();
        if (attemptedInitialPull) {
          try {
            failedRemoteIds = await pullChanges();
          } catch (error) {
            initialPullFailure = { error };
          }
        }
        if (cancelled || logoutStarted.current) return;
        const awaitingReconciliation = initialPullFailure?.error instanceof SyncCursorResetRequired;
        const openedOffline = !navigator.onLine && (!attemptedInitialPull || Boolean(initialPullFailure
          && !awaitingReconciliation && !(initialPullFailure.error instanceof ApiError)));

        const loadedIds = new Set([
          ...documentsRef.current.map((entry) => entry.objectId),
          ...attachmentsRef.current.map((entry) => entry.objectId)
        ]);
        const unresolved = failedLocalObjects.filter((object) => !loadedIds.has(object.objectId));
        const visibleFailures = unresolved.filter((object) => !ignoredFailureFingerprints.has(decryptFailureFingerprint(object)));
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
                await localDb.meta.put({ key: ignoredDecryptFailuresKey(userId), value: JSON.stringify([...fingerprints]) });
              }
            }
          );
        } else if (failedRemoteIds.size) {
          showMessage(t("notice.remoteIntegrityOthers", { count: failedRemoteIds.size }), "critical");
        } else if (openedOffline && opened.documents.some((entry) => entry.kind === "note" && !entry.deleted)) {
          showMessage(t("notice.loadedOffline"), "warning");
        }

        const verifiedEmptyVault = shouldCreateWelcomeNote({
          serverSessionVerified: attemptedInitialPull && serverSessionVerifiedRef.current,
          storedContentCount: storedContent.length,
          pendingContentCount: pendingContent.length,
          initialPullFailed: Boolean(initialPullFailure),
          failedRemoteCount: failedRemoteIds.size
        });
        if (verifiedEmptyVault && !documentsRef.current.some((entry) => entry.kind === "note" && !entry.deleted)) {
          await createDocument("note", t("app.welcomeTitle"), null, t("app.welcomeMarkdown"), { activate: false });
        }
        const restoredActiveId = resolveDeviceActiveNoteId(loadedPreferences.activeNoteId, documentsRef.current);
        if (restoredActiveId) {
          activateDocument(restoredActiveId);
        } else {
          activateDocument(null);
          setPreferences((current) => ({
            ...current,
            activeNoteId: null,
            openNoteIds: []
          }));
        }
        if (!attemptedInitialPull || !serverSessionVerifiedRef.current) {
          setUnavailable();
        } else if (openedOffline) {
          setSaveState("offline");
        } else if (awaitingReconciliation) {
          setSaveState("local");
        } else if (initialPullFailure) {
          setSyncError(synchronizationFailure(initialPullFailure.error, t));
        } else {
          const remaining = await countPendingSyncEntries(userId);
          setSaveState(settledSyncPhase(serverSessionVerifiedRef.current, remaining));
        }
        setWorkspaceLoaded(true);
        setLoading(false);
        requestPush("structural");
      } catch (error) {
        if (cancelled || logoutStarted.current) return;
        setLoadFailure(translateError(error, t, "notice.openDatabaseFailed"));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return { loading, loadFailure };
}
