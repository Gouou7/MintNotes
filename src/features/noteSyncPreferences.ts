import type { NoteDownloadMode } from "../types";

export const DEFAULT_NOTE_DOWNLOAD_MODE = "on-demand" satisfies NoteDownloadMode;

export function normalizeNoteDownloadMode(value: unknown): NoteDownloadMode {
  return value === "recent" || value === "all" ? value : DEFAULT_NOTE_DOWNLOAD_MODE;
}
