import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDocumentTheme, watchDocumentTheme } from "./theme";

const html = readFileSync(resolve("index.html"), "utf8");
const styles = readFileSync(resolve("src/styles.css"), "utf8");
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
  const style = document.createElement("style");
  style.id = "theme-test-styles";
  // happy-dom mis-matches :root[data-theme] and cannot resolve color-mix().
  style.textContent = styles.replaceAll(":root", "html")
    .replace("color-mix(in srgb, #000000 30%, var(--sidebar))", "#151515");
  document.head.append(style);
  const shell = new DOMParser().parseFromString(html, "text/html");
  for (const meta of shell.querySelectorAll('meta[name="theme-color"]')) {
    document.head.append(document.importNode(meta, true));
  }
  document.body.append(document.importNode(shell.querySelector(".pwa-status-surface")!, true));
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.querySelector("#app-favicon")?.remove();
  document.querySelector("#theme-test-styles")?.remove();
  document.querySelector(".pwa-status-surface")?.remove();
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.remove();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty("color-scheme");
  document.documentElement.style.removeProperty("--chrome-background");
  vi.restoreAllMocks();
});

function expectTheme(theme: "light" | "dark") {
  expect(document.documentElement.dataset.theme).toBe(theme);
  expect(document.documentElement.style.colorScheme).toBe(theme);
  expect(document.querySelector("#app-favicon")?.getAttribute("href")).toBe("/icon.svg");
  const themeColors = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  expect(themeColors).toHaveLength(2);
  for (const meta of themeColors) {
    expect(meta.content).toBe(theme === "light" ? "#e8e9e9" : "#151515");
  }
}

describe("document theme, PWA colors and favicon", () => {
  it("keeps the transparent SVG favicon when switching document themes", () => {
    applyDocumentTheme("dark");
    expectTheme("dark");
    applyDocumentTheme("light");
    expectTheme("light");
  });

  it("reads the sidebar header color from CSS instead of a fixed palette", () => {
    document.documentElement.style.setProperty("--chrome-background", "#f0f1f2");
    applyDocumentTheme("dark");

    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      expect(meta.content).toBe("#f0f1f2");
    }
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
