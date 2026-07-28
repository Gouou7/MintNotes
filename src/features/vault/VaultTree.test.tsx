import { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { OpenDocument } from "../../types";
import { TreeLevel, type TreeDropTarget } from "./VaultTree";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note: OpenDocument = {
  objectId: "note-a",
  kind: "note",
  title: "Note A",
  markdown: "",
  parentId: null,
  tags: [],
  favorite: false,
  locked: false,
  deleted: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  manualOrder: 1024,
  attachmentIds: [],
  schemaVersion: 2,
  serverRevision: 0,
  dirty: false
};

afterEach(() => {
  document.body.replaceChildren();
});

function ManualTree({ draggingIds = new Set(["note-b"]) }: { draggingIds?: ReadonlySet<string> }) {
  const [dropTarget, setDropTarget] = useState<TreeDropTarget | null>(null);
  return <I18nProvider>
    <TreeLevel
      childrenByParent={new Map([[null, [note]]])}
      parentId={null}
      activeId={null}
      selectedIds={new Set()}
      expanded={new Set()}
      manualSorting
      draggingIds={draggingIds}
      dropTarget={dropTarget}
      renamingDocumentId={null}
      onDropTarget={setDropTarget}
      onSelect={vi.fn()}
      onContext={vi.fn()}
      onDragSelection={() => [note.objectId]}
      onDragFinish={vi.fn()}
      onMove={vi.fn()}
      onRenameCommit={vi.fn()}
      onRenameCancel={vi.fn()}
    />
  </I18nProvider>;
}

function dragOver(row: HTMLElement, clientY: number, draggedId = "note-b") {
  const event = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientY: { value: clientY },
    dataTransfer: {
      value: {
        types: ["application/x-webmd-object"],
        getData: (type: string) => type === "application/x-webmd-object" ? draggedId : ""
      }
    }
  });
  row.dispatchEvent(event);
}

describe("VaultTree manual drag feedback", () => {
  it("marks the exact before and after insertion edges", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<ManualTree />));

    const row = container.querySelector<HTMLElement>(".tree-row");
    expect(row).not.toBeNull();
    Object.defineProperty(row, "getBoundingClientRect", {
      value: () => ({ top: 100, bottom: 140, left: 0, right: 240, width: 240, height: 40, x: 0, y: 100, toJSON: () => ({}) })
    });

    act(() => dragOver(row!, 104));
    expect(row?.classList.contains("drop-before")).toBe(true);
    expect(row?.dataset.dropPosition).toBe("before");

    act(() => dragOver(row!, 136));
    expect(row?.classList.contains("drop-after")).toBe(true);
    expect(row?.dataset.dropPosition).toBe("after");

    await act(async () => root.render(<ManualTree draggingIds={new Set([note.objectId])} />));
    act(() => dragOver(row!, 104, note.objectId));
    expect(row?.classList.contains("drop-before")).toBe(false);
    expect(row?.classList.contains("drop-after")).toBe(false);
    expect(row?.dataset.dropPosition).toBeUndefined();

    await act(async () => root.unmount());
  });
});
