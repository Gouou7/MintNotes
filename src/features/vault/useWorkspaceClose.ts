import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { translateError, type Translate } from "../../i18n";
import type { useDocumentSaveQueue } from "./useDocumentSaveQueue";
import type { useImportExport } from "./useImportExport";
import type { useObjectPersistence } from "./useObjectPersistence";
import type { useToastNotifications } from "./useToastNotifications";

export interface WorkspaceCloseOptions {
  logoutStarted: RefObject<boolean>;
  cancelConfirmation?: () => void;
  importExport: Pick<ReturnType<typeof useImportExport>, "cancel" | "resume">;
  finishHistorySession: (capture?: boolean) => Promise<void>;
  documentSaveQueue: Pick<ReturnType<typeof useDocumentSaveQueue>, "flushAll" | "cancelAll">;
  objectPersistence: Pick<ReturnType<typeof useObjectPersistence>, "drainAll" | "pause">;
  showMessage: ReturnType<typeof useToastNotifications>["showMessage"];
  t: Translate;
  stopSync: () => void;
  registerClose: (handler: ((discard: boolean) => Promise<boolean>) | null) => void;
}

export function useWorkspaceClose(options: WorkspaceCloseOptions) {
  const [closing, setClosing] = useState(false);
  const latest = useRef(options);
  latest.current = options;
  useLayoutEffect(() => {
    const register = latest.current.registerClose;
    register(async (discard) => {
      const {
        importExport, finishHistorySession, documentSaveQueue, objectPersistence,
        logoutStarted, showMessage, t, stopSync, cancelConfirmation
      } = latest.current;
      setClosing(true);
      cancelConfirmation?.();
      try {
        await importExport.cancel();
        if (discard) documentSaveQueue.cancelAll();
        else {
          await finishHistorySession(true);
          await documentSaveQueue.flushAll();
        }
        await objectPersistence.drainAll();
      } catch (reason) {
        setClosing(false);
        importExport.resume();
        showMessage(translateError(reason, t, "notice.localSaveFailed"), "critical");
        return false;
      }
      logoutStarted.current = true;
      objectPersistence.pause();
      stopSync();
      return true;
    });
    return () => register(null);
  }, []);
  return closing;
}
