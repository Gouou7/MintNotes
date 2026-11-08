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
    await page.clock.install(); await page.clock.pauseAt(Date.now() + 60_000);
    await page.evaluate(() => {
      window.mintWorkspaceFixture.notify("Saved.", "info");
      window.mintWorkspaceFixture.notify("This warning is longer and wraps to another line without widening the notification.", "warning");
      window.mintWorkspaceFixture.notify("Save failed.\nYour note is still available locally.\nPlease check the connection.", "critical");
    });
    const stack = page.locator(".toast-stack"), notices = stack.locator('[data-slot="alert"]:not([data-ending-style])');
    await expect(notices).toHaveCount(3);
    for (const theme of ["dark", "light"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      // Allow animation-frame work to paint the editor beneath the live backdrop.
      await page.clock.runFor(100);
      await expect(notices.first()).toHaveCSS("border-color", theme === "dark" ? "rgb(51, 51, 51)" : "rgb(226, 226, 226)");
      await expect(notices.first()).toHaveAttribute("role", "status");
      await expect(notices.first().locator(".lucide-info")).toBeVisible();
      await expect(notices.nth(1).locator(".lucide-triangle-alert")).toBeVisible();
      await expect(notices.nth(2).locator(".lucide-circle-alert")).toBeVisible();
      await expect(notices.nth(1)).toHaveCSS("color", theme === "dark" ? "rgb(244, 220, 138)" : "rgb(108, 82, 12)");
      await expect(notices.nth(2)).toHaveCSS("color", theme === "dark" ? "rgb(255, 139, 139)" : "rgb(174, 48, 48)");
      const paints = await notices.evaluateAll(elements => {
        const canvas = document.createElement("canvas"), context = canvas.getContext("2d")!;
        const paint = (color: string) => { context.fillStyle = color; context.fillRect(0, 0, 1, 1); };
        const luminance = () => Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3), value => value / 255)
          .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
          .reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
        return elements.map(element => {
          const background = getComputedStyle(element).backgroundColor;
          const text = getComputedStyle(element.querySelector('[data-slot="alert-description"]')!).color;
          const contrast = ["#000", "#fff"].map(backdrop => {
            paint(backdrop); paint(background);
            const behindText = luminance();
            paint(text);
            const foreground = luminance();
            return (Math.max(foreground, behindText) + .05) / (Math.min(foreground, behindText) + .05);
          });
          return { background, contrast: Math.min(...contrast) };
        });
      });
      expect(new Set(paints.map(paint => paint.background)).size).toBe(3);
      for (const { contrast } of paints) expect(contrast).toBeGreaterThanOrEqual(4.5);
      const bounds = await notices.all().then(elements => Promise.all(elements.map(element => element.boundingBox())));
      expect(bounds[0]!.y).toBe(64); expect(width - bounds[0]!.x - bounds[0]!.width).toBe(16);
      expect(bounds[0]!.height).toBeGreaterThanOrEqual(46);
      const scrollport = (await stack.boundingBox())!;
      const first = bounds[0]!, last = bounds.at(-1)!;
      expect(first.x - scrollport.x).toBeGreaterThanOrEqual(16);
      expect(scrollport.x + scrollport.width - first.x - first.width).toBeGreaterThanOrEqual(16);
      expect(first.y - scrollport.y).toBeGreaterThanOrEqual(16);
      expect(scrollport.y + scrollport.height - last.y - last.height).toBeGreaterThanOrEqual(16);
      for (const [index, notice] of (await notices.all()).entries()) {
        await expect(notice).toHaveCSS("border-radius", "9px");
        await expect(notice).toHaveCSS("backdrop-filter", "blur(12px)");
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
    const actionNotice = notices.filter({ has: page.locator(".toast-action") }), action = actionNotice.locator(".toast-action");
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
    await stack.evaluate(element => { element.scrollTop = 0; });
    const insetNotice = (await notices.first().boundingBox())!;
    expect(insetNotice.y).toBe(88);
    expect(width - insetNotice.x - insetNotice.width).toBe(20);
    await page.emulateMedia({ forcedColors: "active" });
    await expect(notices.first()).toHaveCSS("backdrop-filter", "none");
  });
}

test("info and warning expire at their own deadlines and critical notices stay until dismissed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/workspace.html");
  await expect(page.locator(".ProseMirror h1")).toHaveText("Main page");
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 60_000);
  await page.evaluate(() => {
    window.mintWorkspaceFixture.notify("Info", "info");
    window.mintWorkspaceFixture.notify("Warning", "warning");
    window.mintWorkspaceFixture.notify("Critical", "critical");
  });
  const notices = page.locator(".toast-notice:not([data-ending-style])");
  await expect(notices).toHaveText(["Info", "Warning", "Critical"]);
  await page.clock.runFor(3900);
  await expect(notices).toHaveCount(3);
  await page.clock.runFor(200);
  await expect(notices).toHaveText(["Warning", "Critical"]);
  await page.clock.runFor(2800);
  await expect(notices).toHaveCount(2);
  await page.clock.runFor(200);
  await expect(notices).toHaveText(["Critical"]);
  await page.clock.runFor(10000);
  await expect(notices).toHaveCount(1);
  await notices.getByRole("button", { name: "Close notification" }).click();
  await expect(notices).toHaveCount(0);
});
