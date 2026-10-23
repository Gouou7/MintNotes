import type { RefObject } from "react";
import { api } from "../../api";
import { cryptoClient } from "../../crypto/client";
import {
  broadcastAccountLogout,
  clearCurrentBrowserSessionGrant,
  clearPendingEndpointRevocation,
  clearPinRefreshGrant,
  hasDevicePin,
  markEndpointRevocationPending
} from "../../crypto/deviceUnlock";
import { translateError, type Translate } from "../../i18n";
import { deleteLocalUserData, type DeviceUnlockCredential } from "../../storage/database";
import type { AuthEndpoint, OpenDocument } from "../../types";
import type { useDocumentSaveQueue } from "./useDocumentSaveQueue";
import type { useImportExport } from "./useImportExport";
import type { useObjectPersistence } from "./useObjectPersistence";
import type { useToastNotifications } from "./useToastNotifications";
import type { useVaultModel } from "./useVaultModel";
import { useWorkspaceAutoLock } from "./useWorkspaceInteractions";

interface Options {
  model: ReturnType<typeof useVaultModel>;
  logoutStarted: RefObject<boolean>;
  importExport: ReturnType<typeof useImportExport>;
  finishHistorySession: (capture?: boolean) => Promise<void>;
  documentSaveQueue: ReturnType<typeof useDocumentSaveQueue>;
  objectPersistence: ReturnType<typeof useObjectPersistence>;
  showMessage: ReturnType<typeof useToastNotifications>["showMessage"];
  t: Translate;
  userId: string;
  queueDocument: (document: OpenDocument, delay?: number, maxWait?: number) => void;
  stopSync: () => void;
  attachmentUrlCache: RefObject<Map<string, { signature: string; url: string; }>>;
  onLocked: (logout: boolean) => void;
  endpoint: AuthEndpoint;
  credential: DeviceUnlockCredential | null;
}

/** 锁定、登出与解密内存清理。 */
export function useVaultLock(options: Options) {
  const {
    model,
    logoutStarted,
    importExport,
    finishHistorySession,
    documentSaveQueue,
    objectPersistence,
    showMessage,
    t,
    userId,
    queueDocument,
    stopSync,
    attachmentUrlCache,
    onLocked,
    endpoint,
    credential
  } = options;
  const { documentsRef, documentIndexRef, attachmentsRef, attachmentIndexRef } = model;

  const lock = async (logout = false) => {
    if (logoutStarted.current) return;
    await importExport.cancel();
    clearPinRefreshGrant();
    if (!logout) {
      try {
        await finishHistorySession(true);
        await documentSaveQueue.flushAll();
        await objectPersistence.drainAll();
      } catch (error) {
        importExport.resume();
        showMessage(translateError(error, t, "notice.localSaveFailed"), "critical");
        return;
      }
    } else {
      logoutStarted.current = true;
      objectPersistence.pause();
      documentSaveQueue.cancelAll();
      await objectPersistence.drainAll();
      try {
        await deleteLocalUserData(userId);
      } catch (error) {
        logoutStarted.current = false;
        objectPersistence.resume();
        importExport.resume();
        for (const document of documentsRef.current) {
          if (document.dirty) queueDocument(document, 0);
        }
        showMessage(translateError(error, t, "notice.logoutLocalClearFailed"), "critical");
        return;
      }
      clearCurrentBrowserSessionGrant();
      broadcastAccountLogout(userId);
      stopSync();
    }
    logoutStarted.current = true;
    objectPersistence.pause();
    stopSync();
    await cryptoClient.lock();
    documentsRef.current = [];
    documentIndexRef.current.clear();
    attachmentsRef.current = [];
    attachmentIndexRef.current.clear();
    for (const cached of attachmentUrlCache.current.values()) URL.revokeObjectURL(cached.url);
    attachmentUrlCache.current.clear();
    onLocked(logout);
    if (logout) {
      const loggedOut = await api("/api/auth/logout", { method: "POST" })
        .then(() => true)
        .catch(() => false);
      if (loggedOut) await clearPendingEndpointRevocation(endpoint.id).catch(() => undefined);
      else await markEndpointRevocationPending(userId, endpoint.id).catch(() => undefined);
    }
  };

  const manualLock = () => {
    if (!hasDevicePin(credential)) {
      showMessage(t("notice.configurePin"));
      return;
    }
    void lock(false);
  };

  useWorkspaceAutoLock({
    minutes: credential?.autoLockMinutes,
    userId,
    endpointId: endpoint.id,
    onLock: () => void lock(false)
  });

  return { lock, manualLock };
}
