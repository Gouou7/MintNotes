import { expect, test, type Page } from "@playwright/test";

test.use({
  deviceScaleFactor: 2,
  launchOptions: async ({ browserName, launchOptions }, use) => use(browserName === "chromium" ? { ...launchOptions, args: [...(launchOptions.args ?? []), "--force-device-scale-factor=2"] } : launchOptions),
});

async function scrollToHeading(page: Page, index: number) {
  await page.locator(".editor-area").evaluate((element, index) => {
    const heading = [...element.querySelector(".ProseMirror")!.children].filter(child => /^H[1-6]$/.test(child.tagName))[index];
    const style = getComputedStyle(element);
    const top = parseFloat(style.scrollPaddingTop) || 0, bottom = parseFloat(style.scrollPaddingBottom) || 0;
    element.scrollTo({ top: element.scrollTop + heading.getBoundingClientRect().top - element.getBoundingClientRect().top - top - (element.clientHeight - top - bottom) * 0.4 + 2, behavior: "instant" });
  }, index);
}

async function settleLayout(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => { setTimeout(() => requestAnimationFrame(() => resolve()), 160); }));
}

for (const [name, width, height] of [["desktop", 1445, 956], ["tablet", 834, 1112], ["mobile", 320, 844]] as const) {
  test(`${name} outline follows the heading tree design and separates folding from navigation`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("/workspace.html?outline&language=zh-CN");
    if (width <= 1100) await page.locator(".right-pane-toggle").click();
    await expect(page.locator(".outline-pane")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    const outline = page.locator(".outline-list");
    const parent = outline.getByRole("button", { name: "前言", exact: true });
    const child = outline.getByRole("button", { name: "实时模式通用编辑逻辑", exact: true });
    const branch = outline.getByRole("button", { name: "非严格换行的实时模式渲染逻辑与光标编辑行为", exact: true });
    const deepChild = outline.getByRole("button", { name: "连续的空白行", exact: true });

    for (const theme of ["dark", "light"] as const) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      const parentBox = (await parent.boundingBox())!, childBox = (await child.boundingBox())!;
      const branchBox = (await branch.boundingBox())!, deepBox = (await deepChild.boundingBox())!;
      expect(childBox.x - parentBox.x).toBeCloseTo(23.5, 1);
      expect(deepBox.x - branchBox.x).toBeCloseTo(23.5, 1);
      expect(branchBox.height).toBeGreaterThan(30);
      await expect(parent).toHaveCSS("font-weight", "400");
      await expect(outline.locator(".outline-children").first()).toHaveCSS("border-left-width", "0.5px");
      await expect(outline.locator(".outline-children").first()).toHaveCSS("border-left-color", theme === "dark" ? "rgb(51, 51, 51)" : "rgb(226, 226, 226)");
      expect(await outline.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await outline.screenshot({ path: testInfo.outputPath(`outline-${theme}.png`) });

      const scrollBefore = await page.locator(".editor-area").evaluate(element => element.scrollTop);
      const fold = outline.getByRole("button", { name: "收起 前言", exact: true });
      await fold.focus();
      await page.keyboard.press("Enter");
      await expect(child).toBeHidden();
      await expect(outline.getByRole("button", { name: "实时模式通用编辑逻辑", exact: true })).toHaveCount(0);
      await expect(outline.getByRole("button", { name: "展开 前言", exact: true })).toHaveAttribute("aria-expanded", "false");
      expect(await page.locator(".editor-area").evaluate(element => element.scrollTop)).toBe(scrollBefore);
      await page.keyboard.press("Space");
      await expect(child).toBeVisible();
      expect(await page.evaluate(() => window.mintWorkspaceFixture.saves())).toBe(0);
    }

    await deepChild.click();
    if (width <= 1100) await expect(page.locator(".outline-pane")).toHaveCSS("visibility", "hidden");
    const target = page.locator(".ProseMirror > h6").filter({ hasText: "连续的空白行" });
    await expect.poll(async () => {
      const targetBox = (await target.boundingBox())!, editorBox = (await page.locator(".editor-area").boundingBox())!;
      return targetBox.y >= editorBox.y + 48 && targetBox.y + targetBox.height <= editorBox.y + editorBox.height - 25;
    }).toBe(true);
    expect(await page.evaluate(() => window.mintWorkspaceFixture.saves())).toBe(0);
  });
}

test("outline compresses missing levels without changing the source heading targets", async ({ page }) => {
  await page.setViewportSize({ width: 1445, height: 956 });
  await page.goto("/workspace.html?outline");
  for (const levels of [[2, 2], [2, 4], [1, 3]]) {
    const markdown = levels.map((level, index) => `${"#".repeat(level)} Heading ${index}`).join("\n\n");
    await page.evaluate(text => window.mintWorkspaceFixture.loadMarkdown(text), markdown);
    const nodes = page.locator(".outline-node");
    await expect(nodes).toHaveCount(2);
    await expect(nodes.nth(0)).toHaveAttribute("data-outline-level", "1");
    await expect(nodes.nth(1)).toHaveAttribute("data-outline-level", levels[0] === levels[1] ? "1" : "2");
    expect(await page.locator(".ProseMirror").evaluate(element => [...element.children].filter(child => /^H[1-6]$/.test(child.tagName)).map(child => child.tagName)))
      .toEqual(levels.map(level => `H${level}`));
  }
  expect(await page.evaluate(() => window.mintWorkspaceFixture.saves())).toBe(0);
});

