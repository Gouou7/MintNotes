import { expect, test, type Locator } from "@playwright/test";

const tabs = ["General", "Account and security", "Notes and storage", "Administrator settings", "About"];
const database = { databaseBytes: 83886080, walBytes: 4194304, shmBytes: 32768, backupsBytes: 167772160,
  reusableBytes: 1048576, logicalBytes: 52428800, userCount: 1, sqliteVersion: "3.50.0", schemaVersion: 4,
  journalMode: "wal", checkedAt: "2026-10-23T10:30:00Z", available: true };

test("the settings scrollbar starts below the glass header on wide and narrow layouts", async ({ page }) => {
  await page.goto("/settings.html");
  await page.getByRole("tab", { name: "Notes and storage" }).click();
  const viewport = page.locator(".settings-content");
  const track = page.locator(".settings-main [data-slot='scroll-area-scrollbar'][data-orientation='vertical']");
  const thumb = track.locator("[data-slot='scroll-area-thumb']");
  for (const width of [1440, 834, 390]) {
    await page.setViewportSize({ width, height: 568 });
    await viewport.evaluate(element => element.scrollTop = 0);
    await expect(thumb).toBeVisible();
    const header = page.locator(width > 720 ? ".settings-header" : ".settings-tabs");
    const box = (await header.boundingBox())!;
    expect((await track.boundingBox())!.y).toBeCloseTo(box.y + box.height, 0);
    await expect.poll(async () => (await thumb.boundingBox())!.y).toBeCloseTo(box.y + box.height, 0);
    await viewport.evaluate(element => element.scrollTop = 200);
    expect((await viewport.locator(".settings-page-title").boundingBox())!.y).toBeLessThan(box.y + box.height);
  }
});

async function chooseSetting(trigger: Locator, label: string) {
  await trigger.click();
  await trigger.page().getByRole("listbox").getByRole("option", { name: label, exact: true }).click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}

async function expectOptions(trigger: Locator, labels: string[]) {
  await trigger.click();
  await expect(trigger.page().getByRole("listbox").getByRole("option")).toHaveText(labels);
  await trigger.page().keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}

async function expectInlineQuota(fields: Locator) {
  const select = fields.getByRole("combobox");
  await chooseSetting(select, "Custom");
  const input = fields.locator("input[type=number]");
  await input.fill("200");
  await expect(select).toHaveText("Custom");
  const [choice, capacity] = await Promise.all([select.boundingBox(), fields.locator(".quota-custom").boundingBox()]);
  expect(Math.abs(choice!.y - capacity!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(choice!.height - capacity!.height)).toBeLessThanOrEqual(1);
  expect(capacity!.x).toBeGreaterThanOrEqual(choice!.x + choice!.width);
  expect(await fields.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: route.request().url().endsWith("/admin/storage") ? database : {
    activationCode: "fixture-activation-code", days: 30, endpoints: [], connections: [], inactiveRetentionDays: 30, canRevokeOthers: true,
    users: [{ id: "fixture-user", username: "mint", displayName: "Mint Notes", role: "admin", disabled: false,
      totalBytes: 389021696, encryptedBytes: 389021696, quotaMode: "inherit", quotaBytes: 2147483648 }], setups: [],
  } }));
});

