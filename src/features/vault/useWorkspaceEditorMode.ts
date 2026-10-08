import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import type { OpenDocument, UiPreferences, WorkspaceEditorMode } from "../../types";
import { effectiveEditorMode, isLockedNote } from "../noteLock";
import { useDocumentNavigation } from "./useDocumentNavigation";

interface Options {
  preferences: UiPreferences;
  document: OpenDocument | null;
  previewing: boolean;
  onPreferences: Dispatch<SetStateAction<UiPreferences>>;
}

/** Source visibility and editing permission are independent device preferences. */
export function useWorkspaceEditorMode(options: Options) {
  const sourceMode = options.preferences.editorMode === "source";
  const readOnlyMode = options.preferences.editorReadOnly;
  const locked = isLockedNote(options.document);
  const readOnly = readOnlyMode || locked;
  const mode: WorkspaceEditorMode = sourceMode ? "source" : readOnlyMode ? "reading" : "live";
  const effectiveMode = effectiveEditorMode(mode, options.document);
  const navigation = useDocumentNavigation(effectiveMode);
  const current = useRef({ ...options, sourceMode, readOnlyMode, readOnly, effectiveMode, navigation });
  current.current = { ...options, sourceMode, readOnlyMode, readOnly, effectiveMode, navigation };

  const setSourceMode = useCallback((source: boolean) => {
    const state = current.current;
    if (!state.document || state.previewing || source === state.sourceMode) return;
    state.navigation.prepareModeChange(source ? "source" : state.readOnly ? "reading" : "live");
    state.onPreferences(preferences => ({ ...preferences, editorMode: source ? "source" : preferences.editorReadOnly ? "reading" : "live" }));
  }, []);
  const toggleSource = useCallback(() => setSourceMode(!current.current.sourceMode), [setSourceMode]);
  const toggleReadOnly = useCallback(() => {
    const state = current.current;
    if (!state.document || state.previewing || isLockedNote(state.document)) return;
    const nextReadOnly = !state.readOnlyMode;
    state.navigation.prepareModeChange(state.sourceMode ? "source" : nextReadOnly ? "reading" : "live");
    state.onPreferences(preferences => ({ ...preferences, editorReadOnly: nextReadOnly, editorMode: state.sourceMode ? "source" : nextReadOnly ? "reading" : "live" }));
  }, []);
  const onModeChange = useCallback((next: WorkspaceEditorMode) => {
    // Prop-driven engine notifications must not change the user's device switches.
    if (next !== current.current.effectiveMode) setSourceMode(next === "source");
  }, [setSourceMode]);

  return { sourceMode, readOnlyMode, readOnly, effectiveMode, navigation, toggleSource, toggleReadOnly, onModeChange };
}
