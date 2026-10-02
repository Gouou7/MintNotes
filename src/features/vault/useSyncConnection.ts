import { useCallback, useEffect, useRef } from "react";
import { cursorKey, localDb } from "../../storage/database";

interface SyncConnectionOptions {
  userId: string;
  clientId: string;
  enabled: boolean;
  serverSessionVerified: boolean;
  isActive: () => boolean;
  synchronize: () => Promise<void>;
  requestPull: (delayMs: number) => void;
  onHidden: () => void;
}

/** Browser network events prompt a real request; they cannot establish server reachability. */
export function useSyncConnection(options: SyncConnectionOptions) {
  const latest = useRef(options);
  latest.current = options;
  const source = useRef<EventSource | null>(null);
  const safetyTimer = useRef<number | null>(null);
  const fallbackTimer = useRef<number | null>(null);
  const fallbackDelay = useRef(60_000);
  const generation = useRef(0);

  const clearFallback = useCallback(() => {
    if (fallbackTimer.current !== null) window.clearTimeout(fallbackTimer.current);
    fallbackTimer.current = null;
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    source.current?.close();
    source.current = null;
    if (safetyTimer.current !== null) window.clearInterval(safetyTimer.current);
    safetyTimer.current = null;
    clearFallback();
  }, [clearFallback]);

  const canRun = () => latest.current.enabled
    && latest.current.serverSessionVerified
    && latest.current.isActive()
    && document.visibilityState === "visible";

  const requestFallbackPull = useCallback(function scheduleFallback() {
    if (fallbackTimer.current !== null || !canRun()) return;
    const delay = fallbackDelay.current;
    fallbackTimer.current = window.setTimeout(() => {
      fallbackTimer.current = null;
      if (!canRun()) return;
      latest.current.requestPull(0);
      fallbackDelay.current = Math.min(300_000, Math.max(60_000, delay * 2));
      if (source.current?.readyState !== EventSource.OPEN) scheduleFallback();
    }, delay);
  }, []);

  useEffect(() => {
    if (!options.enabled) return;
    const connectionGeneration = generation.current;
    const current = () => generation.current === connectionGeneration && canRun();

    const openEvents = async () => {
      if (!current() || source.current) return;
      const cursor = Number((await localDb.meta.get(cursorKey(options.userId)))?.value ?? 0);
      if (!current() || source.current) return;
      const events = new EventSource(
        `/api/sync/events?since=${cursor}&clientId=${encodeURIComponent(options.clientId)}`,
        { withCredentials: true }
      );
      source.current = events;
      events.onopen = () => {
        if (!current() || source.current !== events) return;
        fallbackDelay.current = 60_000;
        clearFallback();
      };
      events.addEventListener("changed", () => {
        if (current() && source.current === events) latest.current.requestPull(250);
      });
      events.onerror = () => {
        if (current() && source.current === events) requestFallbackPull();
      };
      safetyTimer.current = window.setInterval(() => {
        if (current()) latest.current.requestPull(0);
      }, 5 * 60_000);
    };

    const reconnect = () => {
      if (!current()) return;
      clearFallback();
      void latest.current.synchronize().finally(() => {
        if (current()) void openEvents();
      });
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        source.current?.close();
        source.current = null;
        if (safetyTimer.current !== null) window.clearInterval(safetyTimer.current);
        safetyTimer.current = null;
        clearFallback();
        latest.current.onHidden();
      } else {
        reconnect();
      }
    };
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", reconnect);
    document.addEventListener("visibilitychange", visibility);
    reconnect();
    return () => {
      stop();
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", reconnect);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [options.enabled, options.serverSessionVerified, options.userId, options.clientId, clearFallback, requestFallbackPull, stop]);

  return { requestFallbackPull, stop };
}
