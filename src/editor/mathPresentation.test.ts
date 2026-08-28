import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("src/styles.css"), "utf8");
const editorStyles = [
  readFileSync(resolve("src/editor/core/styles/widgets.css"), "utf8"),
  readFileSync(resolve("src/editor/core/styles/theme-typora.css"), "utf8"),
  styles,
].join("\n");

describe("display-math presentation", () => {
  it("computes the active source block as multiline monospace text", () => {
    const style = document.createElement("style");
    style.textContent = editorStyles;
    const host = document.createElement("div");
    host.className = "markdown-editor-host";
    host.innerHTML = '<div class="ProseMirror"><pre data-source-block data-source-kind="mint-math-block"><code>$$\nA_B\n$$</code></pre></div>';
    document.head.append(style);
    document.body.append(host);

    const source = host.querySelector<HTMLElement>("pre")!;
    const code = host.querySelector<HTMLElement>("code")!;
    expect(getComputedStyle(source).fontFamily).toContain("ui-monospace");
    expect(getComputedStyle(source).whiteSpace).toBe("break-spaces");
    expect(getComputedStyle(code).fontFamily).toBe("inherit");
    expect(getComputedStyle(code).whiteSpace).toBe("inherit");

    host.remove();
    style.remove();
    expect(styles).toMatch(
      /\.live-math-block-source\.is-live-syntax-rendered[^}]*\{[^}]*display: none;/s,
    );
  });

  it("computes the complete active inline source as monospace text", () => {
    const style = document.createElement("style");
    style.textContent = editorStyles;
    const host = document.createElement("div");
    host.className = "markdown-editor-host";
    host.innerHTML = '<div class="ProseMirror"><p>Before <span class="live-inline-math-editing">$A_d$</span> after</p></div>';
    document.head.append(style);
    document.body.append(host);

    const source = host.querySelector<HTMLElement>(".live-inline-math-editing")!;
    expect(source.textContent).toBe("$A_d$");
    expect(getComputedStyle(source).fontFamily).toContain("ui-monospace");

    host.remove();
    style.remove();
  });
});
