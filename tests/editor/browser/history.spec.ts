import { expect, test } from "@playwright/test";

for (const [name, width, height] of [["desktop", 1445, 956], ["tablet", 834, 1112], ["mobile", 320, 844]] as const) {
  test(`${name} snapshot panel follows the design and preserves inline rename layout`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("/workspace.html?history&language=zh-CN");
    if (width <= 1100) await page.locator(".right-pane-toggle").click();
    await expect(page.locator(".outline-pane")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    const panel = page.locator(".history-panel"), row = panel.locator(".history-row").first();
    const title = row.locator("strong"), details = row.locator("small"), shield = row.locator(".history-protection > svg");
    const actions = row.locator(".history-actions");

    for (const theme of ["dark", "light"] as const) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await page.mouse.move(width / 2, height - 50);
      await expect(panel.getByRole("button", { name: "创建快照", exact: true })).toHaveCSS("height", "30px");
      await expect(panel.getByRole("button", { name: "清空历史", exact: true })).toHaveCSS("height", "30px");
      await expect(panel.locator(".history-panel-actions button").first()).toHaveCSS("border-radius", "8px");
      await expect(panel.locator(".history-day h3")).toHaveText("2000-01-01");
      await expect(details).toHaveText("00:00 · 自动保存");
      await expect(title).toHaveCSS("font-size", "14px");
      await expect(title).toHaveCSS("font-weight", "400");
      await expect(row).toHaveCSS("height", "44px");
      await expect(shield).toHaveCSS("opacity", "1");
      await expect(actions).toHaveCSS("opacity", "0");

      const panelBox = (await panel.boundingBox())!, titleBox = (await title.boundingBox())!, detailsBox = (await details.boundingBox())!;
      expect(titleBox.x - panelBox.x).toBeCloseTo(31, 0);
      expect(detailsBox.y - titleBox.y - titleBox.height).toBeGreaterThanOrEqual(4);
      const shieldBox = (await shield.boundingBox())!, dotsBox = (await actions.locator("svg").boundingBox())!;
      expect(shieldBox.x + shieldBox.width / 2).toBeCloseTo(dotsBox.x + dotsBox.width / 2, 1);
      expect(shieldBox.y + shieldBox.height / 2).toBeCloseTo(dotsBox.y + dotsBox.height / 2, 1);
      await panel.locator(".history-row").nth(1).hover();
      await panel.screenshot({ path: testInfo.outputPath(`snapshot-${theme}.png`) });

      await row.hover();
      await expect(shield).toHaveCSS("opacity", "0");
      await expect(actions).toHaveCSS("opacity", "1");
      await actions.click();
      const menu = page.locator(".history-context-menu");
      await expect(menu).toBeVisible();
      const menuBox = (await menu.boundingBox())!;
      expect(menuBox.x).toBeGreaterThanOrEqual(0);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
      await menu.getByRole("button", { name: "重命名", exact: true }).click();
      const input = row.locator(".history-rename-input");
      await expect(input).toBeFocused();
      await expect(input).toHaveCSS("font-size", "14px");
      await expect(input).toHaveCSS("font-weight", "400");
      const inputBox = (await input.boundingBox())!;
      expect(inputBox.x).toBeCloseTo(titleBox.x, 1);
      expect(inputBox.y).toBeCloseTo(titleBox.y, 1);
      expect(inputBox.height).toBeCloseTo(titleBox.height, 1);
      expect(await details.boundingBox()).toEqual(detailsBox);
      for (const adjustment of [0, 10]) {
        await page.locator(".app-shell").evaluate((element, value) => (element as HTMLElement).style.setProperty("--font-adjust", `${value}px`), adjustment);
        const renamed = (await input.boundingBox())!, metadata = (await details.boundingBox())!, rowBox = (await row.boundingBox())!;
        const focusExtent = await input.evaluate(element => {
          const style = getComputedStyle(element);
          return parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
        });
        expect(renamed.y - focusExtent).toBeGreaterThanOrEqual(rowBox.y);
        expect(renamed.y + renamed.height + focusExtent).toBeLessThan(metadata.y);
        expect(metadata.y + metadata.height).toBeLessThanOrEqual(rowBox.y + rowBox.height);
      }
      await page.locator(".app-shell").evaluate(element => (element as HTMLElement).style.setProperty("--font-adjust", "0px"));
      await panel.screenshot({ path: testInfo.outputPath(`snapshot-rename-${theme}.png`) });
      await input.press("Escape");
      await expect(title).toHaveText("笔记历史一标题");
      await page.mouse.move(width / 2, height - 50);
      await row.locator(".history-select").focus();
      await page.keyboard.press("Tab");
      await expect(actions).toBeFocused();
      await expect(actions).toHaveCSS("opacity", "1");
      await expect(shield).toHaveCSS("opacity", "0");
      await actions.blur();
    }
  });
}

test("touch snapshot actions stay visible and usable in a narrow drawer", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage();
    await page.goto("/workspace.html?history&language=zh-CN");
    await page.locator(".right-pane-toggle").tap();
    const row = page.locator(".history-row").first();
    await expect(row.locator(".history-actions")).toHaveCSS("opacity", "1");
    await expect(row.locator(".history-protection > svg")).toHaveCSS("opacity", "0");
    await row.locator(".history-actions").tap();
    await expect(page.locator(".history-context-menu")).toBeVisible();
    await page.locator(".history-context-menu").getByRole("button", { name: "取消保护", exact: true }).tap();
    await expect(row.locator(".history-protection")).toHaveCount(0);
    await page.getByRole("button", { name: "创建快照", exact: true }).tap();
    await expect(page.locator(".history-row")).toHaveCount(4);
  } finally {
    await context.close();
  }
});
