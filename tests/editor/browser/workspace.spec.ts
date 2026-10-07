import { expect, test } from "@playwright/test";

for (const [name, width, height] of [["desktop", 1445, 956], ["tablet", 834, 1112], ["mobile", 320, 844]] as const) {
  test(`${name} workspace matches theme tokens and keeps pane and mode controls usable`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("/workspace.html");
    const source = page.getByRole("button", { name: "Source", exact: true }), reading = page.getByRole("button", { name: "Reading", exact: true });
    for (const theme of ["dark", "light"]) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await expect(page.locator(".note-toolbar")).toHaveCSS("height", "50px");
      await expect(page.locator(".tree-pane")).toHaveCSS("background-color", theme === "dark" ? "rgb(30, 30, 30)" : "rgb(232, 233, 233)");
      await expect(page.locator(".side-header").first()).toHaveCSS("border-bottom-color", theme === "dark" ? "rgb(51, 51, 51)" : "rgb(151, 151, 151)");
      const codeOutline = await page.locator(".ProseMirror pre").evaluate(element => getComputedStyle(element, "::after").backgroundColor);
      expect(codeOutline).toBe(theme === "dark" ? "rgb(51, 51, 51)" : "rgb(151, 151, 151)");
      await source.click();
      await expect(source).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("textarea.typora-web-source:not([hidden])")).toBeVisible();
      await source.click();
      await expect(source).toHaveAttribute("aria-pressed", "false");
      await reading.click();
      await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
      await reading.click();
      await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true");
      await page.locator(".ProseMirror strong").filter({ hasText: "bold" }).click();
      await expect(page.locator(".ProseMirror .syntax-hint").first()).toHaveCSS("color", "rgb(177, 177, 177)");
      await expect(page.locator(".ProseMirror hr")).toHaveCSS("height", "1px");
      await expect(page.locator(".ProseMirror hr")).toHaveCSS("background-color", theme === "dark" ? "rgb(51, 51, 51)" : "rgb(151, 151, 151)");
      expect(await page.evaluate(() => window.mintWorkspaceFixture.saves())).toBe(0);

      await expect(page.locator(".note-toolbar button svg").first()).toHaveAttribute("width", "16");
      const buttons = page.locator(".note-toolbar button:visible");
      for (const button of await buttons.all()) {
        const bounds = (await button.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
      if (name === "mobile") await page.getByRole("button", { name: "Open left sidebar" }).click();
      await expect(page.locator(".search-box")).toBeVisible();
      await expect(page.locator(".tree-pane .side-header button:visible")).toHaveCount(1);
      await expect.poll(() => page.locator(".brand-small").evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
      if (name === "mobile") {
        const row = page.locator('.tree-row[data-object-id="locked"]');
        const lock = (await row.locator(".tree-note-lock").boundingBox())!, menu = (await row.locator(".tree-more").boundingBox())!;
        expect(lock.x + lock.width).toBeLessThanOrEqual(menu.x);
      }
      const searchBounds = (await page.locator(".search-box").boundingBox())!, pinnedBounds = (await page.locator(".pinned-section").boundingBox())!;
      expect(searchBounds.y + searchBounds.height).toBeLessThan(pinnedBounds.y);
      const newNote = page.getByRole("button", { name: "New note", exact: true });
      await expect(newNote.locator("svg")).toHaveAttribute("width", "16");
      await expect(newNote).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await newNote.hover();
      await expect.poll(() => newNote.evaluate(element => /(?:\/ |, )0\.1\)$/.test(getComputedStyle(element).backgroundColor))).toBe(true);
      await page.mouse.down();
      await expect.poll(() => newNote.evaluate(element => /(?:\/ |, )0\.3\)$/.test(getComputedStyle(element).backgroundColor))).toBe(true);
      await page.mouse.up();
      await page.mouse.move(width - 10, height - 10);
      await expect(newNote).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await page.screenshot({ path: testInfo.outputPath(`workspace-${theme}.png`) });
      if (name === "mobile") await page.getByRole("button", { name: "Close directory" }).click();
    }
    if (name === "desktop") {
      await page.getByRole("button", { name: "Collapse directory" }).click();
      await page.getByRole("button", { name: "Open left sidebar" }).click();
      await expect(page.locator(".search-box")).toBeVisible();
      await page.getByRole("button", { name: "Collapse right sidebar" }).click();
    }
    await page.getByRole("button", { name: "Open right sidebar" }).click();
    await expect(page.locator(".right-panel-header")).toBeVisible();
    await expect(page.locator(".right-panel-header > button:visible")).toHaveCount(1);
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(page.locator(".outline-empty")).toHaveText("No history");
    if (name !== "desktop") await page.getByRole("button", { name: "Close right sidebar" }).click();
  });
}
