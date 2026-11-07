import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ToastStack } from "../../components/Toast";
import { ToastProvider } from "../../components/ui/toast";
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
    return <ToastStack />;
  }
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<I18nProvider><ToastProvider limit={Infinity}><Harness /></ToastProvider></I18nProvider>));
  return { get controller() { return controller; } };
}

const notices = () => [...document.querySelectorAll(".toast-notice:not([data-ending-style]) p")].map((element) => element.textContent);

it("keeps notices in arrival order and dismisses only the requested notice", async () => {
  const { controller } = await setup();
  await act(async () => {
    controller.showMessage("Save failed", "critical");
    controller.showMessage("Saved another note", "info");
    controller.showMessage("Check your connection", "warning");
  });
  expect(notices()).toEqual(["Save failed", "Saved another note", "Check your connection"]);
  await act(async () => (document.querySelectorAll(".toast-close")[1] as HTMLButtonElement).click());
  expect(notices()).toEqual(["Save failed", "Check your connection"]);
});

it("expires routine notices independently and retains critical feedback", async () => {
  vi.useFakeTimers();
  const { controller } = await setup();
  await act(async () => {
    controller.showMessage("Saved", "info");
    controller.showMessage("Offline", "warning");
    controller.showMessage("Save failed", "critical");
  });
  await act(async () => vi.advanceTimersByTime(4000));
  expect(notices()).toEqual(["Offline", "Save failed"]);
  await act(async () => vi.advanceTimersByTime(3000));
  expect(notices()).toEqual(["Save failed"]);
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(notices()).toEqual(["Save failed"]);
});

it("refreshes repeated feedback in place without letting the previous timer close it", async () => {
  vi.useFakeTimers();
  const { controller } = await setup();
  await act(async () => controller.showMessage("Saved", "info"));
  await act(async () => vi.advanceTimersByTime(3500));
  await act(async () => controller.showMessage("Saved", "info"));
  expect(notices()).toEqual(["Saved"]);
  await act(async () => vi.advanceTimersByTime(3500));
  expect(notices()).toEqual(["Saved"]);
  await act(async () => vi.advanceTimersByTime(500));
  expect(notices()).toEqual([]);
  expect(document.querySelector(".toast-stack")).toBeNull();
});

it("dismisses only the notice whose asynchronous action succeeds", async () => {
  const { controller } = await setup();
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await act(async () => controller.showMessage("Integrity warning", "critical", { label: "Ignore", run: () => pending }));
  await act(async () => document.querySelector<HTMLButtonElement>(".toast-action")!.click());
  await act(async () => controller.showMessage("Another warning", "critical"));
  await act(async () => { finish(); await pending; });
  expect(notices()).toEqual(["Another warning"]);
  await act(async () => controller.showMessage("Try again", "critical", { label: "Retry", run: async () => { throw new Error("Still offline"); } }));
  await act(async () => document.querySelector<HTMLButtonElement>(".toast-notice:not([data-ending-style]) .toast-action")!.click());
  expect(notices()).toEqual(["Another warning", "Try again"]);
});

it("clears notification timers when the workspace unmounts", async () => {
  vi.useFakeTimers();
  const { controller } = await setup();
  await act(async () => { controller.showMessage("Saved", "info"); controller.showMessage("Offline", "warning"); });
  await act(async () => root!.unmount()); root = undefined;
  expect(vi.getTimerCount()).toBe(0);
});
