import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve("index.html"), "utf8");
const styles = readFileSync(resolve("src/styles.css"), "utf8");

describe("installed PWA shell", () => {
  it("requests an edge-to-edge iOS status area", () => {
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.querySelector('meta[name="viewport"]')?.getAttribute("content")).toContain("viewport-fit=cover");
    expect(document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute("content")).toBe("yes");
    expect(document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute("content")).toBe("black-translucent");
  });

  it("keeps primary mobile surfaces inside every device safe area", () => {
    expect(styles).toContain("--safe-area-top: env(safe-area-inset-top, 0px)");
    expect(styles).toMatch(/\.note-toolbar\s*\{[^}]*var\(--safe-area-top\)/s);
    expect(styles).toMatch(/\.side-header\s*\{[^}]*var\(--safe-area-top\)/s);
    expect(styles).toMatch(/\.side-footer\s*\{[^}]*var\(--safe-area-bottom\)/s);
    expect(styles).toMatch(/\.settings-modal > header\s*\{[^}]*var\(--safe-area-top\)/s);
    expect(styles).toMatch(/\.auth-shell, \.loading-shell\s*\{[^}]*height: 100dvh;[^}]*overflow: auto/s);
  });

  it("keeps responsive sidebar controls available at their intended breakpoints", () => {
    expect(styles).toContain(".mobile-outline-close, .mobile-tree-close { display: none; }");
    expect(styles).toMatch(/@media \(max-width: 1100px\)[\s\S]*?\.right-pane-collapse \{ display: none; \}/);
    expect(styles).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.tree-pane-collapse \{ display: none; \}[\s\S]*?\.mobile-tree-close \{ display: block; \}/);
    expect(styles).not.toContain(".desktop-collapse { display: none; }");
  });

  it("places transient notifications below the top toolbar", () => {
    expect(styles).toMatch(/\.toast-notice\s*\{[^}]*top: calc\(73px \+ var\(--safe-area-top\)\)/s);
  });
});
