import { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { OpenDocument } from "../../types";
import { TreeRowMenu, TreeLevel, type TreeDropTarget, type TreeMenuActions } from "./VaultTree";

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

function treeMenuActions(onRename: TreeMenuActions["onRename"] = vi.fn()): TreeMenuActions {
  return {
    selection: () => [note], documents: [note],
    onSelect: vi.fn(),
    onRename,
    onToggleLock: vi.fn(async () => undefined),
    onCreate: vi.fn(async () => "new-object"),
    onDuplicate: vi.fn(async () => undefined),
    onExport: vi.fn(async () => undefined),
    onPin: vi.fn(async () => undefined),
    onDelete: vi.fn(async () => undefined),
    onRestore: vi.fn(async () => undefined),
    onPurge: vi.fn(),
  };
}

function TreeFixture({ draggingIds = new Set(["note-b"]), onRenameCommit }: {
  draggingIds?: ReadonlySet<string>;
  onRenameCommit?: (id: string, value: string) => void;
}) {
  const [dropTarget, setDropTarget] = useState<TreeDropTarget | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  return <I18nProvider>
    <TreeLevel
      childrenByParent={new Map([[null, [note]]])}
      parentId={null}
      activeId={null}
      selectedIds={new Set()}
      expanded={new Set()}
      draggingIds={draggingIds}
      dropTarget={dropTarget}
      renamingDocumentId={renamingId}
      menuActions={onRenameCommit && treeMenuActions(setRenamingId)}
      onDropTarget={setDropTarget}
      onSelect={vi.fn()}
      onContext={vi.fn()}
      onDragSelection={() => [note.objectId]}
      onDragFinish={vi.fn()}
      onMove={vi.fn()}
      onRenameCommit={(id, value) => {
        onRenameCommit?.(id, value);
        setRenamingId(null);
      }}
      onRenameCancel={() => setRenamingId(null)}
    />
  </I18nProvider>;
}

function dragOver(row: HTMLElement, clientY: number, draggedId = "note-b") {
  const event = new Event("dragover", { bubbles: true, cancelable: true });
  const dataTransfer = {
    types: ["application/x-webmd-object"],
    dropEffect: "none",
    getData: (type: string) => type === "application/x-webmd-object" ? draggedId : ""
  };
  Object.defineProperties(event, {
    clientY: { value: clientY },
    dataTransfer: { value: dataTransfer }
  });
  row.dispatchEvent(event);
  return { dropEffect: dataTransfer.dropEffect, accepted: event.defaultPrevented };
}

describe("VaultTree drag feedback", () => {
  it("marks the before and after insertion edges independently of sorting", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<TreeFixture />));

    const row = container.querySelector<HTMLElement>(".tree-row");
    expect(row).not.toBeNull();
    Object.defineProperty(row, "getBoundingClientRect", {
      value: () => ({ top: 100, bottom: 140, left: 0, right: 240, width: 240, height: 40, x: 0, y: 100, toJSON: () => ({}) })
    });

    act(() => expect(dragOver(row!.querySelector("button")!, 104)).toEqual({ dropEffect: "move", accepted: true }));
    expect(row?.classList.contains("drop-before")).toBe(true);
    expect(row?.dataset.dropPosition).toBe("before");

    act(() => expect(dragOver(row!, 136)).toEqual({ dropEffect: "move", accepted: true }));
    expect(row?.classList.contains("drop-after")).toBe(true);
    expect(row?.dataset.dropPosition).toBe("after");

    await act(async () => root.render(<TreeFixture draggingIds={new Set([note.objectId])} />));
    act(() => dragOver(row!, 104, note.objectId));
    expect(row?.classList.contains("drop-before")).toBe(false);
    expect(row?.classList.contains("drop-after")).toBe(false);
    expect(row?.dataset.dropPosition).toBeUndefined();

    await act(async () => root.unmount());
  });
});

describe("VaultTree context menu", () => {
  it("hands focus to the rename input after choosing Rename from the context menu", async () => {
    const container = document.createElement("div");
    const previousFocus = document.createElement("button");
    document.body.append(previousFocus, container);
    const root = createRoot(container);
    const onRenameCommit = vi.fn();

    try {
      await act(async () => root.render(<TreeFixture onRenameCommit={onRenameCommit} />));
      previousFocus.focus();
      const row = container.querySelector<HTMLElement>(".tree-row")!;
      await act(async () => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })));
      const items = [...document.querySelectorAll<HTMLElement>('[data-slot="context-menu-item"]')];
      expect(items.map((item) => item.textContent)).not.toContain("Open");
      const rename = items.find((item) => item.textContent === "Rename")!;
      await act(async () => {
        rename.focus();
        rename.click();
      });
      await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

      expect(onRenameCommit).not.toHaveBeenCalled();
      const input = container.querySelector("input")!;
      expect(input).not.toBeNull();
      expect(document.activeElement).toBe(input);

      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Renamed note");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      expect(onRenameCommit).toHaveBeenCalledExactlyOnceWith(note.objectId, "Renamed note");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("shows an icon beside every available action", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<I18nProvider><TreeRowMenu
      document={note}
      row={(more) => <div>{more}</div>}
      onOpen={vi.fn()}
      actions={treeMenuActions()}
    /></I18nProvider>));

    await act(async () => (container.querySelector(".tree-more") as HTMLButtonElement).click());
    const actions = [...document.querySelectorAll<HTMLElement>(".context-menu [role=menuitem]")];
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((action) => action.querySelector("svg"))).toBe(true);
    expect(actions.map((action) => action.textContent)).toContain("Open");
    expect(actions.every((action) => action.textContent?.trim() !== "Move to")).toBe(true);

    await act(async () => root.unmount());
  });
});
