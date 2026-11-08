import { test, expect } from "@playwright/test";

const password = "Multi-account browser test passphrase 2026";

async function register(page, username, displayName) {
  await page.addInitScript(() => localStorage.setItem("webmd-notes-language", "en"));
  await page.goto("/");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Display name", { exact: true }).fill(displayName);
  await page.getByLabel("Master password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Recovery key saved", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
}

async function sidebarAction(page, name) {
  const action = page.locator(".side-footer").getByRole("button", { name, exact: true });
  const shell = page.locator(".app-shell");
  if (page.viewportSize().width < 700 && !await shell.evaluate((element) => element.classList.contains("tree-open"))) {
    await page.getByRole("button", { name: "Open left sidebar", exact: true }).click();
  }
  await action.click();
}

async function openAccountPopover(page) {
  await sidebarAction(page, "Switch account");
  const popover = page.getByRole("dialog", { name: "Switch account", exact: true });
  await expect(popover).toBeVisible();
  await expect(page.locator(".app-shell")).toBeVisible();
  return popover;
}

async function loginRemembered(page, username, displayName) {
  const popover = await openAccountPopover(page);
  await popover.getByRole("button", { name: "Sign in to another account", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Master password", { exact: true }).fill(password);
  await page.getByRole("checkbox", { name: "Remember this device", exact: true }).check();
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.locator(".sidebar-user-name")).toHaveText(displayName);
}

async function setAvatar(page) {
  await sidebarAction(page, "Settings");
  await page.getByRole("tab", { name: "Account and security", exact: true }).click();
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  const profile = page.getByRole("dialog", { name: "Edit profile", exact: true });
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext("2d");
    context.fillStyle = "#317862";
    context.fillRect(0, 0, 8, 8);
    return canvas.toDataURL();
  });
  await profile.locator('input[type="file"]').setInputFiles({
    name: "avatar.png", mimeType: "image/png", buffer: Buffer.from(dataUrl.split(",")[1], "base64")
  });
  await expect(profile.getByRole("img", { name: "Current avatar" })).toBeVisible();
  await profile.locator("header").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
}

async function setPin(page, pin) {
  await sidebarAction(page, "Settings");
  await page.getByRole("tab", { name: "Account and security", exact: true }).click();
  await page.getByRole("button", { name: "Set PIN", exact: true }).click();
  const pinDialog = page.getByRole("dialog", { name: "Set PIN" });
  await pinDialog.getByLabel("Master password", { exact: true }).fill(password);
  await pinDialog.locator("input[minlength='4']").fill(pin);
  await pinDialog.getByRole("button", { name: "Set PIN", exact: true }).click();
  await expect(pinDialog).toBeHidden();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
}

