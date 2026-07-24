import type {
  HistoryListItem,
  HistorySettings,
  NoteHistoryPayload,
  OpenDocument
} from "../types";
import type { LocalHistorySnapshot } from "../storage/database";

export const DEFAULT_HISTORY_SETTINGS: HistorySettings = {
  enabled: true,
  intervalMinutes: 10,
  retentionDays: 90,
  count: 0,
  usedBytes: 0,
  quotaBytes: 256 * 1024 * 1024,
  clearedBefore: null
};

export function makeHistoryPayload(document: OpenDocument, capturedAt: string): NoteHistoryPayload {
  return {
    schemaVersion: 1,
    capturedAt,
    title: document.title,
    markdown: document.markdown,
    tags: [...document.tags],
    attachmentIds: [...new Set(document.attachmentIds)],
    sourceUpdatedAt: document.updatedAt
  };
}

export function historyContentSignature(payload: NoteHistoryPayload): string {
  return JSON.stringify({
    title: payload.title,
    markdown: payload.markdown,
    tags: payload.tags,
    attachmentIds: [...payload.attachmentIds].sort()
  });
}

export function historyContentChanged(before: OpenDocument, after: OpenDocument): boolean {
  return before.title !== after.title
    || before.markdown !== after.markdown
    || before.tags.join("\u0000") !== after.tags.join("\u0000")
    || [...before.attachmentIds].sort().join("\u0000") !== [...after.attachmentIds].sort().join("\u0000");
}

export function shouldCaptureHistoryBaseline(lastCapturedAt: number | undefined, now: number, intervalMinutes: number): boolean {
  return now - (lastCapturedAt ?? 0) >= intervalMinutes * 60_000;
}

export function localHistoryListItem(snapshot: LocalHistorySnapshot): HistoryListItem {
  return {
    historyId: snapshot.historyId,
    noteId: snapshot.noteId,
    capturedAt: snapshot.capturedAt,
    captureKind: snapshot.captureKind,
    byteSize: snapshot.byteSize,
    pending: snapshot.pending,
    serverCreatedAt: snapshot.serverCreatedAt
  };
}

export function mergeHistoryItems(...collections: HistoryListItem[][]): HistoryListItem[] {
  const merged = new Map<string, HistoryListItem>();
  for (const collection of collections) {
    for (const item of collection) {
      const current = merged.get(item.historyId);
      merged.set(item.historyId, current?.pending && !item.pending ? item : current ?? item);
    }
  }
  return [...merged.values()].sort((left, right) => (
    right.capturedAt.localeCompare(left.capturedAt) || right.historyId.localeCompare(left.historyId)
  ));
}

export function formatHistoryBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
