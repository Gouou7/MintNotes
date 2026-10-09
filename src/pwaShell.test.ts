import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve("index.html"), "utf8");
const styles = readFileSync(resolve("src/styles.css"), "utf8");

describe("installed PWA shell", () => {
  it("uses the transparent vector logo for browser tabs", () => {
    const document = new DOMParser().parseFromString(html, "text/html");
    const favicon = document.querySelector("#app-favicon");
    expect(favicon?.getAttribute("href")).toBe("/icon.svg");
    expect(favicon?.getAttribute("type")).toBe("image/svg+xml");
    expect(favicon?.getAttribute("sizes")).toBe("any");
  });

  it("requests a non-translucent iOS status bar while retaining device safe areas", () => {
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.querySelector('meta[name="viewport"]')?.getAttribute("content")).toContain("viewport-fit=cover");
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute("content")).toContain("interactive-widget=resizes-content");
    expect(document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute("content")).toBe("yes");
    expect(document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute("content")).toBe("default");
    expect(document.querySelector("body > .pwa-status-surface")?.getAttribute("aria-hidden")).toBe("true");
    expect(styles).toMatch(/\.pwa-status-surface\s*\{[^}]*position: fixed;[^}]*height: max\(1px, var\(--safe-area-top\)\);[^}]*background: var\(--surface\);/s);
    expect(styles).toMatch(/@media \(display-mode: standalone\)\s*\{\s*html \{ height: 100dvh; \}/);
  });

  it("keeps primary mobile surfaces inside every device safe area", () => {
    expect(styles).toContain("--safe-area-top: env(safe-area-inset-top, 0px)");
    expect(styles).toMatch(/\.app-shell\s*\{[^}]*height: var\(--workspace-viewport-height, 100%\);/s);
    expect(styles).toMatch(/\.note-toolbar\s*\{[^}]*var\(--safe-area-top\)/s);
    expect(styles).toMatch(/\.side-header\s*\{[^}]*var\(--safe-area-top\)/s);
    expect(styles).toMatch(/\.side-footer\s*\{[^}]*var\(--safe-area-bottom\)/s);
    expect(styles).toMatch(/\.status-bar\s*\{[^}]*var\(--safe-area-bottom\)/s);
    expect(styles).toMatch(/\.settings-header\s*\{[^}]*var\(--safe-area-top\)/s);
    expect(styles).toMatch(/\.auth-shell, \.loading-shell\s*\{[^}]*height: 100%;[^}]*overflow: auto/s);
  });

  it("renders each desktop pane boundary as a single line with a wider resize target", () => {
    expect(styles).toContain("--pane-divider-width: 0.5px;");
    expect(styles).toMatch(/\.app-shell\s*\{[^}]*--tree-resizer-track: var\(--pane-divider-width\);[^}]*--outline-resizer-track: var\(--pane-divider-width\);/s);
    expect(styles).toMatch(/\.pane-resizer\s*\{[^}]*background: var\(--border\);/s);
    expect(styles).toMatch(/\.pane-resizer::before\s*\{[^}]*width: 12px;/s);
  });

  it("keeps responsive sidebar controls available at their intended breakpoints", () => {
    expect(styles).toContain(".side-header > :is(.mobile-tree-close, .mobile-outline-close) { display: none; }");
    expect(styles).toMatch(/@media \(max-width: 1100px\)[\s\S]*?\.right-pane-collapse \{ display: none; \}/);
    expect(styles).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.tree-pane-collapse \{ display: none; \}[\s\S]*?\.mobile-tree-close \{ display: grid; \}/);
    expect(styles).not.toContain(".desktop-collapse { display: none; }");
  });

  it("places transient notifications below the top toolbar", () => {
    expect(styles).toMatch(/\.toast-stack\s*\{[^}]*top: calc\(64px \+ var\(--safe-area-top\)\)/s);
  });

  it("keeps the editor pane constrained so the document owns vertical scrolling", () => {
    expect(styles).toMatch(/\.note-pane\s*\{[^}]*height: 100%;[^}]*overflow: hidden;[^}]*display: flex;[^}]*flex-direction: column;/s);
    expect(styles).toMatch(/\.editor-area\s*\{[^}]*flex: 1;[^}]*overflow: auto;/s);
    expect(styles).toMatch(/html, body, #root\s*\{[^}]*overflow: hidden;[^}]*overscroll-behavior: none;/s);
    expect(styles).toMatch(/\.app-shell\s*\{[^}]*position: fixed;[^}]*top: var\(--workspace-viewport-top, 0px\);/s);
    expect(styles).toMatch(/\.note-pane-top\s*\{[^}]*position: fixed;[^}]*right: var\(--note-pane-right\);[^}]*left: var\(--note-pane-left\);/s);
  });
});
