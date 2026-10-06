import { useEffect, type RefObject } from "react";

export function useImageReconnectRetry(surface: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = surface.current;
    if (!root) return;
    const failures = new Map<HTMLImageElement, string>();
    const error = (event: Event) => {
      const image = event.target;
      if (image instanceof HTMLImageElement && image.src.startsWith("https:")) failures.set(image, image.src);
    };
    const load = (event: Event) => { if (event.target instanceof HTMLImageElement) failures.delete(event.target); };
    const retry = () => {
      if (!root.isConnected || root.closest("[hidden]") || document.visibilityState === "hidden" || !navigator.onLine) return;
      for (const [image, src] of failures) {
        failures.delete(image);
        if (!root.contains(image) || image.src !== src) continue;
        image.removeAttribute("src"); image.src = src;
      }
    };
    root.addEventListener("error", error, true); root.addEventListener("load", load, true);
    window.addEventListener("online", retry); window.addEventListener("focus", retry); document.addEventListener("visibilitychange", retry);
    return () => {
      root.removeEventListener("error", error, true); root.removeEventListener("load", load, true);
      window.removeEventListener("online", retry); window.removeEventListener("focus", retry); document.removeEventListener("visibilitychange", retry); failures.clear();
    };
  }, [surface]);
}
