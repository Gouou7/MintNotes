export const IMAGE_RECONNECT_RETRY_INTERVAL_MS = 5_000;

export function isExternalImageSource(source: string): boolean {
  try {
    const url = new URL(source, window.location.href);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin !== window.location.origin;
  } catch {
    return false;
  }
}

export function isImageRetrySurfaceActive(surface: HTMLElement): boolean {
  return surface.isConnected && !surface.closest("[hidden]");
}

/** Each online signal retries only current failures; repeated signals are coalesced per source. */
export function createImageReconnectRetry(options: {
  isActive: () => boolean;
  getFailedSources: () => Iterable<string>;
  retry: (source: string) => void;
}): () => void {
  const pending = new Set<string>();
  const lastAttempts = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (disposed || !options.isActive()) {
      pending.clear();
      return;
    }
    const currentFailures = new Set(options.getFailedSources());
    const now = Date.now();
    let delay = Infinity;
    for (const source of pending) {
      if (!currentFailures.has(source)) {
        pending.delete(source);
        continue;
      }
      const lastAttempt = lastAttempts.get(source);
      const remaining = lastAttempt === undefined ? 0 : IMAGE_RECONNECT_RETRY_INTERVAL_MS - (now - lastAttempt);
      if (remaining > 0) {
        delay = Math.min(delay, remaining);
      } else {
        pending.delete(source);
        lastAttempts.set(source, now);
        options.retry(source);
      }
    }
    if (Number.isFinite(delay)) timer = setTimeout(flush, delay);
  };
  const reconnect = () => {
    if (!options.isActive()) return;
    const now = Date.now();
    for (const [source, attemptedAt] of lastAttempts) {
      if (now - attemptedAt >= IMAGE_RECONNECT_RETRY_INTERVAL_MS) lastAttempts.delete(source);
    }
    for (const source of options.getFailedSources()) {
      if (isExternalImageSource(source)) pending.add(source);
    }
    flush();
  };
  window.addEventListener("online", reconnect);
  return () => {
    disposed = true;
    window.removeEventListener("online", reconnect);
    clearTimeout(timer);
    pending.clear();
    lastAttempts.clear();
  };
}
