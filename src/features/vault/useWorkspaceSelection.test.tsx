import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceSelection } from "./useWorkspaceSelection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("workspace selection", () => {
  let root: Root;
  let selection: ReturnType<typeof useWorkspaceSelection>;
  let renders: { activeId: string | null; selectedIds: string[] }[];

  beforeEach(async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    renders = [];
    function Harness() {
      selection = useWorkspaceSelection();
      renders.push({ activeId: selection.activeId, selectedIds: [...selection.selectedIds] });
      return null;
    }
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("updates the current note, sidebar selection and range anchor together for every activation", () => {
    for (const id of ["restored-note", "linked-note", "new-note", "conflict-copy", "history-copy"]) {
      act(() => {
        selection.activateDocument(id);
        expect(selection.activeIdRef.current).toBe(id);
      });
      expect(selection.activeId).toBe(id);
      expect(selection.selectedIds).toEqual(new Set([id]));
      expect(selection.selectionAnchor.current).toBe(id);
    }
    expect(renders.filter(({ activeId }) => activeId !== null).every(
      ({ activeId, selectedIds }) => selectedIds.length === 1 && selectedIds[0] === activeId
    )).toBe(true);
  });

  it("replaces an existing multiple selection when opening another note", () => {
    act(() => selection.activateDocument("first"));
    act(() => {
      selection.setSelectedIds(new Set(["first", "second"]));
      selection.selectionAnchor.current = "second";
    });

    act(() => selection.activateDocument("third"));

    expect(selection.selectedIds).toEqual(new Set(["third"]));
    expect(selection.selectionAnchor.current).toBe("third");
  });

  it("selects the open note again even when its id has not changed", () => {
    act(() => selection.activateDocument("current"));
    act(() => {
      selection.setSelectedIds(new Set(["folder"]));
      selection.selectionAnchor.current = "folder";
    });

    act(() => selection.activateDocument("current"));

    expect(selection.selectedIds).toEqual(new Set(["current"]));
    expect(selection.selectionAnchor.current).toBe("current");
  });

  it("keeps explicit tree selections independent until another note is activated", () => {
    act(() => selection.activateDocument("current"));
    act(() => selection.setSelectedIds((current) => new Set([...current, "other"])));
    expect(selection.selectedIds).toEqual(new Set(["current", "other"]));
    expect(selection.activeId).toBe("current");

    act(() => selection.setSelectedIds(new Set()));
    expect(selection.selectedIds.size).toBe(0);
    expect(selection.activeIdRef.current).toBe("current");
  });

  it("clears the current note and selection together when closing the note", () => {
    act(() => selection.activateDocument("current"));
    act(() => selection.activateDocument(null));

    expect(selection.activeId).toBeNull();
    expect(selection.activeIdRef.current).toBeNull();
    expect(selection.selectedIds.size).toBe(0);
    expect(selection.selectionAnchor.current).toBeNull();
  });
});
