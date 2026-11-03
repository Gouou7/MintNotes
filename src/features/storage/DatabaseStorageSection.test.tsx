import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { I18nProvider } from "../../i18n";
import { DatabaseStorageSection } from "./DatabaseStorageSection";

vi.mock("../../api", () => ({ api: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const database = { databaseBytes: 6144, walBytes: 3072, shmBytes: 1024, backupsBytes: 20480, reusableBytes: 2048, logicalBytes: 4096,
  userCount: 1, sqliteVersion: "3.50.0", schemaVersion: 4, journalMode: "wal", checkedAt: "2026-11-03T10:00:00Z", available: true };
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  localStorage.clear();
  vi.resetAllMocks();
});
async function render() {
  localStorage.setItem("webmd-notes-language", "en");
  vi.mocked(api).mockResolvedValue(database);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<I18nProvider><DatabaseStorageSection /></I18nProvider>));
  return container;
}

describe("database storage presentation", () => {
  it("keeps backups, logical usage and reusable pages out of the file composition total", async () => {
    const container = await render();
    expect(container.querySelector(".storage-total strong")?.textContent).toBe("10 KiB");
    expect([...container.querySelectorAll<HTMLElement>(".storage-composition > span")].map(node => node.style.width)).toEqual(["60%", "30%", "10%"]);
    expect(container.querySelector(".database-supplement")?.textContent).toContain("20 KiB");
    expect(container.querySelector(".storage-details")?.textContent).toContain("2.0 KiB");
  });

  it("labels retained figures as cached and removes the success status after a failed refresh", async () => {
    const container = await render();
    vi.mocked(api).mockRejectedValueOnce(new Error("offline"));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!.click());
    expect(container.querySelector(".storage-total strong")?.textContent).toBe("10 KiB");
    expect(container.querySelector(".storage-summary")?.textContent).toContain("Cached");
    expect(container.querySelector(".storage-db-state")).toBeNull();
    expect(container.querySelector(".warning")?.textContent).toContain("Database status is unavailable");
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')?.disabled).toBe(false);
  });
});
