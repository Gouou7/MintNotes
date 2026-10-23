import { expect, test, type Locator } from "@playwright/test";

const tabs = ["Appearance", "Account and security", "Notes and storage", "Administrator settings", "About"];
const database = { databaseBytes: 83886080, walBytes: 4194304, shmBytes: 32768, backupsBytes: 167772160,
  reusableBytes: 1048576, logicalBytes: 52428800, userCount: 1, sqliteVersion: "3.50.0", schemaVersion: 4,
  journalMode: "wal", checkedAt: "2026-10-23T10:30:00Z", available: true };

async function expectInlineQuota(fields: Locator) {
  const select = fields.locator("select");
  await select.selectOption("custom");
  const input = fields.locator("input[type=number]");
  await input.fill("200");
  await expect(select).toHaveValue("custom");
  const [choice, capacity] = await Promise.all([select.boundingBox(), input.boundingBox()]);
  expect(Math.abs(choice!.y - capacity!.y)).toBeLessThanOrEqual(2);
  expect(capacity!.x).toBeGreaterThanOrEqual(choice!.x + choice!.width);
  expect(await fields.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: route.request().url().endsWith("/admin/storage") ? database : {
    days: 30, endpoints: [], connections: [], inactiveRetentionDays: 30, canRevokeOthers: true,
    users: [{ id: "fixture-user", username: "mint", displayName: "Mint Notes", role: "admin", disabled: false,
      totalBytes: 389021696, encryptedBytes: 389021696, quotaMode: "inherit", quotaBytes: 2147483648 }], setups: [],
  } }));
});

