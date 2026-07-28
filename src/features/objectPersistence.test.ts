import { describe, expect, it } from "vitest";
import type { OpenDocument } from "../types";
import { ObjectWriteCoordinator, prepareObjectForPersistence } from "./objectPersistence";

const note: OpenDocument = {
  objectId: "note-1",
  kind: "note",
  title: "Note",
  markdown: "Body",
  parentId: null,
  tags: [],
  favorite: false,
  locked: false,
  deleted: false,
  createdAt: "2026-07-25T01:00:00.000Z",
  updatedAt: "2026-07-25T02:00:00.000Z",
  manualOrder: 0,
  attachmentIds: [],
  schemaVersion: 2,
  serverRevision: 3,
  dirty: false
};

describe("prepareObjectForPersistence", () => {
  it("updates the modification time for ordinary changes", () => {
    const next = prepareObjectForPersistence(note, 4, { now: "2026-07-26T01:00:00.000Z" });
    expect(next.updatedAt).toBe("2026-07-26T01:00:00.000Z");
    expect(next.serverRevision).toBe(4);
    expect(next.dirty).toBe(true);
  });

  it("preserves the note modification time for metadata-only changes", () => {
    const next = prepareObjectForPersistence(
      { ...note, locked: true },
      4,
      { preserveUpdatedAt: true, now: "2026-07-26T01:00:00.000Z" }
    );
    expect(next.locked).toBe(true);
    expect(next.updatedAt).toBe(note.updatedAt);
    expect(next.serverRevision).toBe(4);
    expect(next.dirty).toBe(true);
  });
});

describe("ObjectWriteCoordinator", () => {
  it("serializes writes for one object and marks only the newest request as latest", async () => {
    const coordinator = new ObjectWriteCoordinator();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = coordinator.enqueue("note-1", async () => {
      events.push("first:start");
      await firstBlocked;
      events.push("first:end");
      return "first";
    });
    const second = coordinator.enqueue("note-1", async () => {
      events.push("second:start");
      events.push("second:end");
      return "second";
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await expect(first).resolves.toEqual({ value: "first", isLatest: false });
    await expect(second).resolves.toEqual({ value: "second", isLatest: true });
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("allows different objects to write concurrently", async () => {
    const coordinator = new ObjectWriteCoordinator();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let secondStarted = false;
    const first = coordinator.enqueue("note-1", async () => {
      await blocked;
      return 1;
    });
    const second = coordinator.enqueue("note-2", async () => {
      secondStarted = true;
      return 2;
    });

    await Promise.resolve();
    expect(secondStarted).toBe(true);
    release();
    await Promise.all([first, second]);
  });

  it("drains active writes and rejects new writes while paused", async () => {
    const coordinator = new ObjectWriteCoordinator();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const write = coordinator.enqueue("note-1", async () => {
      await blocked;
      return "done";
    });
    coordinator.pause();
    await expect(coordinator.enqueue("note-2", async () => "late")).rejects.toMatchObject({ name: "AbortError" });
    const drained = coordinator.drainAll();
    release();
    await drained;
    await expect(write).resolves.toEqual({ value: "done", isLatest: true });
    coordinator.resume();
    await expect(coordinator.enqueue("note-2", async () => "resumed")).resolves.toEqual({
      value: "resumed",
      isLatest: true
    });
  });
});
