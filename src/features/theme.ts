import type { ThemePreference } from "../types";

export function applyDocumentTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function watchDocumentTheme(preference: ThemePreference) {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => applyDocumentTheme(preference === "system" ? (query.matches ? "dark" : "light") : preference);
  apply();
  if (preference !== "system") return () => {};

  query.addEventListener("change", apply);
  return () => query.removeEventListener("change", apply);
}
