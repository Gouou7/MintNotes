import { expect, test } from "@playwright/test";

test.use({
  deviceScaleFactor: 2,
  launchOptions: async ({ browserName, launchOptions }, use) => use(browserName === "chromium" ? { ...launchOptions, args: [...(launchOptions.args ?? []), "--force-device-scale-factor=2"] } : launchOptions),
});

for (const [name, width, height] of [["desktop", 1445, 956], ["tablet", 834, 1112], ["mobile", 320, 844]] as const) {
  test(`${name} workspace matches theme tokens and keeps pane and mode controls usable`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("/workspace.html");
    const source = page.getByRole("button", { name: "Source", exact: true }), reading = page.getByRole("button", { name: "Read-only", exact: true });
    for (const theme of ["dark", "light"]) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await expect(page.locator(".note-toolbar")).toHaveCSS("height", "48px");
      await expect(page.locator(".tree-pane")).toHaveCSS("background-color", theme === "dark" ? "rgb(30, 30, 30)" : "rgb(232, 233, 233)");
      await expect(page.locator(".side-header").first()).toHaveCSS("border-bottom-color", theme === "dark" ? "rgb(51, 51, 51)" : "rgb(226, 226, 226)");
      await expect(page.locator(".side-header").first()).toHaveCSS("border-bottom-width", "0.5px");
      await expect(page.locator(".note-toolbar")).toHaveCSS("border-bottom-width", "0.5px");
      await expect(page.locator(".status-bar")).toHaveCSS("border-top-width", "0.5px");
      for (const divider of await page.locator(".pane-resizer:visible").all()) expect((await divider.boundingBox())!.width).toBe(0.5);
      const codeOutline = await page.locator(".ProseMirror pre").evaluate(element => getComputedStyle(element, "::after").backgroundColor);
      expect(codeOutline).toBe(theme === "dark" ? "rgb(51, 51, 51)" : "rgb(226, 226, 226)");
      await source.click();
      await expect(source).toHaveAttribute("aria-pressed", "true");
      await expect(source).toHaveCSS("color", theme === "dark" ? "rgb(97, 210, 153)" : "rgb(97, 210, 160)");
      await expect(source).toHaveCSS("border-width", "0px");
      expect(await page.evaluate(() => ["--accent", "--accent-text"].map(name => getComputedStyle(document.documentElement).getPropertyValue(name).trim()))).toEqual(theme === "dark" ? ["#61d299", "#61d299"] : ["#61d2a0", "#61d2a0"]);
      await page.mouse.move(width - 10, height - 10);
      await expect(source).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(page.locator("textarea.typora-web-source:not([hidden])")).toBeVisible();
      await source.click();
      await expect(source).toHaveAttribute("aria-pressed", "false");
      await reading.click();
      await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
      await reading.click();
      await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true");
      await reading.click(); await source.click();
      const textarea = page.locator("textarea.typora-web-source:not([hidden])");
      await expect(reading).toHaveAttribute("aria-pressed", "true"); await expect(source).toHaveAttribute("aria-pressed", "true");
      await expect(textarea).toHaveJSProperty("readOnly", true);
      const original = await textarea.inputValue();
      await textarea.focus(); await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.insertText("BLOCKED");
      await expect(textarea).toHaveValue(original);
      await source.click(); await reading.click();
      await page.getByRole("button", { name: "Lock note", exact: true }).click();
      await expect(reading).toBeDisabled(); await expect(reading).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Unlock note", exact: true })).toHaveAttribute("aria-pressed", "true");
      await source.click(); await expect(source).toBeEnabled(); await expect(textarea).toHaveJSProperty("readOnly", true);
      await textarea.press("ControlOrMeta+/"); await expect(source).toHaveAttribute("aria-pressed", "false");
      await source.click(); await expect(source).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Unlock note", exact: true }).click();
      await expect(reading).toBeEnabled(); await expect(reading).toHaveAttribute("aria-pressed", "false");
      await expect(textarea).toHaveJSProperty("readOnly", false); await source.click();
      await page.locator(".ProseMirror strong").filter({ hasText: "bold" }).click();
      await expect(page.locator(".ProseMirror .syntax-hint").first()).toHaveCSS("color", "rgb(177, 177, 177)");
      await expect(page.locator(".ProseMirror hr")).toHaveCSS("height", "1px");
      await expect(page.locator(".ProseMirror hr")).toHaveCSS("background-color", theme === "dark" ? "rgb(51, 51, 51)" : "rgb(226, 226, 226)");
      expect(await page.evaluate(() => window.mintWorkspaceFixture.saves())).toBe(0);

      await expect(page.locator(".note-toolbar button svg").first()).toHaveAttribute("width", "16");
      const toolbarStroke = page.locator(".note-toolbar button svg > *").first();
      await expect(toolbarStroke).toHaveCSS("stroke-width", "1.5px");
      await expect(toolbarStroke).toHaveCSS("vector-effect", "non-scaling-stroke");
      const buttons = page.locator(".note-toolbar button:visible");
      for (const button of await buttons.all()) {
        const bounds = (await button.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
      if (name === "mobile") {
        await page.getByRole("button", { name: "Open left sidebar" }).click();
        await expect(page.locator(".tree-pane")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
      }
      await expect(page.locator(".search-box")).toBeVisible();
      await expect(page.locator(".tree-pane .side-header button:visible")).toHaveCount(1);
      await expect.poll(() => page.locator(".brand-small").evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
      const row = page.locator('.tree-row[data-object-id="locked"]');
      const lockIcon = row.locator(".tree-note-lock > svg");
      await expect(lockIcon).toHaveClass(/lucide-file-lock(?:\s|$)/);
      const lock = (await lockIcon.boundingBox())!, menu = (await row.locator(".tree-more").boundingBox())!;
      expect(lock.x + lock.width / 2).toBeCloseTo(menu.x + menu.width / 2, 1);
      expect(lock.y + lock.height / 2).toBeCloseTo(menu.y + menu.height / 2, 1);
      if (name === "mobile") await expect(lockIcon).toHaveCSS("opacity", "0");
      else {
        await page.mouse.move(width - 10, height - 10);
        await expect(lockIcon).toHaveCSS("opacity", "1");
        const titleBounds = await row.locator(".tree-title").boundingBox();
        await row.hover(); await expect(lockIcon).toHaveCSS("opacity", "0");
        await expect(row.locator(".tree-more")).toHaveCSS("opacity", "1");
        expect(await row.locator(".tree-title").boundingBox()).toEqual(titleBounds);
        await page.mouse.move(width - 10, height - 10); await expect(lockIcon).toHaveCSS("opacity", "1");
        await row.locator(".tree-main").focus();
        await page.keyboard.press(testInfo.project.name === "webkit" ? "Alt+Tab" : "Tab");
        await expect(row.locator(".tree-more")).toBeFocused(); await expect(lockIcon).toHaveCSS("opacity", "0");
        await row.locator(".tree-more").blur();
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
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      for (const label of ["Save", "Cancel", "Delete"]) {
        const action = page.getByRole("button", { name: label, exact: true });
        await expect(action).toHaveCSS("height", "30px"); await expect(action).toHaveCSS("border-radius", "8px");
        await expect(action.locator("svg")).toHaveAttribute("width", "16");
        await expect(action.locator("svg > *").first()).toHaveCSS("stroke-width", "1.5px");
        await expect(action.locator("svg > *").first()).toHaveCSS("vector-effect", "non-scaling-stroke");
      }
      await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCSS("background-color", theme === "dark" ? "rgb(97, 210, 153)" : "rgb(97, 210, 160)");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
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
    const outline = page.getByRole("button", { name: "Outline", exact: true }), history = page.getByRole("button", { name: "History", exact: true });
    for (const theme of ["dark", "light"]) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      for (const [active, inactive] of [[outline, history], [history, outline]]) {
        await active.click();
        await page.mouse.move(width - 10, height - 10);
        await active.blur();
        await expect(active).toHaveAttribute("aria-current", "page");
        await expect(inactive).not.toHaveAttribute("aria-current", "page");
        await expect(active).toHaveCSS("color", theme === "dark" ? "rgb(97, 210, 153)" : "rgb(97, 210, 160)");
        await expect(inactive).not.toHaveCSS("color", theme === "dark" ? "rgb(97, 210, 153)" : "rgb(97, 210, 160)");
        await expect(active).toHaveCSS("border-top-width", "0px");
        await expect(active).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      }
      await expect(page.locator(".outline-empty")).toHaveText("No history");
    }
    if (name !== "desktop") await page.getByRole("button", { name: "Close right sidebar" }).click();
  });
}
