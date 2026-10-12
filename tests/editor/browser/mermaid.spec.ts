import { expect, test, type Locator } from "@playwright/test";

const markdown = [
  "```mermaid", "sequenceDiagram", "participant A as 设备 A", "participant B as 设备 B",
  "A->>B: 建立出站状态", "B-->>A: 允许入站", "```", "",
  "```mermaid", "flowchart LR", "A[设备 A] -->|发送数据| B[设备 B]", "```"
].join("\n");

async function diagramColors(image: Locator, selectors: { text: string; line: string; nodeText: string; node: string }) {
  return image.evaluate(async (element, selectors) => {
    const svg = await (await fetch((element as HTMLImageElement).src)).text();
    const host = document.createElement("div");
    host.style.visibility = "hidden";
    host.append(document.importNode(new DOMParser().parseFromString(svg, "image/svg+xml").documentElement, true));
    document.body.append(host);
    try {
      const paint = (selector: string, property: "fill" | "stroke") => {
        const node = host.querySelector(selector);
        if (!node) throw new Error(`Missing diagram element: ${selector}`);
        return getComputedStyle(node)[property];
      };
      return {
        text: paint(selectors.text, "fill"), line: paint(selectors.line, "stroke"),
        nodeText: paint(selectors.nodeText, "fill"), node: paint(selectors.node, "fill"),
        background: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim()
      };
    } finally { host.remove(); }
  }, selectors);
}

function contrast(first: string, second: string) {
  const luminance = (color: string) => {
    const channels = color.startsWith("#")
      ? color.slice(1).match(/../g)!.map(value => parseInt(value, 16))
      : color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const linear = channels.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const mode of ["live", "reading"] as const) {
  test(`Mermaid ${mode} previews retain contrast and switch themes without saving`, async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page.locator(".markdown-editor-host .ProseMirror").first()).toBeVisible();
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await page.getByRole("button", { name: mode, exact: true }).click();
    await page.evaluate(text => window.mintFixture.load(text), markdown);
    const images = page.locator(".mint-block-preview img");
    await expect(images).toHaveCount(2);
    for (const theme of ["dark", "light", "dark"] as const) {
      const oldUrls = await images.evaluateAll(elements => elements.map(element => (element as HTMLImageElement).src));
      const changing = await page.evaluate(theme => {
        const changing = document.documentElement.dataset.theme !== theme;
        document.documentElement.dataset.theme = theme;
        return changing;
      }, theme);
      if (changing) await expect.poll(() => images.evaluateAll((elements, oldUrls) => elements.every((element, index) => (element as HTMLImageElement).src !== oldUrls[index]), oldUrls)).toBe(true);
      await expect.poll(() => images.evaluateAll(elements => elements.every(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0))).toBe(true);
      const sequence = await diagramColors(images.nth(0), { text: ".messageText", line: ".messageLine0", nodeText: "text.actor tspan", node: "rect.actor" });
      const flowchart = await diagramColors(images.nth(1), { text: ".edgeLabel text", line: ".flowchart-link", nodeText: ".node .label text", node: ".node rect" });
      for (const colors of [sequence, flowchart]) {
        // Sequence messages sit directly on the document background; node labels have their own fill.
        expect(contrast(colors.line, colors.background)).toBeGreaterThanOrEqual(3);
        expect(contrast(colors.nodeText, colors.node), JSON.stringify(colors)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(sequence.text, sequence.background)).toBeGreaterThanOrEqual(4.5);
      expect(await page.evaluate(() => window.mintFixture.saves())).toBe(0);
      expect(await page.evaluate(() => window.mintFixture.markdown())).toBe(markdown);
      await page.locator(".editor-area").screenshot({ path: testInfo.outputPath(`mermaid-${theme}.png`) });
    }
  });
}
