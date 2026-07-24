import { describe, expect, it } from "vitest";
import type { OpenDocument } from "../types";
import {
  historyContentChanged,
  historyContentSignature,
  makeHistoryPayload,
  mergeHistoryItems,
  shouldCaptureHistoryBaseline
} from "./history";

const note: OpenDocument = {
  objectId: "note-a",
  kind: "note",
  title: "Title",
  markdown: "# Body",
  parentId: null,
  tags: ["one"],
  favorite: false,
  deleted: false,
  createdAt: "2026-07-24T00:00:00.000Z",
  updatedAt: "2026-07-24T01:00:00.000Z",
  manualOrder: 0,
  attachmentIds: ["b", "a"],
  schemaVersion: 2,
  serverRevision: 1,
  dirty: false
};

describe("note history policy", () => {
  it("captures only content fields and deduplicates attachment order", () => {
    expect(historyContentChanged(note, { ...note, favorite: true })).toBe(false);
    expect(historyContentChanged(note, { ...note, markdown: "# Changed" })).toBe(true);
    const first = makeHistoryPayload(note, "2026-07-24T02:00:00.000Z");
    const second = makeHistoryPayload({ ...note, attachmentIds: ["a", "b"] }, "2026-07-24T03:00:00.000Z");
    expect(historyContentSignature(first)).toBe(historyContentSignature(second));
  });

  it("starts a baseline only after the configured interval", () => {
    const now = Date.parse("2026-07-24T12:00:00.000Z");
    expect(shouldCaptureHistoryBaseline(undefined, now, 10)).toBe(true);
    expect(shouldCaptureHistoryBaseline(now - 9 * 60_000, now, 10)).toBe(false);
    expect(shouldCaptureHistoryBaseline(now - 10 * 60_000, now, 10)).toBe(true);
  });

  it("merges pending and server history without duplicates", () => {
    const pending = {
      historyId: "history-a",
      noteId: "note-a",
      capturedAt: "2026-07-24T10:00:00.000Z",
      captureKind: "manual" as const,
      byteSize: 10,
      pending: true
    };
    expect(mergeHistoryItems([pending], [{ ...pending, pending: false }])).toEqual([{ ...pending, pending: false }]);
  });
});
