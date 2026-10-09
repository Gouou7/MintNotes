import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDocumentTheme, watchDocumentTheme } from "./theme";

let systemTheme: EventTarget & { matches: boolean };
const cleanups: (() => void)[] = [];

beforeEach(() => {
  systemTheme = Object.assign(new EventTarget(), { matches: false });
  vi.spyOn(window, "matchMedia").mockReturnValue(systemTheme as MediaQueryList);
  const favicon = document.createElement("link");
  favicon.id = "app-favicon";
  favicon.rel = "icon";
  favicon.type = "image/svg+xml";
  favicon.href = "/icon.svg";
  document.head.append(favicon);
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.querySelector("#app-favicon")?.remove();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty("color-scheme");
  vi.restoreAllMocks();
});

function expectTheme(theme: "light" | "dark") {
  expect(document.documentElement.dataset.theme).toBe(theme);
  expect(document.documentElement.style.colorScheme).toBe(theme);
  expect(document.querySelector("#app-favicon")?.getAttribute("href")).toBe("/icon.svg");
}

describe("document theme and favicon", () => {
  it("keeps the transparent SVG favicon when switching document themes", () => {
    applyDocumentTheme("dark");
    expectTheme("dark");
    applyDocumentTheme("light");
    expectTheme("light");
  });

  it("follows system changes and stops observing after cleanup", () => {
    systemTheme.matches = true;
    const stop = watchDocumentTheme("system");
    cleanups.push(stop);
    expectTheme("dark");

    systemTheme.matches = false;
    systemTheme.dispatchEvent(new Event("change"));
    expectTheme("light");

    stop();
    systemTheme.matches = true;
    systemTheme.dispatchEvent(new Event("change"));
    expectTheme("light");
  });

  it("keeps an explicit preference when the system uses the opposite theme", () => {
    systemTheme.matches = true;
    const stopSystem = watchDocumentTheme("system");
    expectTheme("dark");
    stopSystem();

    cleanups.push(watchDocumentTheme("light"));
    expectTheme("light");
    systemTheme.dispatchEvent(new Event("change"));
    expectTheme("light");

    systemTheme.matches = false;
    cleanups.push(watchDocumentTheme("dark"));
    systemTheme.dispatchEvent(new Event("change"));
    expectTheme("dark");
  });
});
