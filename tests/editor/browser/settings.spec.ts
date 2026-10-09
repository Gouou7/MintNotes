import { expect, test } from "@playwright/test";

test.use({
  deviceScaleFactor: 2,
  // Chromium rounds borders using its native scale, independently of emulated DPR.
  launchOptions: async ({ browserName, launchOptions }, use) => use(browserName === "chromium" ? { ...launchOptions, args: [...(launchOptions.args ?? []), "--force-device-scale-factor=2"] } : launchOptions),
});

for (const [name, width, height] of [["desktop", 1445, 956], ["tablet", 834, 1112], ["mobile", 320, 568]] as const) {
  test(`${name} settings text buttons follow the Sketch colors and typography`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.route("**/api/**", route => route.fulfill({ json: { days: 30 } }));
    await page.goto("/settings.html");
    for (const theme of ["dark", "light"]) {
      await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
      const primary = page.getByRole("button", { name: "Edit profile", exact: true });
      const danger = page.getByRole("button", { name: "Log out", exact: true });
      for (const button of [primary, danger]) {
        await expect(button).toHaveCSS("height", "30px");
        await expect(button).toHaveCSS("border-radius", "8px");
        await expect(button).toHaveCSS("border-top-width", "0px");
        await expect(button).toHaveCSS("font-weight", "600");
        await expect(button.locator("svg")).toHaveCSS("width", "16px");
      }
      await expect(primary).toHaveCSS("background-color", theme === "dark" ? "rgb(97, 210, 153)" : "rgb(97, 210, 160)");
      await expect(primary).toHaveCSS("color", "rgba(0, 0, 0, 0.9)");
      await expect(danger).toHaveCSS("color", "rgba(255, 93, 93, 0.9)");
      await expect(danger).toHaveCSS("background-color", theme === "dark" ? "rgba(255, 93, 93, 0.1)" : "rgba(255, 93, 93, 0.2)");
      await danger.hover();
      await expect(danger).toHaveCSS("background-color", theme === "dark" ? "rgba(255, 93, 93, 0.2)" : "rgba(255, 93, 93, 0.3)");
      await page.mouse.down();
      await expect(danger).toHaveCSS("background-color", theme === "dark" ? "rgba(255, 93, 93, 0.3)" : "rgba(255, 93, 93, 0.4)");
      const chrome = (await page.locator(".settings-header").boundingBox())!;
      await page.mouse.move(chrome.x + 10, chrome.y + chrome.height / 2); await page.mouse.up(); await danger.blur();
      await expect(danger).toHaveCSS("background-color", theme === "dark" ? "rgba(255, 93, 93, 0.1)" : "rgba(255, 93, 93, 0.2)");
      await page.locator(".settings-content").evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: testInfo.outputPath(`settings-buttons-${name}-${theme}.png`) });

      await primary.click();
      const profile = page.getByRole("dialog", { name: "Edit profile", exact: true });
      const normal = profile.getByRole("button", { name: "Upload avatar", exact: true });
      await expect(normal).toHaveCSS("height", "30px");
      await expect(normal).toHaveCSS("border-top-width", "0px");
      await expect(normal).toHaveCSS("border-radius", "8px");
      await expect(normal).toHaveCSS("font-weight", "600");
      await expect(normal).toHaveCSS("color", theme === "dark" ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 0, 0, 0.9)");
      await expect(normal).toHaveCSS("background-color", theme === "dark" ? "color(srgb 1 1 1 / 0.1)" : "color(srgb 0 0 0 / 0.1)");
      await expect(profile.getByRole("button", { name: "Change name", exact: true })).toBeDisabled();
      await expect(profile.getByRole("button", { name: "Change name", exact: true })).toHaveCSS("opacity", "0.45");
      await page.screenshot({ path: testInfo.outputPath(`settings-profile-buttons-${name}-${theme}.png`) });
      await profile.getByRole("button", { name: "Close", exact: true }).first().click();
      await expect(profile).toHaveCount(0);
    }
  });

  test(`${name} first settings load uses the themed window and remains dismissible`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"]) {
      await page.goto(`/settings.html?loading&offline&theme=${theme}`);
      const modal = page.locator(".settings-modal"), header = page.locator(".settings-header");
      await expect(page.locator(".settings-loading-content")).toHaveAttribute("aria-busy", "true");
      await expect(modal).toHaveCSS("background-color", theme === "light" ? "rgb(255, 255, 255)" : "rgb(24, 24, 24)");
      await expect(header).toHaveCSS("border-bottom-color", theme === "light" ? "rgb(226, 226, 226)" : "rgb(51, 51, 51)");
      await expect(header).toHaveCSS("border-bottom-width", "0.5px");
      await expect(header).toHaveCSS("backdrop-filter", "blur(25px)");
      await expect(header).toHaveCSS("background-color", theme === "light" ? "color(srgb 0 0 0 / 0.05)" : "color(srgb 0 0 0 / 0.3)");
      await expect(page.locator(".settings-backdrop")).toHaveCSS("backdrop-filter", "blur(5px)");
      const bounds = (await modal.boundingBox())!, headerBounds = (await header.boundingBox())!;
      if (name !== "mobile") {
        expect(bounds.width).toBe(Math.min(798, width - 40)); expect(bounds.height).toBe(598);
        await expect(modal).toHaveCSS("border-radius", "20px");
        if (theme === "light") await expect(page.locator(".settings-sidebar")).toHaveCSS("background-color", "rgb(246, 246, 246)");
      } else {
        expect(bounds).toEqual({ x: 0, y: 0, width, height });
      }
      const spinnerBounds = (await page.locator(".settings-loading-content .spinner").boundingBox())!;
      expect(spinnerBounds.y).toBeGreaterThan(headerBounds.y + headerBounds.height);
      expect(spinnerBounds.y + spinnerBounds.height).toBeLessThan(bounds.y + bounds.height);
      await page.screenshot({ path: testInfo.outputPath(`settings-loading-${name}-${theme}.png`) });
      await page.evaluate(() => window.mintSettingsFixture.finishLoading());
      await expect(page.locator(".settings-loading-content")).toHaveCount(0);
      await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toBeVisible();
      expect(await modal.boundingBox()).toEqual(bounds);
      expect(await header.boundingBox()).toEqual(headerBounds);
    }
    await page.goto("/settings.html?loading&offline&theme=light");
    await expect(page.locator(".settings-loading-content")).toBeVisible();
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toHaveCount(0);
    await page.evaluate(() => window.mintSettingsFixture.finishLoading());
    await expect(page.locator(".settings-modal")).toHaveCount(0);
  });

  test(`${name} settings retain theme outlines, fixed glass chrome and reachable controls`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.route("**/api/**", route => route.fulfill({ json: { days: 30, endpoints: [], inactiveRetentionDays: 30, canRevokeOthers: true, users: [], setups: [] } }));
    await page.goto("/settings.html");
    const modal = page.locator(".settings-modal"), header = page.locator(".settings-header"), tabs = page.locator(".settings-tabs"), content = page.locator(".settings-content");
    const themeSelect = page.getByRole("combobox", { name: "Theme", exact: true });
    for (const theme of ["light", "dark", "light"]) {
      await page.getByRole("button", { name: "General", exact: true }).click();
      await themeSelect.selectOption(theme);
      const outline = theme === "light" ? "rgb(226, 226, 226)" : "rgb(51, 51, 51)";
      await expect(modal).toHaveCSS("background-color", theme === "light" ? "rgb(255, 255, 255)" : "rgb(24, 24, 24)");
      await expect(header).toHaveCSS("border-bottom-color", outline);
      await expect(header).toHaveCSS("border-bottom-width", "0.5px");
      await expect(header).toHaveCSS("backdrop-filter", "blur(25px)");
      await expect(header).toHaveCSS("background-color", theme === "light" ? "color(srgb 0 0 0 / 0.05)" : "color(srgb 0 0 0 / 0.3)");
      await expect(page.locator(".note-pane-top")).toHaveCSS("backdrop-filter", "blur(12px)");
      await expect(page.locator(".settings-backdrop")).toHaveCSS("backdrop-filter", "blur(5px)");
      const bounds = (await modal.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
      if (name === "mobile") {
        await expect(modal).toHaveCSS("border-top-width", "0px");
        await expect(tabs).toHaveCSS("border-bottom-color", outline);
        await expect(tabs).toHaveCSS("border-bottom-width", "0.5px");
        expect(await tabs.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
        await expect(tabs).toHaveCSS("backdrop-filter", "blur(25px)");
      } else {
        expect(bounds.width).toBe(Math.min(798, width - 40)); expect(bounds.height).toBe(598);
        await expect(modal).toHaveCSS("border-top-color", outline);
        await expect(modal).toHaveCSS("border-radius", "20px");
        await expect(page.locator(".settings-sidebar")).toHaveCSS("border-right-color", outline);
        await expect(page.locator(".settings-sidebar")).toHaveCSS("border-right-width", "0.5px");
        if (theme === "light") await expect(page.locator(".settings-sidebar")).toHaveCSS("background-color", "rgb(246, 246, 246)");
        expect((await page.locator(".settings-sidebar").boundingBox())!.width).toBe(200);
      }
      await page.screenshot({ path: testInfo.outputPath(`settings-${name}-${theme}.png`) });
      await page.getByRole("button", { name: "Security", exact: true }).click();
      await expect(content.getByText(/Signed-out and expired device records/)).toBeVisible();
      const chromeBounds = await header.boundingBox(), tabBounds = await tabs.boundingBox();
      await content.evaluate(element => { element.scrollTop = element.scrollHeight; });
      expect(await content.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      expect(await header.boundingBox()).toEqual(chromeBounds); expect(await tabs.boundingBox()).toEqual(tabBounds);
      const lastControl = content.getByRole("button", { name: "Reset recovery key", exact: true });
      await lastControl.focus();
      const controlBounds = (await lastControl.boundingBox())!;
      expect(controlBounds.y).toBeGreaterThanOrEqual(name === "mobile" ? tabBounds!.y + tabBounds!.height : chromeBounds!.y + chromeBounds!.height);
      expect(controlBounds.y + controlBounds.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await expect(modal).toHaveCount(0);
  });
}

test("offline settings keep the notice below the chrome and honor reduced transparency", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings.html?offline");
  const notice = page.locator(".settings-content > .auth-guidance"), tabs = page.locator(".settings-tabs");
  await expect(notice).toBeVisible();
  expect((await notice.boundingBox())!.y).toBeGreaterThan((await tabs.boundingBox())!.y + (await tabs.boundingBox())!.height);
  await page.emulateMedia({ forcedColors: "active" });
  for (const selector of [".settings-header", ".settings-tabs", ".settings-backdrop"]) {
    await expect(page.locator(selector)).toHaveCSS("backdrop-filter", "none");
  }
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(page.locator(".settings-modal")).toHaveCount(0);
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
  const logout = page.getByRole("button", { name: "Log out", exact: true });
  await toggle.focus(); await page.keyboard.press(tabKey);
  await expect(logout).toBeFocused(); await expect(logout).toHaveCSS("outline-width", "2px");
  await expect(logout).toHaveCSS("outline-color", "rgb(21, 21, 21)");
});