for (const [name, width] of [["desktop", 1440], ["mobile", 320]] as const) {
  test(`${name} unlimited storage remains readable in Chinese with large text`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/settings.html?unlimited&language=zh-CN");
    await chooseSetting(page.getByRole("combobox", { name: "字体大小", exact: true }), "17（大）");
    await page.locator(".settings-tabs").getByRole("tab", { name: "用户和安全", exact: true }).click();
    const deviceSecurity = page.locator(".settings-group").filter({ has: page.getByRole("heading", { name: "本机安全", exact: true }) });
    await expect(deviceSecurity.locator(".settings-item-title")).toHaveText(["本机 PIN", "无操作后自动锁定"]);
    await deviceSecurity.screenshot({ path: info.outputPath(`${name}-device-security-zh.png`) });
    await page.locator(".settings-tabs").getByRole("tab", { name: "笔记和存储", exact: true }).click();
    const usage = page.locator(".storage-usage");
    await expect(usage.locator(".storage-total")).toContainText("配额：不限");
    await expect(usage.getByRole("progressbar")).toHaveCount(0);
    await expect(usage.locator(".storage-composition > span")).toHaveCount(3);
    await expect(usage.locator(".storage-categories dt")).toHaveText(["笔记", "附件", "笔记历史", "回收站"]);
    await expect(usage.locator(".storage-pending > div:last-child dd")).toHaveText("0 篇");
    await expect(usage.locator(".storage-pending-item strong")).toHaveText(["0", "0", "0"]);
    expect(await usage.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await usage.screenshot({ path: info.outputPath(`${name}-storage-zh.png`) });
    const history = page.locator(".history-usage");
    await expect(history.getByRole("progressbar")).toHaveCount(0);
    await expect(history.locator(".settings-help")).toHaveText("1.3 KiB / 不限 · 2 个版本");
    await expect(history.getByRole("button", { name: "清空全部历史" })).toBeEnabled();
    expect(await history.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await history.screenshot({ path: info.outputPath(`${name}-history-zh.png`) });
    await page.locator(".settings-tabs").getByRole("tab", { name: "管理员设置", exact: true }).click();
    const databaseSection = page.locator(".database-storage");
    await expect(databaseSection).toContainText("数据库连接正常");
    expect(await databaseSection.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await databaseSection.screenshot({ path: info.outputPath(`${name}-database-zh.png`) });
  });
}

for (const [name, width, height] of [["desktop", 1440, 1000], ["tablet", 834, 1112], ["mobile", 320, 568]] as const) {
  test(`${name} all settings pages share readable sections and reachable actions in both themes`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.goto("/settings.html");
    const content = page.locator(".settings-content"), header = page.locator(".settings-header");
    await expect(page.locator(".settings-backdrop")).toHaveCSS("backdrop-filter", "blur(4px)");
    await expect(page.locator(".settings-tabs button")).toHaveText(tabs);
    await expect(page.locator(".settings-tabs")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.locator(".settings-tabs")).toHaveAttribute("data-orientation", width <= 720 ? "horizontal" : "vertical");
    if (width > 720) {
      for (const button of await page.locator(".settings-tabs button").all()) {
        await expect(button).toBeInViewport();
        expect((await button.boundingBox())!.height).toBeLessThanOrEqual(64);
      }
    }
    for (const theme of ["light", "dark"]) {
      await page.getByRole("tab", { name: "General", exact: true }).click();
      await chooseSetting(page.getByRole("combobox", { name: "Theme", exact: true }), theme === "dark" ? "Dark" : "Light");
      const fontSize = page.getByRole("combobox", { name: "Font size", exact: true });
      await expectOptions(fontSize, ["11 (Small)", "12", "13", "14 (Default)", "15", "16", "17 (Large)"]);
      for (const [size, label] of [["11", "11 (Small)"], ["17", "17 (Large)"], ["14", "14 (Default)"]]) {
        await chooseSetting(fontSize, label); await expect(fontSize).toHaveText(label);
        await expect(fontSize).toHaveCSS("font-size", `${size}px`);
        await expect(content.locator(".settings-item-title").first()).toHaveCSS("font-size", `${size}px`);
        await expect(page.locator(".settings-tabs button").first()).toHaveCSS("font-size", `${size}px`);
        await expect(content.locator("h3").first()).toHaveCSS("font-size", `${Number(size) + 2}px`);
        await expect(content.locator(".settings-page-title")).toHaveCSS("font-size", `${Number(size) + 10}px`);
      }
      await page.getByRole("tab", { name: "About", exact: true }).click();
      for (const title of tabs) {
        const nav = page.locator(".settings-tabs").getByRole("tab", { name: title, exact: true });
        await nav.click();
        await expect(nav).toHaveAttribute("aria-selected", "true");
        if (title === "General") await expect(content.locator(".profile-summary")).toHaveCount(0);
        if (title === "Account and security") {
          await expect(content.locator(".security-settings > .profile-summary").first()).toContainText("Mint Notes");
          const pin = content.locator(".settings-item").filter({ has: page.getByRole("button", { name: "Set PIN", exact: true }) });
          await expect(content.locator(".security-settings > .settings-group > h3")).toHaveText(["Account credentials", "Device security", "Login devices", "Application connections"]);
          const row = (await pin.boundingBox())!, action = (await pin.getByRole("button", { name: "Set PIN", exact: true }).boundingBox())!;
          expect(Math.abs(row.x + row.width - action.x - action.width)).toBeLessThanOrEqual(1);
          if (name === "desktop") {
            const description = (await pin.locator(".settings-item-copy").boundingBox())!;
            expect(description.x + description.width).toBeLessThanOrEqual(action.x);
            expect(Math.abs(description.y + description.height / 2 - action.y - action.height / 2)).toBeLessThanOrEqual(1);
          }
        }
        await expect(content.locator(".settings-page-title")).toHaveText(title);
        // Section headings are above the rounded card rather than inside its surface.
        expect(await content.locator(".settings-group").evaluateAll(groups => groups.every(group => {
          const heading = group.querySelector(":scope > h3")!;
          const card = group.querySelector(":scope > .settings-card")!;
          return heading.getBoundingClientRect().bottom <= card.getBoundingClientRect().top;
        }))).toBe(true);
        expect(await content.locator("button").evaluateAll(buttons => buttons.every(button => button.closest(".settings-card")))).toBe(true);
        expect(await content.locator(".settings-card h3").evaluateAll(headings => headings.every(heading => heading.closest(".about-overview")))).toBe(true);
        const logoutButton = page.locator(".settings-logout-section button");
        await expect(logoutButton).toBeVisible();
        const logoutBounds = (await logoutButton.boundingBox())!;
        const modalBounds = (await page.locator(".settings-modal").boundingBox())!;
        const contentBounds = (await content.boundingBox())!;
        if (name === "mobile") {
          expect(logoutBounds.y).toBeGreaterThanOrEqual(contentBounds.y + contentBounds.height);
        } else {
          expect(logoutBounds.x + logoutBounds.width).toBeLessThanOrEqual(contentBounds.x);
        }
        expect(logoutBounds.y + logoutBounds.height).toBeLessThanOrEqual(modalBounds.y + modalBounds.height);

        await expect(nav).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        if (name === "mobile") {
          const padding = await page.locator(".settings-tabs").evaluate(element => { const style = getComputedStyle(element); return [style.paddingTop, style.paddingBottom]; });
          expect(padding[0]).toBe(padding[1]);
          expect(parseFloat(padding[0])).toBeGreaterThan(0);
          await expect(page.locator(".settings-sidebar")).toHaveCSS("backdrop-filter", "blur(25px)");
        } else {
          await expect(header).toHaveCSS("backdrop-filter", "blur(25px)");
          const headerBounds = (await header.boundingBox())!;
          expect(Math.abs(headerBounds.x - contentBounds.x)).toBeLessThanOrEqual(1);
        }
        expect(await content.evaluate(element => element.scrollTop)).toBe(0);
        await expect(content.locator(".settings-card").first()).toBeVisible();
        if (title === "Administrator settings") await expect(page.locator(".database-storage")).toContainText("Database available");
        expect(await content.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        // Individual cards must stay within the scroll surface, including forms and counts.
        expect(await content.locator(".settings-card").evaluateAll(cards => cards.every(card => card.scrollWidth <= card.clientWidth + 1))).toBe(true);
        // Every setting has a name. Supporting text shares one smaller, muted style and spacing.
        expect(await content.locator(".settings-item").evaluateAll(items => items.every(item => {
          const title = item.querySelector(".settings-item-title")!;
          const copy = item.querySelector(".settings-item-copy")!;
          const description = item.querySelector(".settings-item-description");
          return Boolean(title.textContent?.trim()) && (!description || (
            parseFloat(getComputedStyle(description).fontSize) < parseFloat(getComputedStyle(title).fontSize)
            && getComputedStyle(description).color !== getComputedStyle(title).color
            && getComputedStyle(copy).rowGap === "4px"));
        }))).toBe(true);
        for (const action of await content.locator(".settings-action-button").all()) {
          await expect(action.locator(":scope > svg")).toHaveCount(1);
          if ((await action.getAttribute("class"))?.includes("settings-icon-button")) {
            await expect(action).toHaveText("");
            await expect(action).toHaveAccessibleName(/.+/);
            const bounds = (await action.boundingBox())!;
            expect(bounds.width).toBeCloseTo(bounds.height, 2);
          } else expect((await action.textContent())?.trim()).toBeTruthy();
        }
        if (name !== "mobile") {
          const close = (await header.locator("button").boundingBox())!, modal = (await page.locator(".settings-modal").boundingBox())!;
          expect(modal.x + modal.width - close.x - close.width).toBeLessThanOrEqual(10);
          expect(close.y - modal.y).toBeLessThanOrEqual(10);
        }
        if (title === "Notes and storage") {
          await expect(content.locator(".storage-categories dt")).toHaveText(["Notes", "Attachments", "Note history", "Avatar", "Trash"]);
          await expect(content.locator(".storage-categories dd")).toHaveText(["8.0 MiB", "232.0 MiB", "115.0 MiB", "1.0 MiB", "15.0 MiB"]);
          const categories = content.locator(".storage-categories");
          expect(await categories.locator(".storage-count-item").evaluateAll(items => items.every(item => item.querySelector("dt")!.getBoundingClientRect().right <= item.querySelector("dd")!.getBoundingClientRect().left))).toBe(true);
          const composition = content.locator(".storage-composition");
          expect((await content.locator(".storage-quota-progress").boundingBox())!.height).toBe((await composition.boundingBox())!.height);
          expect(await composition.evaluate(element => Math.abs([...element.children].reduce((sum, segment) => sum + segment.getBoundingClientRect().width, 0) - element.clientWidth))).toBeLessThanOrEqual(1);
          await expect(content.locator(".history-settings details")).toHaveCount(0);
          await expect(content.getByRole("combobox", { name: "Note history quota", exact: true })).toBeVisible();
          await expect(content.locator(".history-settings .settings-item-description").first()).toBeVisible();
          await expect(content.locator(".history-settings .settings-item-description").first()).toHaveCSS("font-size", "12px");
          const historyEnabled = page.waitForRequest(request => request.url().endsWith("/api/account/note-history-settings") && request.method() === "PATCH" && request.postDataJSON().enabled === true);
          await content.locator(".history-settings [data-slot=switch]").click();
          await historyEnabled;
          await expect(content.locator(".trash-list")).toHaveCSS("border-top-width", "0px");
          await expect(content.locator(".trash-list")).toHaveCSS("border-radius", "0px");
          for (const row of await content.locator(".trash-row").all()) {
            await expect(row).toHaveCSS("border-top-width", "0px");
            expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
          }
          const counts = content.locator(".storage-pending-item");
          await expect(counts).toHaveCount(3);
          expect(await counts.evaluateAll(items => items.every((item, i) => !i || item.getBoundingClientRect().left - items[i - 1].getBoundingClientRect().right >= 11))).toBe(true);
          await expect(counts.locator("strong")).toHaveText(["12", "3", "24"]);
          await expect(counts.first().locator("span")).toHaveCSS("font-size", "12px");
          const historyQuota = content.locator(".history-budget .quota-fields");
          await expectOptions(historyQuota.getByRole("combobox"), ["Unlimited", "100MiB", "200MiB", "500MiB", "Custom"]);
          const quotaSaved = page.waitForRequest(request => request.url().endsWith("/api/account/note-history-settings") && request.method() === "PATCH" && request.postDataJSON().quotaBytes === 200 * 1048576);
          await expectInlineQuota(historyQuota);
          await quotaSaved;
          await expect(content.locator(".history-budget button:not([role=combobox])")).toHaveCount(0);
          const controls = await historyQuota.locator(".quota-controls").boundingBox();
          await expect(historyQuota.locator(".settings-item-title")).toHaveCSS("font-weight", "400");
          if (name !== "mobile") {
            const label = (await historyQuota.locator(".settings-item-copy").boundingBox())!;
            expect(label.x + label.width).toBeLessThanOrEqual(controls!.x);
            expect(Math.abs(label.y + label.height / 2 - controls!.y - controls!.height / 2)).toBeLessThanOrEqual(2);
            expect(controls!.width).toBeLessThanOrEqual(220);
          }
          const usage = content.locator(".history-usage");
          await expect(usage.locator(".settings-item-title")).toHaveText("Note history usage");
          await expect(usage.locator(".settings-help")).toHaveText("120.0 MiB / 256.0 MiB · 128 versions");
          await expect(usage.getByRole("progressbar")).toHaveCount(0);
          await expect(usage).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
          await expect(usage).toHaveCSS("padding", "0px");
          const clear = usage.getByRole("button", { name: "Clear all history", exact: true });
          await expect(clear).not.toHaveCSS("color", await logoutButton.evaluate(element => getComputedStyle(element).color));
          const [summary, clearBounds] = await Promise.all([usage.locator(".settings-item-copy").boundingBox(), clear.boundingBox()]);
          expect(clearBounds!.x >= summary!.x + summary!.width - 1 || clearBounds!.y >= summary!.y + summary!.height - 1).toBe(true);
          if (name === "desktop") {
            expect(clearBounds!.x).toBeGreaterThanOrEqual(summary!.x + summary!.width);
          }
          await usage.scrollIntoViewIfNeeded();
          await page.screenshot({ path: info.outputPath(`${name}-${theme}-history-usage.png`) });
          await expect(content.locator(".history-settings > .settings-section-heading")).toHaveCount(0);
          await page.screenshot({ path: info.outputPath(`${name}-${theme}-history-custom.png`) });
          await content.evaluate(element => { element.scrollTop = 0; });
        }
        if (title === "Administrator settings") {
          const databaseSection = content.locator(".database-storage");
          const dividerColor = theme === "light" ? "rgb(226, 226, 226)" : "rgb(51, 51, 51)";
          const dividers = [
            [databaseSection, "top"],
            [databaseSection.locator(".database-supplement > div + div"), "top"],
            [databaseSection.locator(".storage-details"), "top"],
            [page.locator(name === "mobile" ? ".settings-tabs" : ".settings-sidebar"), name === "mobile" ? "bottom" : "right"],
          ] as const;
          for (const [element, edge] of dividers) {
            await expect(element).toHaveCSS(`border-${edge}-width`, "1px");
            await expect(element).toHaveCSS(`border-${edge}-color`, dividerColor);
          }
          await expect(databaseSection).toHaveCSS("box-shadow", "none");
          await expect(databaseSection.locator(".storage-categories dt")).toHaveText(["Main database file", "WAL file", "Shared memory file"]);
          await expect(databaseSection.locator(".database-supplement")).toContainText("Stored separately");
          expect(await databaseSection.locator(".storage-composition").evaluate(element => Math.abs([...element.children].reduce((sum, segment) => sum + segment.getBoundingClientRect().width, 0) - element.clientWidth))).toBeLessThanOrEqual(1);
          const form = content.locator(".admin-create");
          if (name !== "mobile") {
            const inputs = await form.locator("input:not([aria-hidden]), [role=combobox]").all();
            const bounds = await Promise.all(inputs.map(input => input.boundingBox()));
            expect(Math.max(...bounds.map(box => box!.x + box!.width)) - Math.min(...bounds.map(box => box!.x + box!.width))).toBeLessThanOrEqual(2);
            const row = content.locator(".user-row").first();
            const identity = (await row.locator(".settings-list-details").boundingBox())!, actions = (await row.locator(".user-actions").boundingBox())!;
            expect(actions.x).toBeGreaterThanOrEqual(identity.x + identity.width);
          }
          const newQuota = content.locator(".admin-create .quota-fields");
          await expectOptions(newQuota.getByRole("combobox"), ["Unlimited", "100MiB", "200MiB", "500MiB", "1GiB", "2GiB", "Custom"]);
          await page.getByRole("button", { name: "Edit quota", exact: true }).first().click();
          const dialog = page.locator(".quota-dialog");
          if (name !== "mobile") {
            const shadow = await page.locator(".settings-modal").evaluate(element => getComputedStyle(element).boxShadow);
            expect(shadow).not.toBe("none");
            await expect(dialog).toHaveCSS("box-shadow", shadow);
          }
          await expectInlineQuota(dialog.locator(".quota-fields"));
          await page.screenshot({ path: info.outputPath(`${name}-${theme}-quota-custom.png`) });
          await dialog.getByRole("button", { name: "Close", exact: true }).click();
          await content.evaluate(element => { element.scrollTop = 0; });
        }
        await page.screenshot({ path: info.outputPath(`${name}-${theme}-${title.replaceAll(" ", "-")}.png`) });
        const footerBefore = await page.locator(".settings-logout-section").boundingBox();
        const chrome = await header.boundingBox(), titleBefore = (await content.locator(".settings-page-title").boundingBox())!;
        await content.evaluate(element => { element.scrollTop = element.scrollHeight; });
        expect(await header.boundingBox()).toEqual(chrome);
        expect(await page.locator(".settings-logout-section").boundingBox()).toEqual(footerBefore);
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
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await chooseSetting(page.getByRole("combobox", { name: "Font size", exact: true }), "17 (Large)");
    for (const title of tabs) {
      await page.locator(".settings-tabs").getByRole("tab", { name: title, exact: true }).click();
      if (title === "Administrator settings") await expect(page.locator(".database-storage")).toContainText("Database available");
      expect(await content.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await content.locator(".settings-card").evaluateAll(cards => cards.every(card => card.scrollWidth <= card.clientWidth + 1))).toBe(true);
      await expect(page.locator(".settings-logout-section button")).toHaveCSS("font-size", "17px");
      await expect.poll(() => content.locator(".settings-action-button").evaluateAll(buttons => buttons.flatMap(button => {
        const { fontSize, fontWeight } = getComputedStyle(button);
        return fontSize === "17px" && fontWeight === "500" ? [] : [button.textContent];
      }))).toEqual([]);
      if (title === "Notes and storage") {
        const labels = content.locator(".storage-pending-item > span");
        expect(await labels.evaluateAll(items => items.every(label => label.getBoundingClientRect().right <= label.parentElement!.getBoundingClientRect().right + 1))).toBe(true);
        await expectInlineQuota(content.locator(".history-budget .quota-fields"));
      }
      await page.screenshot({ path: info.outputPath(`${name}-large-${title.replaceAll(" ", "-")}.png`) });
    }
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await chooseSetting(page.getByRole("combobox", { name: "Font size", exact: true }), "14 (Default)");
    await page.getByRole("tab", { name: "Account and security", exact: true }).click();
    await page.getByRole("button", { name: "Edit profile", exact: true }).click();
    const profile = page.getByRole("dialog", { name: "Edit profile", exact: true });
    await expect(profile.getByRole("button", { name: "Upload avatar", exact: true })).toBeVisible();
    await profile.getByRole("button", { name: "Close", exact: true }).first().click();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    const logout = page.getByRole("dialog", { name: "Log out of this device?", exact: true });
    await expect(logout.locator(".storage-pending-item strong")).toHaveText(["12", "3", "24"]);
    await logout.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.locator(".settings-tabs").getByRole("tab", { name: "Administrator settings", exact: true }).click();
    await page.locator(".admin-create input").nth(0).fill("new-user");
    await page.locator(".admin-create input").nth(1).fill("New User");
    const created = page.waitForRequest(request => request.url().endsWith("/api/admin/account-setups") && request.method() === "POST");
    await page.locator(".admin-user-management").getByRole("button", { name: "Create activation code", exact: true }).click();
    expect((await created).postDataJSON()).toMatchObject({ username: "new-user", displayName: "New User", storageQuota: { mode: "inherit", bytes: null } });
    await expect(page.locator(".activation-result code")).toHaveText("fixture-activation-code");
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

test("settings rows keep available space and move complete action groups when narrowed", async ({ page }, info) => {
  await page.goto("/settings.html?language=zh-CN");
  const content = page.locator(".settings-content");
  for (const size of ["14", "17"]) {
    for (const width of [520, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator(".settings-tabs").getByRole("tab", { name: "通用", exact: true }).click();
      await chooseSetting(page.getByRole("combobox", { name: "字体大小", exact: true }), size === "17" ? "17（大）" : "14（默认）");
      for (const row of await content.locator(".general-settings .settings-item:has([role=combobox])").all()) {
        const copy = (await row.locator(".settings-item-copy").boundingBox())!;
        const control = (await row.getByRole("combobox").boundingBox())!;
        if (width >= 390) expect(Math.abs(copy.y + copy.height / 2 - control.y - control.height / 2)).toBeLessThanOrEqual(1);
        else expect(control.y).toBeGreaterThanOrEqual(copy.y + copy.height);
      }
      await page.locator(".settings-tabs").getByRole("tab", { name: "用户和安全", exact: true }).click();
      const profile = content.locator(".profile-summary");
      const avatar = (await profile.locator(".profile-avatar").boundingBox())!;
      const edit = (await profile.getByRole("button").boundingBox())!;
      if (width >= 390) expect(Math.abs(avatar.y + avatar.height / 2 - edit.y - edit.height / 2)).toBeLessThanOrEqual(1);
      else expect(edit.y).toBeGreaterThanOrEqual(avatar.y + avatar.height);
      // A button group moves as a unit; the text and controls never overlap.
      expect(await content.locator(".settings-item").evaluateAll(rows => rows.every(row => {
        const copy = row.querySelector(".settings-item-copy")!.getBoundingClientRect();
        const control = row.querySelector(".settings-item-control")!.getBoundingClientRect();
        return control.left >= copy.right - 1 || control.top >= copy.bottom - 1;
      }))).toBe(true);
      if (size === "14" && width === 520) await page.screenshot({ path: info.outputPath("compact-security-actions.png") });
      await page.locator(".settings-tabs").getByRole("tab", { name: "管理员设置", exact: true }).click();
      const row = content.locator(".user-row").first();
      await expect(row).toBeVisible();
      const details = (await row.locator(".settings-list-details").boundingBox())!;
      const actions = (await row.locator(".settings-list-actions").boundingBox())!;
      if (width === 520) expect(actions.x).toBeGreaterThanOrEqual(details.x + details.width - 1);
      else expect(actions.y).toBeGreaterThanOrEqual(details.y + details.height - 1);
      const buttons = await row.locator(".settings-list-actions button").all();
      const bounds = await Promise.all(buttons.map(button => button.boundingBox()));
      expect(Math.max(...bounds.map(box => box!.y)) - Math.min(...bounds.map(box => box!.y))).toBeLessThanOrEqual(1);
      expect(await content.locator(".settings-card").evaluateAll(cards => cards.every(card => card.scrollWidth <= card.clientWidth + 1))).toBe(true);
    }
  }
});

test("offline settings retain a visible notice and respect forced colors", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings.html?offline");
  const notice = page.locator(".settings-scroll-content > .auth-guidance");
  await expect(notice).toBeVisible();
  expect((await notice.boundingBox())!.y).toBeGreaterThan((await page.locator(".settings-header").boundingBox())!.y);
  await page.emulateMedia({ forcedColors: "active" });
  for (const selector of [".settings-header", ".settings-sidebar", ".settings-backdrop"]) await expect(page.locator(selector)).toHaveCSS("backdrop-filter", "none");
});

test("application connection fields retain accessible names and descriptions at wide and narrow widths", async ({ page }, info) => {
  await page.goto("/settings.html");
  await page.getByRole("tab", { name: "Account and security", exact: true }).click();
  await page.getByRole("button", { name: "Add application", exact: true }).click();
  const form = page.locator(".application-form");
  const fields = form.locator(".settings-item-control :is(input:not([aria-hidden]), [role=combobox])");
  await expect(fields).toHaveCount(4);
  for (const field of await fields.all()) await expect(field).toHaveAccessibleName(/.+/);
  expect(await fields.evaluateAll(controls => controls.every(control => !control.hasAttribute("aria-describedby") || Boolean(document.getElementById(control.getAttribute("aria-describedby")!))))).toBe(true);
  await chooseSetting(form.getByRole("combobox").first(), "Read only");
  await expect(form.getByRole("combobox").first()).toHaveText("Read only");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await form.screenshot({ path: info.outputPath("mobile-application-fields.png") });
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(form).toHaveCount(0);
});

test("settings controls distinguish switch states and keep theme borders and keyboard focus visible", async ({ page, browserName }) => {
  await page.goto("/settings.html?offline");
  const themeSelect = page.getByRole("combobox", { name: "Theme", exact: true });
  const toggle = page.getByRole("switch", { name: "Wrap code blocks", exact: true });
  const track = page.locator("[data-slot=switch]");
  const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab", backTabKey = browserName === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab";
  for (const theme of ["light", "dark"]) {
    const themeLabel = theme === "light" ? "Light" : "Dark";
    await chooseSetting(themeSelect, themeLabel);
    await expect(toggle).not.toBeChecked();
    const selectSurface = theme === "light" ? "rgb(255, 255, 255)" : "rgb(42, 42, 42)";
    await expect(themeSelect).toHaveCSS("background-color", selectSurface);
    await themeSelect.hover();
    await expect(themeSelect).toHaveCSS("background-color", theme === "light" ? "rgb(232, 233, 233)" : "rgb(51, 51, 51)");
    await page.mouse.move(0, 0);
    const idleBorder = await themeSelect.evaluate(element => getComputedStyle(element).borderTopColor);
    await themeSelect.focus(); await page.keyboard.press(tabKey); await page.keyboard.press(backTabKey);
    await expect(themeSelect).toBeFocused();
    await expect(themeSelect).not.toHaveCSS("border-top-color", idleBorder);
    await expect(themeSelect).not.toHaveCSS("box-shadow", "none");
    await page.keyboard.press("ArrowDown");
    await expect(themeSelect).toHaveAttribute("aria-expanded", "true");
    const list = page.getByRole("listbox");
    await expect(page.locator("[data-slot=select-content]:visible")).toHaveCSS("background-color", selectSurface);
    const selected = list.getByRole("option", { name: themeLabel, exact: true });
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await expect(selected.locator("[data-slot=select-item-indicator]")).toBeVisible();
    const other = list.getByRole("option", { name: "Follow system", exact: true });
    await other.hover();
    // Windows WebKit reports zero movement for Playwright mouse moves.
    if (browserName === "webkit" && process.platform === "win32") {
      await other.dispatchEvent("mousemove", { movementY: 1 });
    }
    await expect(other).toHaveAttribute("data-highlighted", "");
    await expect(other).toHaveCSS("background-color", theme === "light" ? "rgb(232, 233, 233)" : "rgb(51, 51, 51)");
    await page.keyboard.press("Escape");
    await expect(themeSelect).toBeFocused();

    await toggle.focus(); await page.keyboard.press(tabKey); await page.keyboard.press(backTabKey);
    await expect(toggle).toBeFocused();
    await expect(track).not.toHaveCSS("box-shadow", "none");
    const uncheckedColor = await track.evaluate(element => getComputedStyle(element).backgroundColor);
    await toggle.press("Space"); await expect(toggle).toBeChecked();
    await expect(track).toHaveCSS("background-color", theme === "light" ? "rgb(97, 210, 160)" : "rgb(97, 210, 153)");
    await toggle.press("Space"); await expect(toggle).not.toBeChecked();
    await expect(track).toHaveCSS("background-color", uncheckedColor);
    await track.click(); await expect(toggle).toBeChecked();
    await page.getByText("Wrap code blocks", { exact: true }).click(); await expect(toggle).not.toBeChecked();
  }
  await chooseSetting(themeSelect, "Light");
  await page.getByRole("tab", { name: "Account and security", exact: true }).click();
  const logout = page.getByRole("button", { name: "Log out", exact: true });
  await logout.focus(); await page.keyboard.press(backTabKey); await page.keyboard.press(tabKey);
  await expect(logout).toBeFocused();
  await expect(logout).not.toHaveCSS("box-shadow", "none");
});
