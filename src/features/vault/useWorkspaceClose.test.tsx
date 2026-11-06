import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { translateMessage } from "../../i18n";
import { useWorkspaceClose, type WorkspaceCloseOptions } from "./useWorkspaceClose";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function closeWorkspace(discard: boolean, saveError?: Error) {
  const order: string[] = [];
  const stage = (name: string, error?: Error) => vi.fn(async () => {
    order.push(name);
    if (error) throw error;
  });
  const registerClose = vi.fn();
  const options = {
    logoutStarted: { current: false },
    importExport: { cancel: stage("cancel"), resume: vi.fn() },
    finishHistorySession: stage("history"),
    documentSaveQueue: { flushAll: stage("save", saveError), cancelAll: vi.fn() },
    objectPersistence: { drainAll: stage("drain"), pause: vi.fn() },
    showMessage: vi.fn(), t: (key, values) => translateMessage("en", key, values), stopSync: vi.fn(), registerClose
  } as WorkspaceCloseOptions;
  function Harness() { useWorkspaceClose(options); return null; }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  let result: boolean | undefined;
  try { await act(async () => { result = await registerClose.mock.calls[0][0](discard); }); }
  finally { await act(async () => root.unmount()); }
  return { options, order, result };
}

describe("workspace close", () => {
  it("drains durable edits before stopping the workspace", async () => {
    const { options, order, result } = await closeWorkspace(false);
    expect(order).toEqual(["cancel", "history", "save", "drain"]);
    expect(options.logoutStarted.current).toBe(true);
    expect(options.stopSync).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });
  it("keeps the workspace active when local persistence fails", async () => {
    const { options, result } = await closeWorkspace(false, new Error("storage full"));
    expect(options.logoutStarted.current).toBe(false);
    expect(options.importExport.resume).toHaveBeenCalledOnce();
    expect(options.stopSync).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });
  it("discards queued edits only on confirmed logout", async () => {
    const { options, order, result } = await closeWorkspace(true);
    expect(order).toEqual(["cancel", "drain"]);
    expect(options.documentSaveQueue.cancelAll).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });
});
