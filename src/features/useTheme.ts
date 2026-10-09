import { useEffect } from "react";
import type { ThemePreference } from "../types";
import { watchDocumentTheme } from "./theme";

export function useTheme(preference: ThemePreference) {
  useEffect(() => watchDocumentTheme(preference), [preference]);
}
