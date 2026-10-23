import type { RefObject } from "react";
import { useEffect, useState } from "react";
import { localDb, preferencesKey } from "../../storage/database";
import type { LanguagePreference, UiPreferences } from "../../types";
import { DEFAULT_FONT_SIZE, DEFAULT_WRAP_CODE_BLOCKS } from "../appearance";
import { useTheme } from "../useTheme";
import { DEFAULT_DEVICE_WORKSPACE_PREFERENCES } from "../workspace";
import type { useWorkspaceSelection } from "./useWorkspaceSelection";

export const DEFAULT_PREFERENCES: UiPreferences = {
  ...DEFAULT_DEVICE_WORKSPACE_PREFERENCES,
  theme: "system",
  fontSize: DEFAULT_FONT_SIZE,
  wrapCodeBlocks: DEFAULT_WRAP_CODE_BLOCKS,
  language: "system",
  sortMode: "alphabetical",
  treeCollapsed: false,
  outlineCollapsed: false,
  treeWidth: 297,
  outlineWidth: 297,
  rightPanelTab: "outline"
};

interface Options {
  selection: ReturnType<typeof useWorkspaceSelection>;
  languagePreference: LanguagePreference;
  logoutStarted: RefObject<boolean>;
  userId: string;
  setLanguagePreference: (preference: LanguagePreference) => void;
  workspaceLoaded: boolean;
}

/** 设备偏好的持久化、语言和主题同步。 */
export function useVaultPreferences(options: Options) {
  const {
    selection,
    languagePreference,
    logoutStarted,
    userId,
    setLanguagePreference,
    workspaceLoaded
  } = options;
  const { activeId } = selection;

  const [preferences, setPreferences] = useState<UiPreferences>(() => ({ ...DEFAULT_PREFERENCES, language: languagePreference }));

  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    if (!preferencesLoaded) return;
    const timer = window.setTimeout(() => {
      if (!logoutStarted.current) void localDb.meta.put({ key: preferencesKey(userId), value: JSON.stringify(preferences) });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [preferences, preferencesLoaded, userId]);

  useEffect(() => {
    if (preferencesLoaded) setLanguagePreference(preferences.language);
  }, [preferences.language, preferencesLoaded, setLanguagePreference]);

  useEffect(() => {
    if (!workspaceLoaded) return;
    setPreferences((current) => {
      const openNoteIds = activeId ? [activeId] : [];
      if (current.workspaceVersion === 1
        && current.activeNoteId === activeId
        && current.openNoteIds.length === openNoteIds.length
        && current.openNoteIds.every((id, index) => id === openNoteIds[index])) {
        return current;
      }
      return {
        ...current,
        workspaceVersion: 1,
        activeNoteId: activeId,
        openNoteIds
      };
    });
  }, [activeId, workspaceLoaded]);

  useTheme(preferences.theme);

  return { preferences, setPreferences, setPreferencesLoaded };
}
