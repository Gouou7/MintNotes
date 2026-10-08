import { expect, test } from "@playwright/test";

test.use({
  deviceScaleFactor: 2,
  // Use native scaling when capturing Chromium backdrop rendering at Retina resolution.
  launchOptions: async ({ browserName, launchOptions }, use) => use(browserName === "chromium" ? { ...launchOptions, args: [...(launchOptions.args ?? []), "--force-device-scale-factor=2"] } : launchOptions),
});

for (const [name, width, height] of [["desktop", 1445, 956], ["tablet", 834, 1112], ["mobile", 320, 568]] as const) {
  test(`${name} notifications match both themes and stack without covering their controls`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/workspace.html");
    await expect(page.getByRole("button", { name: "Source", exact: true })).toBeVisible();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Main page");
    await page.clock.install(); await page.clock.pauseAt(new Date());
    await page.evaluate(() => {
      window.mintWorkspaceFixture.notify("Saved.", "info");
      window.mintWorkspaceFixture.notify("This warning is longer and wraps to another line without widening the notification.", "warning");
      window.mintWorkspaceFixture.notify("Save failed.\nYour note is still available locally.\nPlease check the connection.", "critical");
    });
    const stack = page.locator(".toast-stack"), notices = stack.locator(".toast-notice");
    await expect(notices).toHaveCount(3);
    for (const theme of ["dark", "light"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      // Allow animation-frame work to paint the editor beneath the live backdrop.
      await page.clock.runFor(100);
      await expect(notices.first()).toHaveCSS("color", theme === "dark" ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 0, 0, 0.9)");
      await expect(notices.first()).toHaveCSS("border-color", theme === "dark" ? "rgb(51, 51, 51)" : "rgb(226, 226, 226)");
      await expect(notices.nth(1)).toHaveCSS("border-color", "rgb(255, 255, 0)");
      await expect(notices.nth(2)).toHaveCSS("border-color", "rgb(255, 0, 0)");
      await expect(notices.first().locator(".lucide-bell-ring")).toBeVisible();
      await expect(stack.locator(".lucide-circle-alert")).toHaveCount(2);
      await expect(notices.first().locator(".toast-indicator")).toHaveCSS("color", theme === "dark" ? "rgb(252, 249, 248)" : "rgb(0, 0, 0)");
      const paints = await notices.evaluateAll(elements => elements.map(element => {
        const canvas = document.createElement("canvas"), context = canvas.getContext("2d")!;
        context.fillStyle = getComputedStyle(element).backgroundColor; context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      }));
      const expectedPaints = [[0, 0, 0, theme === "dark" ? 77 : 26], [theme === "dark" ? 255 : 123, theme === "dark" ? 255 : 123, 0, 77], [255, 0, 0, 77]];
      paints.forEach((paint, index) => paint.forEach((channel, component) => expect(Math.abs(channel - expectedPaints[index][component])).toBeLessThanOrEqual(2)));
      const bounds = await notices.all().then(elements => Promise.all(elements.map(element => element.boundingBox())));
      expect(bounds[0]!.y).toBe(64); expect(width - bounds[0]!.x - bounds[0]!.width).toBe(16);
      expect(bounds[0]!.height).toBe(48);
      for (const [index, notice] of (await notices.all()).entries()) {
        await expect(notice).toHaveCSS("border-radius", "20px");
        await expect(notice).toHaveCSS("backdrop-filter", "blur(25px)");
        expect(bounds[index]!.width).toBe(Math.min(300, width - 32));
        if (index) expect(bounds[index]!.y - bounds[index - 1]!.y - bounds[index - 1]!.height).toBe(16);
        const close = (await notice.getByRole("button", { name: "Close notification", exact: true }).boundingBox())!;
        expect(close.x + close.width).toBeLessThanOrEqual(width - 16);
        expect(close.y + close.height).toBeLessThanOrEqual(bounds[index]!.y + bounds[index]!.height);
      }
      expect(bounds[1]!.height).toBeGreaterThan(48);
      await page.screenshot({ path: testInfo.outputPath(`notifications-${theme}.png`), animations: "disabled" });
    }
    await notices.nth(1).getByRole("button", { name: "Close notification", exact: true }).click();
    await expect(notices).toHaveCount(2); await expect(notices.nth(1)).toHaveAttribute("role", "alert");
    await page.evaluate(() => window.mintWorkspaceFixture.notify("A notification with an action whose label needs to wrap.", "critical", { label: "A long action label that still fits the notification", run: () => {} }));
    const actionNotice = stack.locator(".has-action"), action = actionNotice.locator(".toast-action");
    const actionBounds = (await action.boundingBox())!, noticeBounds = (await actionNotice.boundingBox())!;
    expect(actionBounds.x).toBeGreaterThanOrEqual(noticeBounds.x); expect(actionBounds.x + actionBounds.width).toBeLessThanOrEqual(noticeBounds.x + noticeBounds.width);
    await action.click(); await expect(notices).toHaveCount(2);
    await page.evaluate(() => { for (let index = 0; index < 24; index++) window.mintWorkspaceFixture.notify(`Additional error ${index}`, "critical"); });
    await expect(notices).toHaveCount(26);
    expect(await stack.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    expect((await notices.last().boundingBox())!.width).toBe(Math.min(300, width - 32));
    await notices.last().getByRole("button", { name: "Close notification", exact: true }).focus();
    expect(await stack.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.evaluate(() => { const style = document.documentElement.style; style.setProperty("--safe-area-top", "24px"); style.setProperty("--safe-area-right", "20px"); });
    await expect(stack).toHaveCSS("top", "88px"); await expect(stack).toHaveCSS("right", "20px");
    await page.emulateMedia({ forcedColors: "active" });
    await expect(notices.first()).toHaveCSS("backdrop-filter", "none");
  });
}
