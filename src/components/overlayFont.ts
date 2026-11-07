import type { CSSProperties } from "react";

export function overlayFont(target: EventTarget | null): CSSProperties | undefined {
  if (!(target instanceof Element)) return;
  const adjustment = getComputedStyle(target).getPropertyValue("--font-adjust").trim();
  if (adjustment) return { "--font-adjust": adjustment } as CSSProperties;
}
