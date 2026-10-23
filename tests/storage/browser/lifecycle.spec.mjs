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
  await page.getByRole("button", { name: "Open right sidebar", exact: true }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Create snapshot", exact: true }).click();
  await expect(page.locator(".history-row .history-protection")).not.toHaveCount(0);
  const historyRename = page.locator(".history-rename-input");
  if (await historyRename.isVisible()) await historyRename.press("Enter");
  if (info.project.name === "narrow") await page.getByRole("button", { name: "Close right sidebar", exact: true }).click();
  // Wait for the real durable queues to drain by observing the accepted request.
  await expect(page.locator(".status-synced")).toBeVisible();
  const trashNote = async () => {
    await sidebar();
    await page.getByRole("button", { name: "Open menu for Lifecycle sample", exact: true }).click();
    await page.getByRole("button", { name: "Move to trash", exact: true }).click();
    await expect(page.locator(".status-synced")).toBeVisible();
  };
  const openTrash = async () => {
    await sidebar();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Trash", exact: true }).click();
  };
  await trashNote(); await openTrash();
  await page.getByRole("button", { name: "Restore Lifecycle sample", exact: true }).click();
  await expect(page.locator(".trash-row").filter({ hasText: "Lifecycle sample" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(page.locator(".status-synced")).toBeVisible();
  await sidebar();
  await page.locator(".tree-main").filter({ hasText: "Lifecycle sample" }).click();
  await page.getByRole("button", { name: "Open right sidebar", exact: true }).click();
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
