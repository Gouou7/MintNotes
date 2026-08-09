import { useEffect, useRef } from "react";
import type { OpenDocument } from "../../types";

interface DocumentSaveQueueOptions {
  isActive: () => boolean;
  getDocument: (objectId: string) => OpenDocument | undefined;
  upsertDocument: (document: OpenDocument) => void;
  persistDocument: (document: OpenDocument, isCurrent: () => boolean) => Promise<void>;
  onPersisted: () => void;
}

interface PendingSave {
  timer: number | null;
  deadline: number;
  retryCount: number;
  running: Promise<void> | null;
}

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * Owns plaintext document save scheduling while the vault is unlocked.
 * Failed writes stay pending in memory and retry until a durable object/outbox
 * transaction succeeds. Callers must await flushAll before locking or changing
 * an interaction boundary that would discard decrypted state.
 */
export function useDocumentSaveQueue(options: DocumentSaveQueueOptions) {
  const pending = useRef(new Map<string, PendingSave>());

  const arm = (objectId: string, delay: number) => {
    const state = pending.current.get(objectId);
    if (!state || !options.isActive()) return;
    if (state.timer !== null) window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => {
      state.timer = null;
      void run(objectId).catch(() => undefined);
    }, Math.max(0, delay));
  };

  const run = async (objectId: string): Promise<void> => {
    const state = pending.current.get(objectId);
    if (!state || !options.isActive()) return;
    if (state.running) return state.running;
    if (state.timer !== null) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
    const current = options.getDocument(objectId);
    if (!current) {
      pending.current.delete(objectId);
      return;
    }
    const attempt = options.persistDocument(current, () => options.getDocument(objectId) === current)
      .then(() => {
        const latest = options.getDocument(objectId);
        const active = pending.current.get(objectId);
        if (active !== state) return;
        if (latest === current || !latest?.dirty) {
          pending.current.delete(objectId);
        } else {
          state.retryCount = 0;
          arm(objectId, 0);
        }
        options.onPersisted();
      })
      .catch((error: unknown) => {
        const active = pending.current.get(objectId);
        if (active === state && options.isActive()) {
          state.retryCount += 1;
          arm(objectId, Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(5, state.retryCount - 1)));
        }
        throw error;
      })
      .finally(() => {
        if (state.running === attempt) state.running = null;
      });
    state.running = attempt;
    return attempt;
  };

  const queue = (document: OpenDocument, delay = 500, maxWait = 5_000) => {
    if (!options.isActive()) return;
    options.upsertDocument(document);
    const now = Date.now();
    const state = pending.current.get(document.objectId) ?? {
      timer: null,
      deadline: now + maxWait,
      retryCount: 0,
      running: null
    };
    state.deadline = Math.min(state.deadline, now + maxWait);
    state.retryCount = 0;
    pending.current.set(document.objectId, state);
    arm(document.objectId, Math.min(delay, Math.max(0, state.deadline - now)));
  };

  const flush = async (objectId: string) => {
    const state = pending.current.get(objectId);
    if (state) {
      if (state.timer !== null) {
        window.clearTimeout(state.timer);
        state.timer = null;
      }
      await run(objectId);
    }
    const remaining = pending.current.get(objectId)?.running;
    if (remaining) await remaining;
  };

  const flushAll = async () => {
    for (const objectId of [...pending.current.keys()]) await flush(objectId);
  };

  const cancelAll = () => {
    for (const state of pending.current.values()) {
      if (state.timer !== null) window.clearTimeout(state.timer);
    }
    pending.current.clear();
  };

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!pending.current.size) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      cancelAll();
    };
  }, []);

  return {
    queue,
    flush,
    flushAll,
    cancelAll,
    hasPending: (objectId: string) => pending.current.has(objectId),
    pendingIds: () => [...pending.current.keys()]
  };
}