for (const [name, width, height] of [["desktop", 1440, 1000], ["tablet", 834, 1112], ["mobile", 320, 568]] as const) {
  test(`${name} all settings pages share readable sections and reachable actions in both themes`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.goto("/settings.html");
    const content = page.locator(".settings-content"), header = page.locator(".settings-header");
    await expect(page.locator(".settings-tabs button")).toHaveText(tabs);
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "Appearance", exact: true }).click();
      await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
      const fontSize = page.getByRole("combobox", { name: "Font size", exact: true });
      await expect(fontSize.locator("option")).toHaveText(["11 (Small)", "12", "13", "14 (Default)", "15", "16", "17 (Large)"]);
      for (const size of ["11", "17", "14"]) {
        await fontSize.selectOption(size); await expect(fontSize).toHaveValue(size);
        await expect(fontSize).toHaveCSS("font-size", `${size}px`);
        await expect(content.locator(".settings-control-row > span").first()).toHaveCSS("font-size", `${size}px`);
        await expect(page.locator(".settings-tabs button").first()).toHaveCSS("font-size", `${size}px`);
        await expect(page.locator(".settings-tabs button").first()).toHaveCSS("font-weight", "700");
        await expect(content.locator("h3").first()).toHaveCSS("font-size", `${Number(size) + 2}px`);
        await expect(content.locator(".settings-page-title")).toHaveCSS("font-size", `${Number(size) + 10}px`);
      }
      for (const title of tabs) {
        const nav = page.locator(".settings-tabs").getByRole("button", { name: title, exact: true });
        await nav.click();
        await expect(nav).toHaveAttribute("aria-current", "page");
        await expect(nav).toHaveCSS("font-weight", "700");
        for (const inactive of await page.locator(".settings-tabs button:not(.active)").all()) {
          await expect(inactive).toHaveCSS("font-weight", "400");
        }
        expect(await nav.evaluate(element => {
          const sample = document.createElement("span"); sample.style.color = "var(--accent-text)"; element.append(sample);
          const expected = getComputedStyle(sample).color; sample.remove(); return getComputedStyle(element).color === expected;
        })).toBe(true);
        if (title === "Appearance") await expect(content.locator(".profile-summary")).toHaveCount(0);
        if (title === "Account and security") await expect(content.locator(".security-settings > .profile-summary").first()).toContainText("Mint Notes");
        await expect(content.locator(".settings-page-title")).toHaveText(title);
        // Resolve the shared neutral color through CSS rather than comparing color syntax.
        expect(await nav.evaluate(element => {
          const sample = document.createElement("span"); sample.style.background = "var(--button-hover)"; element.append(sample);
          const expected = getComputedStyle(sample).backgroundColor; sample.remove();
          return getComputedStyle(element).backgroundColor === expected;
        })).toBe(true);
        if (name === "mobile") {
          const padding = await page.locator(".settings-tabs").evaluate(element => { const style = getComputedStyle(element); return [style.paddingTop, style.paddingBottom]; });
          expect(padding[0]).toBe(padding[1]);
          expect(parseFloat(padding[0])).toBeGreaterThan(0);
          await expect(page.locator(".settings-sidebar")).toHaveCSS("backdrop-filter", "blur(25px)");
        } else await expect(header).toHaveCSS("backdrop-filter", "blur(25px)");
        expect(await content.evaluate(element => element.scrollTop)).toBe(0);
        await expect(content.locator(".settings-card").first()).toBeVisible();
        if (title === "Administrator settings") await expect(page.locator(".database-storage")).toContainText("Database available");
        expect(await content.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        // Individual cards must stay within the scroll surface, including forms and counts.
        expect(await content.locator(".settings-card").evaluateAll(cards => cards.every(card => card.scrollWidth <= card.clientWidth + 1))).toBe(true);
        if (title === "Notes and storage") {
          const counts = content.locator(".storage-pending-item");
          await expect(counts).toHaveCount(3);
          expect(await counts.evaluateAll(items => items.every((item, i) => !i || item.getBoundingClientRect().left - items[i - 1].getBoundingClientRect().right >= 15))).toBe(true);
          await expect(counts.locator("strong")).toHaveText(["12", "3", "24"]);
          await expect(counts.first().locator("span")).toHaveCSS("font-size", "14px");
          const historyQuota = content.locator(".history-budget .quota-fields");
          await expect(historyQuota.locator("option")).toHaveText(["Unlimited", "100MiB", "200MiB", "500MiB", "Custom"]);
          await expectInlineQuota(historyQuota);
          const saveQuota = content.locator(".history-budget").getByRole("button", { name: "Save quota", exact: true });
          const [controls, save] = await Promise.all([historyQuota.locator(".quota-controls").boundingBox(), saveQuota.boundingBox()]);
          expect(save!.x).toBeGreaterThanOrEqual(controls!.x + controls!.width);
          expect(Math.abs(save!.y + save!.height / 2 - controls!.y - controls!.height / 2)).toBeLessThanOrEqual(2);
          await expect(saveQuota).toHaveText(width <= 720 ? "Save" : "Save quota", { useInnerText: true });
          await expect(saveQuota).toHaveCSS("font-size", "14px");
          await expect(saveQuota).toHaveCSS("font-weight", "700");
          await expect(saveQuota).not.toHaveClass(/primary/);
          expect(save!.width).toBeLessThan(controls!.width);
          await page.screenshot({ path: info.outputPath(`${name}-${theme}-history-custom.png`) });
          await content.evaluate(element => { element.scrollTop = 0; });
        }
        if (title === "Administrator settings") {
          const newQuota = content.locator(".admin-create .quota-fields");
          await expect(newQuota.locator("option")).toHaveText(["Unlimited", "100MiB", "200MiB", "500MiB", "1GiB", "2GiB", "Custom"]);
          await page.getByRole("button", { name: "Edit quota", exact: true }).first().click();
          const dialog = page.locator(".quota-dialog");
          await expectInlineQuota(dialog.locator(".quota-fields"));
          await page.screenshot({ path: info.outputPath(`${name}-${theme}-quota-custom.png`) });
          await dialog.getByRole("button", { name: "Close", exact: true }).click();
          await content.evaluate(element => { element.scrollTop = 0; });
        }
        await page.screenshot({ path: info.outputPath(`${name}-${theme}-${title.replaceAll(" ", "-")}.png`) });
        const chrome = await header.boundingBox(), titleBefore = (await content.locator(".settings-page-title").boundingBox())!;
        await content.evaluate(element => { element.scrollTop = element.scrollHeight; });
        expect(await header.boundingBox()).toEqual(chrome);
        const scrolled = await content.evaluate(element => element.scrollTop);
        expect((await content.locator(".settings-page-title").boundingBox())!.y).toBeCloseTo(titleBefore.y - scrolled, 0);
        const last = content.locator("button:not(:disabled)").last();
        if (await last.count()) {
          await last.focus();
          const action = (await last.boundingBox())!, modal = (await page.locator(".settings-modal").boundingBox())!;
          expect(action.y + action.height).toBeLessThanOrEqual(modal.y + modal.height);
          expect(action.y).toBeGreaterThanOrEqual(chrome!.y + chrome!.height);
        }
      }
    }
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("combobox", { name: "Font size", exact: true }).selectOption("17");
    for (const title of tabs) {
      await page.locator(".settings-tabs").getByRole("button", { name: title, exact: true }).click();
      if (title === "Administrator settings") await expect(page.locator(".database-storage")).toContainText("Database available");
      expect(await content.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await content.locator(".settings-card").evaluateAll(cards => cards.every(card => card.scrollWidth <= card.clientWidth + 1))).toBe(true);
      for (const button of await content.locator(".settings-action-button").all()) {
        await expect(button).toHaveCSS("font-size", "17px");
        await expect(button).toHaveCSS("font-weight", "700");
      }
      if (title === "Notes and storage") {
        const labels = content.locator(".storage-pending-item > span");
        expect(await labels.evaluateAll(items => items.every(label => label.getBoundingClientRect().right <= label.parentElement!.getBoundingClientRect().right + 1))).toBe(true);
        await expectInlineQuota(content.locator(".history-budget .quota-fields"));
      }
      await page.screenshot({ path: info.outputPath(`${name}-large-${title.replaceAll(" ", "-")}.png`) });
    }
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("combobox", { name: "Font size", exact: true }).selectOption("14");
    await page.getByRole("button", { name: "Account and security", exact: true }).click();
    await page.getByRole("button", { name: "Edit profile", exact: true }).click();
    const profile = page.getByRole("dialog", { name: "Edit profile", exact: true });
    await expect(profile.getByRole("button", { name: "Upload avatar", exact: true })).toBeVisible();
    await profile.getByRole("button", { name: "Close", exact: true }).first().click();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    const logout = page.getByRole("dialog", { name: "Log out of this device?", exact: true });
    await expect(logout.locator(".storage-pending-item strong")).toHaveText(["12", "3", "24"]);
    await logout.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await expect(page.locator(".settings-modal")).toHaveCount(0);
  });

  test(`${name} loading keeps the window stable and can be dismissed`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/settings.html?loading&offline&theme=light");
    const modal = page.locator(".settings-modal");
    await expect(page.locator(".settings-loading-content")).toHaveAttribute("aria-busy", "true");
    const bounds = await modal.boundingBox();
    await page.evaluate(() => window.mintSettingsFixture.finishLoading());
    await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toBeVisible();
    expect(await modal.boundingBox()).toEqual(bounds);
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await expect(modal).toHaveCount(0);
    await page.goto("/settings.html?loading&offline");
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await page.evaluate(() => window.mintSettingsFixture.finishLoading());
    await expect(modal).toHaveCount(0);
  });
}

