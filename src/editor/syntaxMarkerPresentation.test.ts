import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor } from "./core/lib";
import { createCalloutExtension } from "./extensions/callout";

const editorStyles = [
  "src/editor/core/styles/widgets.css",
  "src/editor/core/styles/theme-typora.css",
  "src/styles.css",
].map((path) => readFileSync(resolve(path), "utf8")).join("\n");
const mounted: HTMLElement[] = [];
let previousTheme: string | null;

beforeEach(() => {
  previousTheme = document.documentElement.getAttribute("data-theme");
  const style = document.createElement("style");
  style.textContent = editorStyles;
  document.head.append(style);
  mounted.push(style);
});

afterEach(() => {
  for (const element of mounted.splice(0)) element.remove();
  if (previousTheme === null) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", previousTheme);
});

function luminance(hex: string): number {
  const rgb = hex.slice(1).match(/../g)!.map((channel) => parseInt(channel, 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

describe.each(["light", "dark"])("syntax markers in the %s theme", (theme) => {
  beforeEach(() => document.documentElement.setAttribute("data-theme", theme));

  it("shares one style across headings, inline syntax, images, lists, quotes, Callouts and code fences", () => {
    const source = '# Heading\n\n**bold** *italic* [label](https://example.test) ![photo](image.png)\n\n- list\n\n> quote\n\n> [!NOTE] Title\n> callout\n\n```md\ncode\n```';
    const host = document.createElement("div");
    host.className = "markdown-editor-host";
    document.body.append(host);
    mounted.push(host);
    const editor = createEditor(host, { initialContent: source, extensions: [createCalloutExtension()] });
    try {
      editor.setSelection({ anchor: 0, head: source.length });
      const markers = [...host.querySelectorAll<HTMLElement>(".syntax-hint, .syntax-hint-italic")];
      expect(markers.map((marker) => marker.textContent)).toEqual(expect.arrayContaining([
        "# ", "**", "*", "[", "](https://example.test)", "![", "](image.png)", "- ", "> ", "[!NOTE]", "```md", "```",
      ]));
      const expectedColor = getComputedStyle(markers[0]).color;
      expect(expectedColor).not.toBe(getComputedStyle(host.querySelector(".ProseMirror")!).color);
      for (const marker of markers) {
        const style = getComputedStyle(marker);
        expect(style.color).toBe(expectedColor);
        expect(style.fontWeight).toBe("normal");
        expect(style.fontStyle).toBe("normal");
      }
      expect(editor.getMarkdown()).toBe(source);
    } finally {
      editor.destroy();
    }
  });

  it("keeps at least 4.5:1 contrast on body, inline-code, code-block and highlight backgrounds", () => {
    const rootStyle = getComputedStyle(document.documentElement);
    const token = (name: string) => rootStyle.getPropertyValue(name).trim();
    for (const background of ["--surface", "--surface-input", "--code-block-bg"]) {
      expect(contrast(token("--syntax-marker-color"), token(background))).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(token("--syntax-marker-highlight-color"), token("--highlight-bg")))
      .toBeGreaterThanOrEqual(4.5);
  });

  it("adapts syntax markers to the rendered highlight background", () => {
    const host = document.createElement("div");
    host.className = "markdown-editor-host";
    host.innerHTML = '<div class="ProseMirror"><mark><span class="syntax-hint">**</span>bold<span class="syntax-hint-italic">**</span></mark></div>';
    document.body.append(host);
    mounted.push(host);
    const markers = [...host.querySelectorAll<HTMLElement>("mark .syntax-hint, mark .syntax-hint-italic")];
    const reference = document.createElement("span");
    reference.style.color = getComputedStyle(document.documentElement).getPropertyValue("--syntax-marker-highlight-color");
    host.append(reference);
    for (const marker of markers) {
      const style = getComputedStyle(marker);
      expect(style.color).toBe(getComputedStyle(reference).color);
      expect(style.fontStyle).toBe("normal");
      expect(style.fontWeight).toBe("normal");
    }
    expect(getComputedStyle(markers[0]).color).not.toBe(getComputedStyle(host.querySelector("mark")!).color);
  });
});
