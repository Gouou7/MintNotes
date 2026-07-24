import { StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TreeRenameInput } from "./TreeRenameInput";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe("TreeRenameInput", () => {
  it("keeps the complete generated name selected in strict mode", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const onCommit = vi.fn();

    await act(async () => root.render(
      <StrictMode>
        <TreeRenameInput initialValue="New folder 2" label="Rename" onCommit={onCommit} onCancel={vi.fn()} />
      </StrictMode>
    ));

    const input = container.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits on Enter and cancels on Escape", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    await act(async () => root.render(<TreeRenameInput initialValue="New folder" label="Rename" onCommit={onCommit} onCancel={onCancel} />));
    const input = container.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Projects");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledWith("Projects");

    onCommit.mockClear();
    await act(async () => root.render(<TreeRenameInput key="cancel" initialValue="New folder" label="Rename" onCommit={onCommit} onCancel={onCancel} />));
    const cancelInput = container.querySelector("input")!;
    await act(async () => cancelInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
