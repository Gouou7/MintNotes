import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEditor } from "./core/lib";

const editorStyles = [
  readFileSync(resolve("src/editor/core/styles/widgets.css"), "utf8"),
  readFileSync(resolve("src/editor/core/styles/theme-typora.css"), "utf8"),
  readFileSync(resolve("src/styles.css"), "utf8"),
].join("\n");

const mounted: HTMLElement[] = [];

function mountSource(kind: string): HTMLElement {
  const style = document.createElement("style");
  style.textContent = editorStyles;
  const host = document.createElement("div");
  host.className = "markdown-editor-host";
  host.innerHTML = `<div class="ProseMirror"><pre data-source-block data-source-kind="${kind}"><code>source</code></pre></div>`;
  document.head.append(style);
  document.body.append(host);
  mounted.push(style, host);
  return host.querySelector<HTMLElement>("pre")!;
}

afterEach(() => {
  for (const element of mounted.splice(0)) element.remove();
});

describe("empty quote marker visibility", () => {
  it.each(["> ", ">\n>\n> ", "> > "])("does not clip editing markers for %j", (quote) => {
    const style = document.createElement("style");
    style.textContent = editorStyles;
    document.head.append(style);
    const host = document.createElement("div");
    host.className = "markdown-editor-host";
    document.body.append(host);
    mounted.push(style, host);
    const source = `${quote}\n\nafter`;
    const editor = createEditor(host, { initialContent: source });
    try {
      editor.setSelection({ anchor: 0, head: quote.length });
      const markers = host.querySelectorAll<HTMLElement>("blockquote .source-line-prefix");
      expect(markers).toHaveLength(quote.split("\n").length);
      for (const marker of markers) {
        expect(getComputedStyle(marker).fontSize).not.toBe("0px");
        const gap = marker.closest<HTMLElement>("pre[data-source-gap]")!;
        expect(getComputedStyle(gap).overflow).toBe("visible");
      }
      expect(getComputedStyle(host.querySelector("blockquote")!).borderLeftColor).toBe("transparent");
      editor.setSelectionOffset(source.length);
      const hidden = host.querySelectorAll<HTMLElement>("blockquote .source-line-prefix-hidden");
      expect(hidden).toHaveLength(markers.length);
      for (const marker of hidden) expect(getComputedStyle(marker).width).toBe("0px");
      expect(getComputedStyle(host.querySelector("blockquote")!).borderLeftStyle).toBe("solid");
      expect(getComputedStyle(host.querySelector("blockquote")!).borderLeftColor).not.toBe("transparent");
      expect(editor.getMarkdown()).toBe(source);
    } finally {
      editor.destroy();
    }
  });

  it("keeps structural separators collapsed", () => {
    const source = mountSource("paragraph");
    source.setAttribute("data-source-gap", "1");
    source.setAttribute("data-source-gap-structural", "1");
    source.removeAttribute("data-source-block");
    expect(getComputedStyle(source).overflow).toBe("hidden");
    expect(getComputedStyle(source).height).toBe("0px");
  });
});

describe("transient source-block typography", () => {
  it.each(["bullet_list", "ordered_list", "table", "toc"])(
    "inherits the complete Live-mode font metrics for %s",
    (kind) => {
      const source = mountSource(kind);

      expect(getComputedStyle(source).fontSize).toBe("inherit");
      expect(getComputedStyle(source).lineHeight).toBe("inherit");
    },
  );

  it("keeps heading-specific font metrics above the shared source reset", () => {
    const source = mountSource("heading-1");
    const heading = document.createElement("h1");
    heading.textContent = "Heading";
    source.before(heading);
    const sourceStyle = getComputedStyle(source);
    const headingStyle = getComputedStyle(heading);

    expect(sourceStyle.fontSize).toBe(headingStyle.fontSize);
    expect(sourceStyle.fontWeight).toBe(headingStyle.fontWeight);
    expect(sourceStyle.lineHeight).toBe(headingStyle.lineHeight);
  });
});

describe("heading marker typography", () => {
  it.each(["h1", "h2", "h3", "h4", "h5", "h6"])(
    "keeps an editing ATX %s marker at the heading size",
    (tag) => {
      const style = document.createElement("style");
      style.textContent = editorStyles;
      const host = document.createElement("div");
      host.className = "markdown-editor-host";
      host.innerHTML = `<div class="ProseMirror"><${tag}><span class="syntax-hint source-line-prefix"># </span>Title</${tag}></div>`;
      document.head.append(style);
      document.body.append(host);
      mounted.push(style, host);

      const heading = host.querySelector<HTMLElement>(tag)!;
      const marker = host.querySelector<HTMLElement>(".source-line-prefix")!;

      expect(getComputedStyle(marker).fontSize).toBe(getComputedStyle(heading).fontSize);
    },
  );

  it.each(["h1", "h2"])("puts the hidden %s marker on its own body-sized line", (tag) => {
    const style = document.createElement("style");
    style.textContent = editorStyles;
    const host = document.createElement("div");
    host.className = "markdown-editor-host";
    host.innerHTML = `<div class="ProseMirror"><${tag} class="setext-heading">Title<span class="setext-heading-marker syntax-hidden">\n===</span></${tag}></div>`;
    document.head.append(style);
    document.body.append(host);
    mounted.push(style, host);

    const root = host.querySelector<HTMLElement>(".ProseMirror")!;
    const marker = host.querySelector<HTMLElement>(".setext-heading-marker")!;
    const rootStyle = getComputedStyle(root);
    const markerStyle = getComputedStyle(marker);

    expect(markerStyle.display).toBe("inline");
    expect(markerStyle.fontSize).toBe(rootStyle.fontSize);
    expect(markerStyle.lineHeight).toBe(rootStyle.lineHeight);
    expect(markerStyle.whiteSpace).toBe("break-spaces");
    expect(markerStyle.visibility).toBe("hidden");
  });
});