test("switches remembered accounts across windows and requires the target PIN offline", async ({ page, browser, context }, info) => {
  test.setTimeout(120_000);
  const colorScheme = info.project.name === "narrow" ? "dark" : "light";
  await page.emulateMedia({ colorScheme });
  const alpha = `account-a-${info.project.name}`;
  const beta = `account-b-${info.project.name}`;
  const pin = "839156";
  const registration = await browser.newContext({ baseURL: "http://127.0.0.1:8791", viewport: page.viewportSize() });
  try { await register(await registration.newPage(), beta, "Beta"); }
  finally { await registration.close(); }
  await register(page, alpha, "Alpha");

  const popover = await openAccountPopover(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
  const trigger = page.locator(".side-footer").getByRole("button", { name: "Switch account", exact: true });
  const current = popover.getByRole("button", { name: "Alpha Current", exact: true });
  const login = popover.getByRole("button", { name: "Sign in to another account", exact: true });
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(trigger.locator("svg.lucide-users-round-collaboration")).toHaveCount(1);
  await expect(current).toHaveAttribute("aria-current", "true");
  await expect(popover).not.toContainText(`@${alpha}`);
  const titleSize = await popover.getByRole("heading").evaluate((heading) => parseFloat(getComputedStyle(heading).fontSize));
  const rowSize = await current.evaluate((row) => parseFloat(getComputedStyle(row).fontSize));
  expect(titleSize).toBeGreaterThanOrEqual(rowSize);
  const accountIcon = current.locator("svg.lucide-user-round");
  const loginIcon = login.locator("svg.lucide-user-round-plus");
  await expect(accountIcon).toBeVisible();
  await expect(loginIcon).toBeVisible();
  await expect(loginIcon).toHaveCSS("width", await accountIcon.evaluate((icon) => getComputedStyle(icon).width));
  await expect(login).toHaveCSS("font", await current.evaluate((row) => getComputedStyle(row).font));
  const anchor = await trigger.boundingBox();
  const panel = await popover.boundingBox();
  expect(panel.y).toBeGreaterThanOrEqual(0);
  expect(panel.x).toBeLessThan(anchor.x + anchor.width);
  expect(panel.x + panel.width).toBeGreaterThan(anchor.x);
  expect(anchor.y - panel.y - panel.height).toBeGreaterThanOrEqual(0);
  expect(anchor.y - panel.y - panel.height).toBeLessThan(24);

  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
  await openAccountPopover(page);
  await page.getByRole("textbox", { name: "Search notes", exact: true }).click();
  await expect(popover).toBeHidden();

  await openAccountPopover(page);
  await popover.getByRole("button", { name: "Sign in to another account", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(popover).toBeHidden();
  await loginRemembered(page, alpha, "Alpha");
  await setAvatar(page);
  await openAccountPopover(page);
  const avatar = popover.getByRole("button", { name: /Alpha/ }).locator("img");
  await expect(avatar).toHaveAttribute("src", /^blob:/);
  expect(await avatar.getAttribute("src")).toBe(await page.locator(".sidebar-avatar img").getAttribute("src"));
  await page.keyboard.press("Escape");
  await loginRemembered(page, beta, "Beta");

  await openAccountPopover(page);
  await expect(popover.locator(".account-picker-list .account-picker-name")).toHaveText(["Alpha", "Beta"]);
  await expect(popover.getByRole("button", { name: "Beta Current", exact: true })).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Escape");

  await setPin(page, pin);
  await sidebarAction(page, "Lock");
  const lock = page.locator(".lock-card");
  await expect(lock.getByRole("heading", { name: "Beta", exact: true })).toBeVisible();
  const actions = lock.locator(".auth-account-actions");
  await expect(actions.getByRole("button")).toHaveCount(2);
  await expect(actions.getByRole("button", { name: "Log out", exact: true })).toBeVisible();
  const viewport = page.viewportSize();
  if (info.project.name === "desktop") await page.setViewportSize({ width: 820, height: 1180 });
  const root = page.locator("html");
  const theme = await root.evaluate((element) => {
    const previous = element.dataset.theme;
    element.style.fontSize = "150%";
    element.dataset.theme = "dark";
    return previous;
  });
  expect(await actions.locator("button").evaluateAll((buttons) => {
    const [first, second] = buttons.map((button) => button.getBoundingClientRect());
    return Math.abs(first.top - second.top) <= 1 && first.right <= second.left;
  })).toBe(true);
  await root.evaluate((element, previous) => {
    element.style.removeProperty("font-size");
    if (previous) element.dataset.theme = previous;
    else delete element.dataset.theme;
  }, theme);
  if (info.project.name === "desktop") await page.setViewportSize(viewport);
  await actions.getByRole("button", { name: "Switch account", exact: true }).click();
  await expect(page.locator(".account-picker .account-picker-name")).toHaveText(["Alpha", "Beta"]);
  await expect(page.getByRole("button", { name: "Back", exact: true }).and(page.locator(".auth-entry > button"))).toBeVisible();
  await page.getByRole("button", { name: /Alpha/ }).click();
  await expect(page.locator(".sidebar-user-name")).toHaveText("Alpha");

  const sibling = await context.newPage();
  await sibling.goto("/");
  await expect(sibling.locator(".app-shell")).toBeVisible();
  await page.bringToFront();
  await context.setOffline(true);
  if (!await page.getByRole("button", { name: "New note", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Open left sidebar", exact: true }).click();
  }
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const title = "Offline switch draft";
  const rename = page.locator(".tree-rename-input");
  if (await rename.isVisible()) await rename.press("Escape");
  await page.locator(".title-input").fill(title);
  await page.locator(".title-input").press("Tab");
  if (!await page.locator(".editor-area textarea").isVisible()) {
    await page.getByRole("button", { name: "Source", exact: true }).click();
  }
  await page.locator(".editor-area textarea").fill("Alpha pending offline edit");
  const switcher = await openAccountPopover(page);
  const betaOption = switcher.getByRole("button", { name: /Beta/ });
  await expect(betaOption.locator("svg.lucide-user-round")).toHaveCount(1);
  await expect(betaOption.getByRole("img", { name: "Device PIN", exact: true })).toBeVisible();
  await betaOption.click();
  await expect(sibling.locator(".app-shell")).toBeHidden();
  await expect(lock.getByRole("heading", { name: "Beta", exact: true })).toBeVisible();
  await lock.locator("input").fill("wrong PIN");
  await lock.getByRole("button", { name: "Unlock with PIN", exact: true }).click();
  await expect(lock.locator(".error")).toBeVisible();
  await lock.locator("input").fill(pin);
  await lock.getByRole("button", { name: "Unlock with PIN", exact: true }).click();
  await expect(page.locator(".sidebar-user-name")).toHaveText("Beta");
  await context.setOffline(false);
  await page.bringToFront();
  await expect(page.locator(".status-synced")).toBeVisible();
  await page.reload();
  await expect(page.locator(".sidebar-user-name")).toHaveText("Beta");
  await expect(page.locator(".status-synced")).toBeVisible();
  const cold = await context.newPage();
  await cold.goto("/");
  await expect(cold.locator(".lock-card h1")).toHaveText("Beta");
  await cold.close();

  await page.bringToFront();
  await sidebarAction(page, "Lock");
  await lock.getByRole("button", { name: "Switch account", exact: true }).click();
  await page.getByRole("button", { name: /Alpha/ }).click();
  await expect(page.locator(".sidebar-user-name")).toHaveText("Alpha");
  const note = page.getByRole("button", { name: title, exact: true });
  if (page.viewportSize().width < 700
    && !await page.locator(".app-shell").evaluate((element) => element.classList.contains("tree-open"))) {
    await page.getByRole("button", { name: "Open left sidebar", exact: true }).click();
  }
  await note.click();
  if (!await page.locator(".editor-area textarea").isVisible()) {
    await page.getByRole("button", { name: "Source", exact: true }).click();
  }
  await expect(page.locator(".editor-area textarea")).toHaveValue("Alpha pending offline edit");
  await expect(page.locator(".status-synced")).toBeVisible();
  const alphaPin = "457803";
  await setPin(page, alphaPin);
  await sidebarAction(page, "Lock");
  await expect(lock.getByRole("heading", { name: "Alpha", exact: true })).toBeVisible();
  await lock.locator("input").fill(pin);
  await lock.getByRole("button", { name: "Unlock with PIN", exact: true }).click();
  await expect(lock.locator(".error")).toBeVisible();
  await lock.locator("input").fill(alphaPin);
  await lock.getByRole("button", { name: "Unlock with PIN", exact: true }).click();
  await expect(page.locator(".sidebar-user-name")).toHaveText("Alpha");
});
