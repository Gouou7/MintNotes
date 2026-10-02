import { useCallback, useEffect, useRef, type RefObject, type SyntheticEvent } from "react";
import { createImageReconnectRetry, isExternalImageSource, isImageRetrySurfaceActive } from "./core/image-reconnect-retry";

export function useImageReconnectRetry(surface: RefObject<HTMLElement | null>) {
  const failures = useRef(new WeakMap<HTMLImageElement, string>());
  useEffect(() => {
    const root = surface.current;
    if (!root) return;
    const failedImages = () => [...root.querySelectorAll<HTMLImageElement>("img[src]")]
      .filter((image) => failures.current.get(image) === image.getAttribute("src"));
    return createImageReconnectRetry({
      isActive: () => isImageRetrySurfaceActive(root),
      getFailedSources: () => failedImages().map((image) => image.getAttribute("src")!),
      retry: (source) => {
        for (const image of failedImages()) {
          if (image.getAttribute("src") !== source) continue;
          failures.current.delete(image);
          image.removeAttribute("src");
          image.setAttribute("src", source);
        }
      }
    });
  }, [surface]);
  const onError = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const source = event.currentTarget.getAttribute("src");
    if (source && isExternalImageSource(source)) failures.current.set(event.currentTarget, source);
  }, []);
  const onLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    failures.current.delete(event.currentTarget);
  }, []);
  return { onError, onLoad };
}