test("offline settings retain a visible notice and respect forced colors", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings.html?offline");
  const notice = page.locator(".settings-content > .auth-guidance");
  await expect(notice).toBeVisible();
  expect((await notice.boundingBox())!.y).toBeGreaterThan((await page.locator(".settings-header").boundingBox())!.y);
  await page.emulateMedia({ forcedColors: "active" });
  for (const selector of [".settings-header", ".settings-sidebar", ".settings-backdrop"]) await expect(page.locator(selector)).toHaveCSS("backdrop-filter", "none");
});

test("settings controls distinguish switch states and keep theme borders and keyboard focus visible", async ({ page, browserName }) => {
  await page.goto("/settings.html?offline");
  const themeSelect = page.getByRole("combobox", { name: "Theme", exact: true });
  const toggle = page.getByRole("switch", { name: "Wrap code blocks", exact: true });
  const track = page.locator(".settings-switch-track");
  const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab", backTabKey = browserName === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab";
  const contrast = async (kind: "switch" | "select") => page.evaluate(kind => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const rgba = (value: string) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map((value, index) => index === 3 ? value / 255 : value);
    };
    const luminance = (color: number[]) => color.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
    const ratio = (first: number[], second: number[]) => (Math.max(luminance(first), luminance(second)) + .05) / (Math.min(luminance(first), luminance(second)) + .05);
    const surface = rgba(getComputedStyle(document.querySelector(".settings-modal")!).backgroundColor);
    if (kind === "switch") {
      const track = document.querySelector(".settings-switch-track")!;
      const style = getComputedStyle(track), thumb = getComputedStyle(track, "::after");
      const background = rgba(style.backgroundColor);
      return [ratio(background, surface), ratio(rgba(style.borderColor), surface), ratio(rgba(thumb.backgroundColor), background), ratio(rgba(style.outlineColor), surface)];
    }
    const style = getComputedStyle([...document.querySelectorAll(".settings-content select")].find(element => element.closest("label")?.textContent?.startsWith("Theme"))!);
    return [ratio(rgba(style.color), rgba(style.backgroundColor)), ratio(rgba(style.outlineColor), surface)];
  }, kind);
  for (const theme of ["light", "dark"]) {
    await themeSelect.selectOption(theme);
    await expect(toggle).not.toBeChecked();
    for (const select of await page.locator(".settings-content select").all()) await expect(select).toHaveCSS("border-top-color", theme === "light" ? "rgb(226, 226, 226)" : "rgb(51, 51, 51)");
    await themeSelect.focus(); await page.keyboard.press(tabKey); await page.keyboard.press(backTabKey);
    await expect(themeSelect).toBeFocused(); await expect(themeSelect).toHaveCSS("outline-width", "2px");
    const [text, selectFocus] = await contrast("select");
    expect(text).toBeGreaterThanOrEqual(4.5);
    expect(selectFocus).toBeGreaterThanOrEqual(3);
    // Keyboard focus stays visible independently of the decorative pane outline.
    await toggle.focus(); await page.keyboard.press(tabKey); await page.keyboard.press(backTabKey);
    await expect(toggle).toBeFocused(); await expect(track).toHaveCSS("outline-width", "2px");
    const [, , , switchFocus] = await contrast("switch");
    expect(switchFocus).toBeGreaterThanOrEqual(3);
    await expect(track).toHaveCSS("width", "42px"); await expect(track).toHaveCSS("height", "24px");
    await expect(track).toHaveCSS("border-width", "0px");
    const thumb = () => track.evaluate(element => {
      const style = getComputedStyle(element, "::after");
      return { width: style.width, height: style.height, top: style.top, left: style.left, color: style.backgroundColor, shadow: style.boxShadow, transform: style.transform };
    });
    expect(await thumb()).toEqual({ width: "18px", height: "18px", top: "3px", left: "3px", color: "rgb(255, 255, 255)", shadow: "none", transform: "none" });
    await toggle.press("Space"); await expect(toggle).toBeChecked();
    await expect(track).toHaveCSS("background-color", theme === "light" ? "rgb(97, 210, 160)" : "rgb(97, 210, 153)");
    await expect.poll(thumb).toEqual({ width: "18px", height: "18px", top: "3px", left: "3px", color: "rgb(255, 255, 255)", shadow: "none", transform: "matrix(1, 0, 0, 1, 18, 0)" });
    await toggle.press("Space"); await expect(toggle).not.toBeChecked();
    await expect(track).toHaveCSS("background-color", theme === "light" ? "rgb(215, 215, 215)" : "rgb(54, 54, 54)");
  }
  await themeSelect.selectOption("light");
  await page.getByRole("button", { name: "Account and security", exact: true }).click();
  const logout = page.getByRole("button", { name: "Log out", exact: true });
  await logout.focus(); await page.keyboard.press(backTabKey); await page.keyboard.press(tabKey);
  await expect(logout).toBeFocused(); await expect(logout).toHaveCSS("outline-width", "2px");
  await expect(logout).toHaveCSS("outline-color", "rgb(21, 21, 21)");
});
