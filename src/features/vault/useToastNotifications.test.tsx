import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToastStack } from "../../components/Toast";
import { I18nProvider } from "../../i18n";
import { useToastNotifications } from "./useToastNotifications";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "Date"] });
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined;
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers(); document.body.replaceChildren();
});

async function setup() {
  let controller!: ReturnType<typeof useToastNotifications>;
  function Harness({ visible }: { visible: boolean }) {
    controller = useToastNotifications(visible);
    return null;
  }
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const render = (visible: boolean) => act(async () => root!.render(<I18nProvider><ToastStack /><Harness visible={visible} /></I18nProvider>));
  await render(true);
  return { controller, render };
}

const activeToast = '[data-sonner-toast]:not([data-removed="true"], :has([data-toast-cleared]))';
const notices = () => [...document.querySelectorAll(activeToast + " [data-title]")].map(element => element.textContent);
const advance = (ms = 50) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

it("stacks the newest notification first and closes only the requested one", async () => {
  const { controller } = await setup();
  controller.showMessage("Save failed", "critical");
  controller.showMessage("Saved another note", "info");
  controller.showMessage("Check your connection", "warning");
  await advance();
  expect(notices()).toEqual(["Check your connection", "Saved another note", "Save failed"]);
  await act(async () => document.querySelectorAll<HTMLButtonElement>(activeToast + " [data-cancel]")[1].click());
  expect(notices()).toEqual(["Check your connection", "Save failed"]);
});

it("expires routine notices independently and retains critical feedback", async () => {
  const { controller } = await setup();
  controller.showMessage("Saved", "info");
  controller.showMessage("Offline", "warning");
  controller.showMessage("Save failed", "critical");
  await advance();
  await advance(4000);
  expect(notices()).toEqual(["Save failed", "Offline"]);
  await advance(3000);
  expect(notices()).toEqual(["Save failed"]);
  await advance(60_000);
  expect(notices()).toEqual(["Save failed"]);
});

it("refreshes repeated feedback with a new timeout", async () => {
  const { controller } = await setup();
  controller.showMessage("Saved", "info");
  await advance(3500);
  await act(async () => controller.showMessage("Saved", "info"));
  await advance();
  expect(notices()).toEqual(["Saved"]);
  await advance(3500);
  expect(notices()).toEqual(["Saved"]);
  await advance(500);
  expect(notices()).toEqual([]);
});

it("closes only the notice whose asynchronous action succeeds", async () => {
  const { controller } = await setup();
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  controller.showMessage("Integrity warning", "critical", { label: "Ignore", run: () => pending });
  await advance();
  await act(async () => document.querySelector<HTMLButtonElement>(activeToast + " [data-action]")!.click());
  controller.showMessage("Another warning", "critical");
  await advance();
  expect(notices()).toEqual(["Another warning", "Integrity warning"]);
  await act(async () => { finish(); await pending; });
  await advance();
  expect(notices()).toEqual(["Another warning"]);
  controller.showMessage("Try again", "critical", { label: "Retry", run: async () => { throw new Error("Still offline"); } });
  await advance();
  await act(async () => document.querySelector<HTMLButtonElement>(activeToast + " [data-action]")!.click());
  expect(notices()).toEqual(["Try again", "Another warning"]);
});

it("releases private messages and actions when their workspace is hidden", async () => {
  const { controller, render } = await setup();
  const run = vi.fn();
  controller.showMessage("Private note", "critical", { label: "Private action", run });
  await advance();
  const saved = toast.getHistory().at(-1);
  if (!saved || !("title" in saved) || !saved.title || typeof saved.title === "function") throw new Error("Missing notice");
  const action = saved.action;
  if (!action || typeof action !== "object" || !("onClick" in action)) throw new Error("Missing action");
  expect(renderToStaticMarkup(saved.title)).toContain("Private note");
  await render(false);
  expect(notices()).toEqual([]);
  expect(renderToStaticMarkup(saved.title)).not.toContain("Private note");
  expect(renderToStaticMarkup(action.label)).not.toContain("Private action");
  action.onClick(new MouseEvent("click", { cancelable: true }) as unknown as Parameters<typeof action.onClick>[0]);
  controller.showMessage("Hidden workspace", "critical");
  await advance();
  expect(run).not.toHaveBeenCalled();
  expect(notices()).toEqual([]);
});
