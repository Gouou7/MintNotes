import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, type SupportedLocale } from "../i18n";
import type { StorageStatus } from "./storage/useStorageStatus";
import { StorageUsage } from "./storageUsage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  localStorage.clear();
});

async function render(overrides: Partial<StorageStatus> = {}, language: SupportedLocale = "en") {
  const status: StorageStatus = {
    usage: { totalBytes: 10240, contentBytes: 6144, noteBytes: 4096, attachmentBytes: 2048, historyBytes: 3072, profileBytes: 1024, trashBytes: 5120,
      activeBytes: { noteBytes: 2048, attachmentBytes: 1024, historyBytes: 1024 }, quotaBytes: null, historyQuotaBytes: null, checkedAt: "2026-11-03T10:00:00Z" },
    local: { bytes: 2048, objects: 0, attachments: 0, history: 0 }, localReady: true,
    lastSync: null, unsaved: 0, estimate: null, persistence: "unsupported", failed: false,
    refreshing: false, stale: false, refresh: vi.fn(async () => {}), requestPersistence: vi.fn(async () => {}),
    ...overrides,
  };
  localStorage.setItem("webmd-notes-language", language);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<I18nProvider><StorageUsage status={status} /></I18nProvider>));
  return { container, status };
}

describe("storage usage presentation", () => {
  it("charts all contributing categories without adding trash a second time", async () => {
    const { container, status } = await render();
    expect([...container.querySelectorAll(".storage-categories dt")].map(node => node.textContent)).toEqual(["Notes", "Attachments", "Note history", "Avatar", "Trash"]);
    expect([...container.querySelectorAll(".storage-categories dd")].map(node => node.textContent)).toEqual(["2.0 KiB", "1.0 KiB", "1.0 KiB", "1.0 KiB", "5.0 KiB"]);
    expect([...container.querySelectorAll<HTMLElement>(".storage-composition > span")].map(node => node.style.width)).toEqual(["20%", "10%", "10%", "10%", "50%"]);
    expect(container.querySelector(".storage-server-footer")?.textContent).not.toContain("Trash");
    expect(container.querySelector(".storage-total")?.textContent).toContain("Quota: Unlimited");
    expect(container.querySelector("progress")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!.click());
    expect(status.refresh).toHaveBeenCalledOnce();
  });

  it("keeps empty categories readable without inventing chart segments", async () => {
    const { container } = await render({ usage: { totalBytes: 0, contentBytes: 0, noteBytes: 0, attachmentBytes: 0, historyBytes: 0, profileBytes: 0, trashBytes: 0, quotaBytes: null, historyQuotaBytes: null, checkedAt: "2026-11-03T10:00:00Z" } });
    expect(container.querySelectorAll(".storage-composition > span")).toHaveLength(0);
    expect([...container.querySelectorAll(".storage-categories dd")].map(node => node.textContent)).toEqual(["0 B", "0 B", "0 B", "0 B"]);
  });

  it("groups legacy cached data without guessing which categories contain trash", async () => {
    const { container } = await render({ usage: { totalBytes: 10240, contentBytes: 6144, noteBytes: 4096, attachmentBytes: 2048, historyBytes: 3072, profileBytes: 1024, trashBytes: 5120, quotaBytes: null, historyQuotaBytes: null, checkedAt: "2026-11-03T10:00:00Z" } });
    expect([...container.querySelectorAll(".storage-categories dt")].map(node => node.textContent)).toEqual(["Active data", "Avatar", "Trash"]);
    expect([...container.querySelectorAll<HTMLElement>(".storage-composition > span")].map(node => node.style.width)).toEqual(["40%", "10%", "50%"]);
  });

  it("shows a full trash segment when all stored data is deleted", async () => {
    const { container } = await render({ usage: { totalBytes: 4096, contentBytes: 3072, noteBytes: 2048, attachmentBytes: 1024, historyBytes: 1024, profileBytes: 0, trashBytes: 4096,
      activeBytes: { noteBytes: 0, attachmentBytes: 0, historyBytes: 0 }, quotaBytes: null, historyQuotaBytes: null, checkedAt: "2026-11-03T10:00:00Z" } });
    const segment = container.querySelector<HTMLElement>(".storage-composition > span")!;
    expect(container.querySelectorAll(".storage-composition > span")).toHaveLength(1);
    expect(segment.classList.contains("storage-tone-trash")).toBe(true);
    expect(segment.style.width).toBe("100%");
  });

  it.each(["en", "zh-CN", "zh-TW"] as const)("separates the pending save count and unit in %s", async (language) => {
    const { container } = await render({ unsaved: 2 }, language);
    expect(container.querySelector(".storage-pending > div:last-child dd")?.textContent).toBe(language === "en" ? "2 notes" : "2 篇");
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
