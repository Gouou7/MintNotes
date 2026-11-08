import { expect, test } from "@playwright/test";

const activeToast = "[data-sonner-toast]:not([data-removed=true], :has([data-toast-cleared]))";

for (const [name, width, height] of [["desktop", 1445, 956], ["mobile", 320, 568]] as const) {
  test(`${name} notifications enter at the bottom center within safe areas`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/workspace.html");
    await expect(page.getByRole("button", { name: "Source", exact: true })).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-area-bottom", "24px");
      document.documentElement.style.setProperty("--safe-area-right", "20px");
      window.mintWorkspaceFixture.notify("A longer warning that should wrap within the notification.", "warning");
    });
    const stack = page.locator("[data-sonner-toaster]");
    const notice = page.locator(activeToast);
    await expect(stack).toHaveAttribute("data-x-position", "center");
    await expect(stack).toHaveAttribute("data-y-position", "bottom");
    await expect(notice).toHaveAttribute("data-mounted", "true");
    await expect(notice).toHaveCSS("border-radius", "14px");
    const box = (await notice.boundingBox())!;
    expect(height - box.y - box.height).toBeCloseTo(64, 0);
    expect(box.x + box.width / 2).toBeCloseTo(width / 2, 0);
    expect(box.x).toBeGreaterThanOrEqual(20);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 20);
    for (const [theme, color] of [["light", "rgb(108, 82, 12)"], ["dark", "rgb(244, 220, 138)"]] as const) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await expect(notice).toHaveCSS("color", color);
      await expect(notice).toHaveCSS("backdrop-filter", "blur(12px)");
    }
    await page.emulateMedia({ forcedColors: "active" });
    await expect(notice).toHaveCSS("backdrop-filter", "none");
    await expect(notice.locator("[data-close-button]")).toHaveCount(0);
    const close = notice.getByRole("button", { name: "Close", exact: true });
    const closeBox = (await close.boundingBox())!;
    expect(closeBox.x).toBeGreaterThanOrEqual(box.x);
    expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(box.x + box.width);
    await close.click();
    await expect(notice).toHaveCount(0);
    if (name === "desktop") {
      await page.mouse.move(0, 0);
      await page.evaluate(() => {
        window.mintWorkspaceFixture.notify("First notification", "critical");
        window.mintWorkspaceFixture.notify("Second notification", "critical");
      });
      await expect(notice).toHaveCount(2);
      await expect(notice.first()).toHaveAttribute("data-expanded", "false");
      await notice.first().hover();
      await expect(notice.last()).toHaveAttribute("data-expanded", "true");
      await page.mouse.move(0, 0);
      await expect(notice.first()).toHaveAttribute("data-expanded", "false");
    }
  });
}

test("notification actions fit narrow screens and remain clickable while settings is open", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/workspace.html");
  await page.getByRole("button", { name: "Open left sidebar" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.evaluate(() => window.mintWorkspaceFixture.notify("An action is available.", "critical", {
    label: "A long action label that wraps inside the notification",
    run: () => { document.body.dataset.actionRun = "true"; }
  }));
  const notice = page.locator(activeToast);
  const action = notice.getByRole("button", { name: "A long action label that wraps inside the notification" });
  await expect(action).toBeVisible();
  const box = (await notice.boundingBox())!, actionBox = (await action.boundingBox())!;
  expect(actionBox.x).toBeGreaterThanOrEqual(box.x);
  expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(box.x + box.width);
  await action.click();
  await expect(page.locator("body")).toHaveAttribute("data-action-run", "true");
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
});
