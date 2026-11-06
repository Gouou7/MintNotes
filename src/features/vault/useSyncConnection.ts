import { useWorkspaceServices } from "../session/workspaceServices";
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
  const { transport } = useWorkspaceServices();
  const latest = useRef(options);
  latest.current = options;
  const source = useRef<AbortController | null>(null);
  const safetyTimer = useRef<number | null>(null);
  const fallbackTimer = useRef<number | null>(null);
  const fallbackDelay = useRef(60_000);
  const generation = useRef(0);
  const retryStream = useRef(() => {});

  const clearFallback = useCallback(() => {
    if (fallbackTimer.current !== null) window.clearTimeout(fallbackTimer.current);
    fallbackTimer.current = null;
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    source.current?.abort();
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
      if (!source.current) { retryStream.current(); scheduleFallback(); }
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
      const events = new AbortController();
      source.current = events;
      safetyTimer.current = window.setInterval(() => {
        if (current()) latest.current.requestPull(0);
      }, 5 * 60_000);
      try {
        const response = await transport.stream(
          `/api/sync/events?since=${cursor}&clientId=${encodeURIComponent(options.clientId)}`, events.signal
        );
        if (!current() || source.current !== events || !response.body) return;
        fallbackDelay.current = 60_000;
        clearFallback();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        while (current() && source.current === events) {
          const chunk = await reader.read();
          if (chunk.done) break;
          pending += decoder.decode(chunk.value, { stream: true });
          const frames = pending.split(/\r?\n\r?\n/);
          pending = frames.pop() ?? "";
          if (current() && frames.some((frame) => /^event: changed\r?$/m.test(frame))) latest.current.requestPull(250);
        }
      } catch {
        // The polling fallback also covers transient stream failures.
      } finally {
        if (source.current === events) {
          source.current = null;
          if (safetyTimer.current !== null) window.clearInterval(safetyTimer.current);
          safetyTimer.current = null;
          if (current()) requestFallbackPull();
        }
      }
    };

    retryStream.current = () => { void openEvents(); };
    const reconnect = () => {
      if (!current()) return;
      clearFallback();
      void latest.current.synchronize().finally(() => {
        if (current()) void openEvents();
      });
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        source.current?.abort();
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
  }, [options.enabled, options.serverSessionVerified, options.userId, options.clientId, clearFallback, requestFallbackPull, stop, transport]);

  return { requestFallbackPull, stop };
}