test("outline follows forward and backward scrolling, retains folded branches and refreshes shifted content", async ({ page }) => {
  await page.setViewportSize({ width: 1445, height: 700 });
  await page.goto("/workspace.html?outline&language=zh-CN");
  const current = page.locator(".outline-title[aria-current=location]");
  await expect(current).toHaveText("实时模式通用编辑逻辑");
  await scrollToHeading(page, 4);
  await expect(current).toHaveText("连续的空白行");
  await page.getByRole("button", { name: "收起 换行", exact: true }).click();
  await expect(current).toHaveText("换行");
  await scrollToHeading(page, 5);
  await expect(current).toHaveText("换行");
  await page.getByRole("button", { name: "展开 换行", exact: true }).click();
  await expect(current).toHaveText("非严格换行的阅读模式渲染逻辑");
  await scrollToHeading(page, 13);
  await expect(current).toHaveText("ATX 标题语法格式");
  await page.locator(".editor-area").evaluate(element => element.scrollTop = element.scrollHeight);
  await expect(current).toHaveText("无序列表");
  await page.getByRole("button", { name: "只读模式", exact: true }).click();
  await settleLayout(page);
  await scrollToHeading(page, 3);
  await expect(current).toHaveText("非严格换行的实时模式渲染逻辑与光标编辑行为");
  // Prevent native scroll anchoring from compensating for this deliberate layout shift.
  await page.locator(".editor-area").evaluate(element => element.style.overflowAnchor = "none");
  await page.locator(".ProseMirror > p").first().evaluate(element => element.style.height = "1800px");
  await expect(current).toHaveText("前言");
  await page.locator(".editor-area").evaluate(element => element.scrollTop = 0);
  await expect(current).toHaveText("前言");
  expect(await page.evaluate(() => window.mintWorkspaceFixture.saves())).toBe(0);
});

test("a long outline uses cached geometry during scrolling and pauses while hidden", async ({ page }) => {
  await page.setViewportSize({ width: 1445, height: 700 });
  await page.goto("/workspace.html?outline");
  const markdown = Array.from({ length: 300 }, (_, index) => `## Section ${index}\n\n${"Paragraph with some text.\n\n".repeat(6)}`).join("\n\n");
  await page.evaluate(text => window.mintWorkspaceFixture.loadMarkdown(text), markdown);
  await expect(page.locator(".outline-node")).toHaveCount(300);
  await settleLayout(page);
  await page.evaluate(() => {
    const headings = document.querySelectorAll<HTMLElement>(".ProseMirror > h2");
    document.documentElement.dataset.headingMeasurements = "0";
    for (const heading of headings) {
      const original = heading.getBoundingClientRect.bind(heading);
      heading.getBoundingClientRect = () => {
        document.documentElement.dataset.headingMeasurements = String(Number(document.documentElement.dataset.headingMeasurements) + 1);
        return original();
      };
    }
  });
  // Use offsetTop for the test driver so it doesn't contribute to the measured getBoundingClientRect calls.
  await page.locator(".editor-area").evaluate(async element => {
    const heading = element.querySelectorAll<HTMLElement>(".ProseMirror > h2")[150];
    const style = getComputedStyle(element);
    const top = parseFloat(style.scrollPaddingTop), bottom = parseFloat(style.scrollPaddingBottom);
    let headingTop = heading.offsetTop, parent = heading.offsetParent as HTMLElement | null;
    while (parent && parent !== element) { headingTop += parent.offsetTop; parent = parent.offsetParent as HTMLElement | null; }
    const initial = headingTop - top - (element.clientHeight - top - bottom) * 0.4 + 2;
    for (let index = 0; index < 20; index++) {
      element.scrollTop = initial + index;
      element.dispatchEvent(new Event("scroll"));
      await new Promise(requestAnimationFrame);
    }
  });
  const current = page.locator(".outline-title[aria-current=location]");
  await expect(current).toHaveText("Section 150");
  expect(await page.evaluate(() => document.documentElement.dataset.headingMeasurements)).toBe("0");
  const activeBox = (await current.boundingBox())!, listBox = (await page.locator(".outline-list").boundingBox())!;
  expect(activeBox.y).toBeGreaterThanOrEqual(listBox.y);
  expect(activeBox.y + activeBox.height).toBeLessThanOrEqual(listBox.y + listBox.height);
  await page.getByRole("button", { name: "Collapse right sidebar", exact: true }).click();
  await page.locator(".editor-area").evaluate(element => element.scrollTop = element.scrollHeight);
  await settleLayout(page);
  expect(await page.evaluate(() => document.documentElement.dataset.headingMeasurements)).toBe("0");
  await page.locator(".right-pane-toggle").click();
  await expect(current).toHaveText("Section 299");
  expect(await page.evaluate(() => window.mintWorkspaceFixture.saves())).toBe(0);
});

test("source mode tracks wrapped source positions and stays in sync after returning to rendered mode", async ({ page }) => {
  await page.setViewportSize({ width: 1445, height: 700 });
  await page.goto("/workspace.html?outline");
  const markdown = Array.from({ length: 20 }, (_, index) => `## Section ${index}\n\n${"A long source line that wraps across several visual lines. ".repeat(20)}`).join("\n\n");
  await page.evaluate(text => window.mintWorkspaceFixture.loadMarkdown(text), markdown);
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await settleLayout(page);
  const current = page.locator(".outline-title[aria-current=location]");
  for (const index of [10, 4, 16]) {
    await page.getByRole("button", { name: `Section ${index}`, exact: true }).click();
    await expect(current).toHaveText(`Section ${index}`);
    await settleLayout(page);
  }
  await page.locator(".editor-area").evaluate(element => element.scrollTop = 0);
  await expect(current).toHaveText("Section 0");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await settleLayout(page);
  await scrollToHeading(page, 8);
  await expect(current).toHaveText("Section 8");
  expect(await page.evaluate(() => window.mintWorkspaceFixture.saves())).toBe(0);
});
