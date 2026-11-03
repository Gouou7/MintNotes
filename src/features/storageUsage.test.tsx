import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { StorageStatus } from "./storage/useStorageStatus";
import { StorageUsage } from "./storageUsage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  localStorage.clear();
});

async function render(overrides: Partial<StorageStatus> = {}) {
  const status: StorageStatus = {
    usage: { totalBytes: 10240, contentBytes: 6144, noteBytes: 4096, attachmentBytes: 2048, historyBytes: 3072, profileBytes: 1024, trashBytes: 5120, quotaBytes: null, historyQuotaBytes: null, checkedAt: "2026-11-03T10:00:00Z" },
    local: { bytes: 2048, objects: 0, attachments: 0, history: 0 }, localReady: true,
    lastSync: null, unsaved: 0, estimate: null, persistence: "unsupported", failed: false,
    refreshing: false, stale: false, refresh: vi.fn(async () => {}), requestPersistence: vi.fn(async () => {}),
    ...overrides,
  };
  localStorage.setItem("webmd-notes-language", "en");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<I18nProvider><StorageUsage status={status} /></I18nProvider>));
  return { container, status };
}

describe("storage usage presentation", () => {
  it("charts all contributing categories without adding trash a second time", async () => {
    const { container, status } = await render();
    expect([...container.querySelectorAll(".storage-categories dt")].map(node => node.textContent)).toEqual(["Notes", "Attachments", "Note history", "Avatar"]);
    expect([...container.querySelectorAll<HTMLElement>(".storage-composition > span")].map(node => node.style.width)).toEqual(["40%", "20%", "30%", "10%"]);
    expect(container.querySelector(".storage-trash-note")?.textContent).toContain("Trash uses 5.0 KiB, included above.");
    expect(container.querySelector(".storage-total")?.textContent).toContain("Quota: Unlimited");
    expect(container.querySelector("progress")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!.click());
    expect(status.refresh).toHaveBeenCalledOnce();
  });

  it("keeps empty categories readable without inventing chart segments", async () => {
    const { container } = await render({ usage: { totalBytes: 0, contentBytes: 0, noteBytes: 0, attachmentBytes: 0, historyBytes: 0, profileBytes: 0, trashBytes: 0, quotaBytes: null, historyQuotaBytes: null, checkedAt: "2026-11-03T10:00:00Z" } });
    expect(container.querySelectorAll(".storage-composition > span")).toHaveLength(0);
    expect([...container.querySelectorAll(".storage-categories dd")].map(node => node.textContent)).toEqual(["0 B", "0 B", "0 B"]);
  });

  it("retains cached timestamps and quota warnings when usage exceeds a finite quota", async () => {
    const { container } = await render({ stale: true, usage: { totalBytes: 2048, contentBytes: 2048, noteBytes: 2048, attachmentBytes: 0, historyBytes: 0, profileBytes: 0, trashBytes: 0, quotaBytes: 1024, historyQuotaBytes: null, checkedAt: "2026-11-03T10:00:00Z" } });
    expect(container.querySelector(".storage-total strong")?.textContent).toBe("2.0 KiB");
    expect(container.querySelector<HTMLProgressElement>("progress")?.value).toBe(1024);
    expect(container.querySelector(".storage-capacity.full")?.textContent).toContain("Quota reached");
    expect(container.querySelector(".storage-summary")?.textContent).toContain("Cached");
  });

  it("does not show zero local usage or pending counts before local data is ready", async () => {
    const { container } = await render({ localReady: false, usage: null, failed: true });
    expect(container.querySelector(".storage-local dd")?.textContent).toBe("Unknown");
    expect(container.querySelector(".storage-pending-counts")).toBeNull();
    expect(container.querySelector(".storage-server")?.textContent).toContain("Connect to the server");
    expect(container.querySelector(".storage-composition")).toBeNull();
  });
});
