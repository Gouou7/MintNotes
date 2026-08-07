import { describe, expect, it } from "vitest";
import type { OpenDocument } from "../types";
import {
  canDeleteHistory,
  historyContentChanged,
  historyContentSignature,
  manualHistorySnapshotOptions,
  makeHistoryPayload,
  mergeHistoryItems,
  normalizeHistoryName,
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
  locked: false,
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
    expect(historyContentChanged(note, { ...note, locked: true })).toBe(false);
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

  it("forces manual snapshots with a local time name and protection", () => {
    const now = new Date("2026-08-08T12:34:56.000Z");
    expect(manualHistorySnapshotOptions(now, () => "2026/8/8 20:34")).toEqual({
      force: true,
      name: "2026/8/8 20:34",
      protected: true
    });
  });

  it("trims history names and rejects blank names", () => {
    expect(normalizeHistoryName("  Release  ")).toBe("Release");
    expect(normalizeHistoryName("   ")).toBeNull();
  });

  it("allows deletion only after history protection is removed", () => {
    expect(canDeleteHistory({ protected: true })).toBe(false);
    expect(canDeleteHistory({ protected: false })).toBe(true);
  });

  it("merges history without duplicates and keeps the latest collection", () => {
    const pending = {
      historyId: "history-a",
      noteId: "note-a",
      capturedAt: "2026-07-24T10:00:00.000Z",
      captureKind: "manual" as const,
      name: "Manual version",
      protected: true,
      byteSize: 10,
      pending: true
    };
    expect(mergeHistoryItems([{ ...pending, pending: false }], [pending])).toEqual([pending]);
  });
});
