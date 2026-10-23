import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { api } from "../../api";
import { localDb } from "../../storage/database";
import { useStorageStatus, type StorageStatus } from "./useStorageStatus";
vi.mock("../../api", () => ({ api: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.restoreAllMocks(); Object.defineProperty(navigator, "storage", { configurable: true, value: undefined }); vi.mocked(api).mockReset(); document.body.replaceChildren(); await Promise.all(localDb.tables.map((table) => table.clear())); });
async function mount(online: boolean) {
  let value!: StorageStatus;
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  function Harness() { value = useStorageStatus({ userId: "user", endpointId: "device", online, enabled: true, getUnsavedCount: () => 2, notify: vi.fn() }); return null; }
  await act(async () => root!.render(<I18nProvider><Harness /></I18nProvider>));
  return () => value;
}
describe("storage status controller", () => {
  it("works without browser storage APIs and uses cached usage when offline", async () => {
    Object.defineProperty(navigator, "storage", { configurable: true, value: undefined });
    await localDb.meta.put({ key: "storage-status:user:server", value: JSON.stringify({ totalBytes: 42, quotaBytes: 100, checkedAt: "2026-10-23T00:00:00Z" }) });
    const current = await mount(false);
    await vi.waitFor(async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); expect(current().usage?.totalBytes).toBe(42); });
    expect(current().stale).toBe(true); expect(current().persistence).toBe("unsupported"); expect(current().unsaved).toBe(2); expect(api).not.toHaveBeenCalled();
  });
  it("reports persistence denial and grant without affecting local saves", async () => {
    const persist = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    Object.defineProperty(navigator, "storage", { configurable: true, value: { estimate: async () => ({ usage: 20, quota: 100 }), persisted: async () => false, persist } });
    const current = await mount(false);
    await act(async () => { await vi.waitFor(() => expect(current().persistence).toBe("best-effort")); });
    await act(async () => current().requestPersistence()); expect(current().persistence).toBe("denied");
    await act(async () => current().requestPersistence()); expect(current().persistence).toBe("granted");
    expect(current().estimate).toEqual({ usage: 20, quota: 100 });
  });
});
