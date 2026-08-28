import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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
