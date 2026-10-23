import { test, expect } from "@playwright/test";

test("protected history follows a note through trash, restore and permanent clearing", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("webmd-notes-language", "en"));
  await page.goto("/");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill(`storage-${info.project.name}`);
  await page.getByLabel("Display name", { exact: true }).fill("Storage test");
  await page.getByLabel("Master password", { exact: true }).fill("Storage test passphrase 2026");
  await page.getByLabel("Confirm password", { exact: true }).fill("Storage test passphrase 2026");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Save your recovery key" })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Recovery key saved", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const sidebar = async () => {
    if (!await page.getByRole("button", { name: "New note", exact: true }).isVisible()) await page.getByRole("button", { name: "Open left sidebar", exact: true }).click();
  };
  await sidebar();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const rename = page.locator(".tree-rename-input");
  if (await rename.isVisible()) await rename.press("Escape");
  await page.locator(".title-input").fill("Lifecycle sample");
  await page.locator(".title-input").press("Tab");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const source = page.locator(".editor-area textarea");
  await source.fill("# Lifecycle\n\nKeep this encrypted content.\n");
  await source.press("Tab");
  const openHistory = async () => {
    if (!await page.getByRole("button", { name: "History", exact: true }).isVisible()) await page.getByRole("button", { name: "Open right sidebar", exact: true }).click();
    await page.getByRole("button", { name: "History", exact: true }).click();
  };
  await openHistory();
  await page.getByRole("button", { name: "Create snapshot", exact: true }).click();
  await expect(page.locator(".history-row .history-protection")).not.toHaveCount(0);
  const historyRename = page.locator(".history-rename-input");
  if (await historyRename.isVisible()) await historyRename.press("Enter");
  if (info.project.name === "narrow") await page.getByRole("button", { name: "Close right sidebar", exact: true }).click();
  // Wait for the real durable queues to drain by observing the accepted request.
  await expect(page.locator(".status-synced")).toBeVisible();
  const trashNote = async () => {
    await sidebar();
    await page.locator(".tree-main").filter({ hasText: "Lifecycle sample" }).hover();
    await page.getByRole("button", { name: "Open menu for Lifecycle sample", exact: true }).click();
    const deletionAccepted = page.waitForResponse(response => response.url().endsWith("/api/objects/batch")
      && response.request().method() === "POST" && response.request().postDataJSON()?.objects?.some(object => object.deleted));
    await page.getByRole("button", { name: "Move to trash", exact: true }).click();
    const result = await (await deletionAccepted).json();
    expect(result.results.every(object => ["accepted", "idempotent"].includes(object.status))).toBe(true);
    await expect(page.locator(".status-synced")).toBeVisible();
  };
  const openTrash = async () => {
    await sidebar();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Notes and storage", exact: true }).click();
    await expect(page.locator(".note-storage-settings .storage-pending-item strong")).toHaveText(["0", "0", "0"]);
  };
  await trashNote(); await openTrash();
  const headings = await page.locator(".note-storage-settings h3").allTextContents();
  expect(headings.filter((value) => ["Storage usage", "Note history", "Trash", "Note migration"].includes(value))).toEqual(["Storage usage", "Note history", "Trash", "Note migration"]);
  await expect(page.getByText("Local status", { exact: true })).toBeVisible();
  await page.locator(".history-budget select").selectOption("unlimited");
  const budgetSaved = page.waitForResponse((response) => response.url().endsWith("/api/account/note-history-settings") && response.request().method() === "PATCH");
  await page.locator(".history-budget").getByRole("button", { name: "Save quota" }).click();
  expect((await (await budgetSaved).json()).quotaBytes).toBeNull();
  if (info.project.name === "desktop") {
    await page.getByRole("button", { name: "Administrator settings", exact: true }).click();
    await expect(page.locator(".database-storage")).toContainText("Database available");
    await page.getByRole("button", { name: "Edit quota", exact: true }).first().click();
    await page.locator(".quota-dialog select").selectOption("custom");
    await page.locator(".quota-dialog input[type=number]").fill("1");
    const quotaSaved = page.waitForResponse((response) => response.url().endsWith("/storage-quota") && response.request().method() === "PATCH");
    await page.locator(".quota-dialog").getByRole("button", { name: "Save quota", exact: true }).click();
    expect((await (await quotaSaved).json()).quotaBytes).toBe(1048576);
    await page.getByRole("button", { name: "Notes and storage", exact: true }).click();
  }
  await expect(page.locator(".settings-page-title")).toHaveText("Notes and storage");
  await expect(page.locator(".note-storage-settings > .settings-card")).toHaveCount(4);
  const counts = page.locator(".note-storage-settings .storage-pending-item");
  await expect(counts).toHaveCount(3);
  expect(await counts.evaluateAll((items) => items.every((item, index) => index === 0 || item.getBoundingClientRect().top > items[index - 1].getBoundingClientRect().top || item.getBoundingClientRect().left - items[index - 1].getBoundingClientRect().right >= 15))).toBe(true);
  const content = page.locator(".settings-content");
  expect(await content.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await content.evaluate((element) => element.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("storage-settings.png") });
  await page.getByRole("button", { name: "Restore Lifecycle sample", exact: true }).click();
  await expect(page.locator(".trash-row").filter({ hasText: "Lifecycle sample" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(page.locator(".status-synced")).toBeVisible();
  await sidebar();
  await page.locator(".tree-main").filter({ hasText: "Lifecycle sample" }).click();
  await openHistory();
  await expect(page.locator(".history-row .history-protection")).not.toHaveCount(0);
  if (info.project.name === "narrow") await page.getByRole("button", { name: "Close right sidebar", exact: true }).click();
  await trashNote(); await openTrash();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear trash", exact: true }).click();
  await expect(page.locator(".trash-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await sidebar();
  await expect(page.locator(".tree-title").filter({ hasText: "Lifecycle sample" })).toHaveCount(0);
});
