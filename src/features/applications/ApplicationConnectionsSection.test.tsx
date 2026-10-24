import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ApplicationConnection } from "@mint-notes/application-client";
import { api } from "../../api";
import { I18nProvider } from "../../i18n";
import { ApplicationConnectionsSection } from "./ApplicationConnectionsSection";

vi.mock("../../api", () => ({ api: vi.fn() }));
vi.mock("../../crypto/client", () => ({ cryptoClient: { createApplicationCredential: vi.fn() } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  vi.resetAllMocks();
});

it("places Add beside the heading and revokes or removes only the selected connection", async () => {
  let rows: ApplicationConnection[] = (["active", "expired", "revoked"] as const).map(status => ({
    connectionId: status, name: `${status} application`, access: "read-write", status,
    createdAt: "2026-10-01T00:00:00Z", lastUsedAt: null, idleTimeoutDays: 30,
    expiresAt: null, validUntil: null, revokedAt: status === "revoked" ? "2026-10-02T00:00:00Z" : null,
  }));
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (init?.method === "DELETE") {
      const id = path.split("/")[4];
      rows = path.endsWith("/record") ? rows.filter(row => row.connectionId !== id)
        : rows.map(row => row.connectionId === id ? { ...row, status: "revoked" } : row);
      return { ok: true } as never;
    }
    return { connections: rows } as never;
  });
  localStorage.setItem("webmd-notes-language", "zh-CN");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<I18nProvider><ApplicationConnectionsSection userId="user" online onNotify={vi.fn()} /></I18nProvider>));
  const button = (scope: Element, label: string) => [...scope.querySelectorAll("button")].find(node => node.textContent === label)!;
  expect(button(container.querySelector(".settings-section-heading")!, "添加应用")).toBeTruthy();
  expect(button(container, "刷新")).toBeUndefined();
  expect(button(container, "撤销所有应用")).toBeUndefined();
  const entries = () => [...container.querySelectorAll(".session-row")];
  expect(entries().map(row => [...row.querySelectorAll("button")].map(node => node.textContent)))
    .toEqual([["编辑", "撤销"], ["撤销"], ["移除设备"]]);
  await act(async () => button(entries()[0], "撤销").click());
  expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  await act(async () => button(container.querySelector("[role=alertdialog]")!, "撤销").click());
  expect(api).toHaveBeenCalledWith("/api/account/application-connections/active", expect.objectContaining({ method: "DELETE" }));
  expect(button(entries()[0], "移除设备")).toBeTruthy();
  await act(async () => button(entries()[2], "移除设备").click());
  expect(api).toHaveBeenCalledWith("/api/account/application-connections/revoked/record", expect.objectContaining({ method: "DELETE" }));
  expect(entries().map(row => row.querySelector("strong")?.textContent)).toHaveLength(2);
  expect(container.textContent).not.toContain("revoked application");
});
