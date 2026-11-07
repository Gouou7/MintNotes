import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { Confirmation, useConfirmation } from "./Confirmation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const options = { title: "Delete note", message: "Permanently delete this note?", action: "Delete", destructive: true };

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function mount() {
  let controller!: ReturnType<typeof useConfirmation>;
  function Harness() {
    controller = useConfirmation();
    return <Confirmation current={controller.current} />;
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<I18nProvider><Harness /></I18nProvider>));
  return controller;
}

it("rejects a duplicate, resolves cancellation and allows an explicit subsequent confirmation", async () => {
  const { request } = await mount();
  let pending!: Promise<boolean>;
  await act(async () => { pending = request(options); });
  await expect(request(options)).resolves.toBe(false);
  const dialog = document.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain(options.message);
  await act(async () => dialog.querySelector("button")!.click());
  await expect(pending).resolves.toBe(false);

  await act(async () => { pending = request(options); });
  await act(async () => document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')[1].click());
  await expect(pending).resolves.toBe(true);
});

it("cancels when the operation is aborted or the workspace unmounts", async () => {
  const { request } = await mount();
  const signal = new AbortController();
  let pending!: Promise<boolean>;
  await act(async () => { pending = request(options, signal.signal); });
  await act(async () => signal.abort());
  await expect(pending).resolves.toBe(false);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();

  await act(async () => { pending = request(options); });
  await act(async () => root!.unmount());
  root = undefined;
  await expect(pending).resolves.toBe(false);
});
