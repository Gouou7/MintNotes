import type { ThemePreference } from "../types";

export function applyDocumentTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  const statusSurface = document.querySelector(".pwa-status-surface");
  if (!statusSurface) return;
  // Read a computed color so CSS color-mix() is resolved before reaching the native window.
  const background = getComputedStyle(statusSurface).backgroundColor;
  if (!background) return;
  // Both system media queries use the selected app theme, including explicit preferences.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = background;
  }
}

export function watchDocumentTheme(preference: ThemePreference) {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => applyDocumentTheme(preference === "system" ? (query.matches ? "dark" : "light") : preference);
  apply();
  if (preference !== "system") return () => {};

  query.addEventListener("change", apply);
  return () => query.removeEventListener("change", apply);
}
