import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenDocument } from "../../types";
import { useDocumentSaveQueue } from "./useDocumentSaveQueue";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const draft: OpenDocument = {
  objectId: "11111111-1111-4111-8111-111111111111",
  kind: "note",
  title: "Draft",
  markdown: "latest",
  parentId: null,
  tags: [],
  favorite: false,
  locked: false,
  deleted: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  manualOrder: 0,
  attachmentIds: [],
  schemaVersion: 2,
  serverRevision: 0,
  dirty: true
};

afterEach(() => {
  vi.useRealTimers();
  globalThis.document.body.replaceChildren();
});

describe("document save recovery queue", () => {
  it("keeps a failed write pending and retries it", async () => {
    vi.useFakeTimers();
    const documents = new Map([[draft.objectId, draft]]);
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error("IndexedDB unavailable"))
      .mockResolvedValue(undefined);
    let queue!: ReturnType<typeof useDocumentSaveQueue>;
    function Harness() {
      queue = useDocumentSaveQueue({
        isActive: () => true,
        getDocument: (id) => documents.get(id),
        upsertDocument: (next) => documents.set(next.objectId, next),
        persistDocument: persist,
        onPersisted: vi.fn()
      });
      return null;
    }
    const host = globalThis.document.createElement("div");
    globalThis.document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Harness />));
    act(() => queue.queue(draft));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(queue.hasPending(draft.objectId)).toBe(true);
    const blockedUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(blockedUnload);
    expect(blockedUnload.defaultPrevented).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(persist).toHaveBeenCalledTimes(2);
    expect(queue.hasPending(draft.objectId)).toBe(false);
    const allowedUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(allowedUnload);
    expect(allowedUnload.defaultPrevented).toBe(false);
    await act(async () => root.unmount());
  });
});
