import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ToastStack } from "../../components/Toast";
import { I18nProvider } from "../../i18n";
import { useToastNotifications } from "./useToastNotifications";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined;
  vi.useRealTimers(); document.body.replaceChildren();
});

async function setup() {
  let controller!: ReturnType<typeof useToastNotifications>;
  function Harness() {
    controller = useToastNotifications();
    return <ToastStack notices={controller.notices} onDismiss={controller.dismissMessage} />;
  }
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<I18nProvider><Harness /></I18nProvider>));
  return { get controller() { return controller; } };
}

it("keeps notices in arrival order and dismisses only the requested notice", async () => {
  const state = await setup();
  await act(async () => {
    state.controller.showMessage("Save failed", "critical");
    state.controller.showMessage("Saved another note", "info");
    state.controller.showMessage("Check your connection", "warning");
  });
  expect([...document.querySelectorAll(".toast-notice p")].map(element => element.textContent)).toEqual(["Save failed", "Saved another note", "Check your connection"]);
  const middle = state.controller.notices[1].id;
  await act(async () => (document.querySelectorAll(".toast-close")[1] as HTMLButtonElement).click());
  expect(state.controller.notices.map(notice => notice.text)).toEqual(["Save failed", "Check your connection"]);
  await act(async () => state.controller.dismissMessage(middle));
  expect(state.controller.notices).toHaveLength(2);
});

it("expires routine notices independently and retains critical feedback", async () => {
  vi.useFakeTimers(); const state = await setup();
  await act(async () => {
    state.controller.showMessage("Saved", "info");
    state.controller.showMessage("Offline", "warning");
    state.controller.showMessage("Save failed", "critical");
  });
  await act(async () => vi.advanceTimersByTime(4000));
  expect(state.controller.notices.map(notice => notice.tone)).toEqual(["warning", "critical"]);
  await act(async () => vi.advanceTimersByTime(3000));
  expect(state.controller.notices.map(notice => notice.tone)).toEqual(["critical"]);
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Save failed");
});

it("refreshes repeated feedback without allowing an old dismissal to remove it", async () => {
  vi.useFakeTimers(); const state = await setup(); let previous = 0;
  await act(async () => state.controller.showMessage("Saved", "info"));
  previous = state.controller.notices[0].id;
  await act(async () => vi.advanceTimersByTime(3500));
  await act(async () => state.controller.showMessage("Saved", "info"));
  expect(state.controller.notices).toHaveLength(1);
  expect(state.controller.notices[0].id).not.toBe(previous);
  await act(async () => state.controller.dismissMessage(previous));
  await act(async () => vi.advanceTimersByTime(3500));
  expect(state.controller.notices).toHaveLength(1);
  await act(async () => vi.advanceTimersByTime(500));
  expect(state.controller.notices).toHaveLength(0);
  expect(document.querySelector(".toast-stack")).toBeNull();
});

it("dismisses only the notice whose asynchronous action succeeds", async () => {
  const state = await setup(); let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await act(async () => state.controller.showMessage("Integrity warning", "critical", { label: "Ignore", run: () => pending }));
  const completion = state.controller.notices[0].action!.run();
  await act(async () => state.controller.showMessage("Another warning", "critical"));
  await act(async () => { finish(); await completion; });
  expect(state.controller.notices.map(notice => notice.text)).toEqual(["Another warning"]);
  await act(async () => state.controller.showMessage("Try again", "critical", { label: "Retry", run: async () => { throw new Error("Still offline"); } }));
  await expect(state.controller.notices[1].action!.run()).rejects.toThrow("Still offline");
  expect(state.controller.notices).toHaveLength(2);
});

it("clears notification timers when the workspace unmounts", async () => {
  vi.useFakeTimers(); const state = await setup();
  await act(async () => { state.controller.showMessage("Saved", "info"); state.controller.showMessage("Offline", "warning"); });
  expect(vi.getTimerCount()).toBe(2);
  await act(async () => root!.unmount()); root = undefined;
  expect(vi.getTimerCount()).toBe(0);
});
