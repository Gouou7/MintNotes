import { test, expect } from "@playwright/test";

async function source(page, title) {
  await page.bringToFront();
  const exact = new RegExp("^" + title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
  const item = page.locator(".tree-title").filter({ hasText: exact });
  if (!await page.locator(".title-input").isVisible() || await page.locator(".title-input").inputValue() !== title) {
    const narrow = page.viewportSize().width < 700;
    const shell = page.locator(".app-shell");
    if (narrow ? !await shell.evaluate((element) => element.classList.contains("tree-open")) : !await item.first().isVisible())
      await page.getByRole("button", { name: "Open left sidebar", exact: true }).click();
    await item.first().click();
    if (narrow) await expect(shell).not.toHaveClass(/tree-open/);
  }
  if (!await page.locator(".editor-area textarea").isVisible()) await page.getByRole("button", { name: "Source", exact: true }).click();
  return page.locator(".editor-area textarea");
}
function commit(page, version) {
  return page.waitForResponse((response) => {
    if (!response.ok() || !/\/api\/objects(?:\/batch|\/[^/]+)$/.test(new URL(response.url()).pathname)) return false;
    if (!["POST", "PUT"].includes(response.request().method())) return false;
    const body = response.request().postDataJSON();
    return (body.objects ?? [body]).some((object) => object.objectType === "note" && object.encryptionVersion === version);
  });
}
async function pendingNote(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("webmd-notes-v2");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction("outbox").objectStore("outbox").getAll();
      read.onerror = () => { db.close(); reject(read.error); };
      read.onsuccess = () => { db.close(); resolve(read.result.find((object) => object.objectType === "note")); };
    };
  }));
}

test("upgrades legacy cache and preserves long-note branches through weak network and offline restart", async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  const username = `incremental-${info.project.name}`, password = "Incremental sync test passphrase 2026";
  await page.addInitScript(() => localStorage.setItem("webmd-notes-language", "en"));
  await page.goto("/");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Display name", { exact: true }).fill("Sync test");
  await page.getByLabel("Master password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Recovery key saved", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  if (!await page.getByRole("button", { name: "New note", exact: true }).isVisible()) await page.getByRole("button", { name: "Open left sidebar", exact: true }).click();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  if (await page.locator(".tree-rename-input").isVisible()) await page.locator(".tree-rename-input").press("Escape");
  const title = "Incremental sample";
  await page.locator(".title-input").fill(title);
  await page.locator(".title-input").press("Tab");
  const editor = await source(page, title);
  const savedSmall = commit(page, 1);
  await editor.fill("# Legacy note\n\nKeep the original text.\n");
  await savedSmall;
  await expect(page.locator(".status-synced")).toBeVisible();

  const otherContext = await browser.newContext({ baseURL: "http://127.0.0.1:8791", viewport: info.project.use.viewport });
  let other;
  try {
    other = await otherContext.newPage();
    await other.addInitScript(() => localStorage.setItem("webmd-notes-language", "en"));
    await other.goto("/");
    await other.getByLabel("Username", { exact: true }).fill(username);
    await other.getByLabel("Master password", { exact: true }).fill(password);
    await other.getByRole("checkbox", { name: "Remember this device" }).check();
    await other.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(other.locator(".app-shell")).toBeVisible();
    await expect(await source(other, title)).toHaveValue("# Legacy note\n\nKeep the original text.\n");
    await other.evaluate(async () => { for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister(); });
    await other.close();
    // Recreate a supported v7 cache with the same ciphertext, queues and device CryptoKey.
    const maintenance = await otherContext.newPage();
    await maintenance.goto("/api/health");
    await maintenance.evaluate(async () => {
      const open = (version) => new Promise((resolve, reject) => {
        const request = version ? indexedDB.open("webmd-notes-v2", version) : indexedDB.open("webmd-notes-v2");
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const db = await open();
      const tables = [];
      for (const name of db.objectStoreNames) {
        if (["bodyBlocks", "recoveries"].includes(name)) continue;
        const store = db.transaction(name).objectStore(name);
        const indexes = Array.from(store.indexNames, (name) => { const index = store.index(name); return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }; });
        const rows = await new Promise((resolve, reject) => { const request = store.getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        tables.push({ name, keyPath: store.keyPath, indexes, rows });
      }
      db.close();
      await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase("webmd-notes-v2"); request.onsuccess = resolve; request.onerror = () => reject(request.error); });
      const legacy = await new Promise((resolve, reject) => {
        const request = indexedDB.open("webmd-notes-v2", 70);
        request.onupgradeneeded = () => { for (const table of tables) { const store = request.result.createObjectStore(table.name, { keyPath: table.keyPath }); for (const index of table.indexes) store.createIndex(index.name, index.keyPath, index); } };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => { const transaction = legacy.transaction(tables.map((table) => table.name), "readwrite"); for (const table of tables) for (const row of table.rows) transaction.objectStore(table.name).put(row); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
      legacy.close();
    });
    await maintenance.close();
    other = await otherContext.newPage();
    await other.goto("/");
    await expect(other.locator(".app-shell")).toBeVisible();
    await expect(await source(other, title)).toHaveValue("# Legacy note\n\nKeep the original text.\n");

    // Active notes deliberately defer remote replacement until the user navigates away.
    await source(other, "Welcome");
    let seed = 519, markdown = "# Incremental 中文😀\n\n";
    while (markdown.length < 260_000) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; markdown += `${seed.toString(36)} text${markdown.length % 512 < 13 ? "\n" : " "}`; }
    const savedLong = commit(page, 2);
    await page.bringToFront();
    await (await source(page, title)).fill(markdown);
    await savedLong;
    await expect(page.locator(".status-synced")).toBeVisible();
    await other.evaluate(() => window.dispatchEvent(new CustomEvent("webmd:retry-recoveries")));
    await expect.poll(() => other.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("webmd-notes-v2");
      request.onsuccess = () => { const db = request.result; const read = db.transaction("objects").objectStore("objects").getAll(); read.onsuccess = () => { resolve(read.result.some((object) => object.encryptionVersion === 2)); db.close(); }; }; request.onerror = () => reject(request.error);
    }))).toBe(true);
    await expect(await source(other, title)).toHaveValue(markdown);
    await other.evaluate(() => navigator.serviceWorker.ready.then(() => true));

    await otherContext.setOffline(true);
    const right = "Device two offline\n" + markdown;
    await (await source(other, title)).fill(right);
    await expect.poll(() => other.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("webmd-notes-v2");
      request.onsuccess = () => { const db = request.result; const read = db.transaction("outbox").objectStore("outbox").count(); read.onsuccess = () => { resolve(read.result); db.close(); }; }; request.onerror = () => reject(request.error);
    }))).toBeGreaterThan(0);
    await other.reload();
    await expect(other.locator(".app-shell")).toBeVisible();
    await expect(await source(other, title)).toHaveValue(right);

    const originalPending = await pendingNote(other);
    const sibling = await otherContext.newPage();
    const third = "Third tab complete offline branch\n" + markdown;
    try {
      await sibling.goto("/");
      await expect(sibling.locator(".app-shell")).toBeVisible();
      await expect(await source(sibling, title)).toHaveValue(right);
      await (await source(sibling, title)).fill(third);
      await expect.poll(async () => {
        const proposal = await pendingNote(sibling);
        return Boolean(proposal && proposal.idempotencyKey !== originalPending.idempotencyKey);
      }).toBe(true);
    } finally { await sibling.close(); }

    const left = "Device one online\n" + markdown;
    const uploaded = [];
    await page.route("**/api/notes/*/body-blocks/batch", async (route) => {
      uploaded.push(route.request().postDataBuffer().length);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.continue();
    });
    const savedLeft = commit(page, 2);
    await page.bringToFront();
    await (await source(page, title)).fill(left);
    await savedLeft;
    expect(uploaded.reduce((sum, size) => sum + size, 0)).toBeLessThan(180_000);
    await otherContext.setOffline(false);
    await expect.poll(() => other.locator(".tree-title").allTextContents()).toContain(`${title} (conflict copy)`);
    await other.evaluate(() => window.dispatchEvent(new CustomEvent("webmd:retry-recoveries")));
    await expect(await source(other, `${title} (conflict copy)`)).toHaveValue(right);
    await expect.poll(async () => (await other.locator(".tree-title").allTextContents()).filter((value) => value.startsWith(title))).toHaveLength(3);
    const thirdTitle = (await other.locator(".tree-title").allTextContents()).find((value) => value.startsWith(title)
      && value !== title && value !== `${title} (conflict copy)`);
    await expect(await source(other, thirdTitle)).toHaveValue(third);
    await expect(await source(other, title)).toHaveValue(left);
    await expect(other.locator(".status-synced")).toBeVisible();

    // A deletion on one device must preserve the other device's complete edit as a visible copy.
    const priorTitles = new Set(await other.locator(".tree-title").allTextContents());
    await otherContext.setOffline(true);
    const retainedEdit = "Edit surviving deletion\n" + left;
    await (await source(other, title)).fill(retainedEdit);
    await expect.poll(() => other.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("webmd-notes-v2");
      request.onsuccess = () => { const db = request.result; const read = db.transaction("outbox").objectStore("outbox").count(); read.onsuccess = () => { resolve(read.result); db.close(); }; }; request.onerror = () => reject(request.error);
    }))).toBeGreaterThan(0);
    await page.bringToFront();
    if (!await page.getByRole("button", { name: "New note", exact: true }).isVisible())
      await page.getByRole("button", { name: "Open left sidebar", exact: true }).click();
    await page.locator(".tree-main").filter({ hasText: title }).first().hover();
    await page.getByRole("button", { name: `Open menu for ${title}`, exact: true }).click();
    const deletionAccepted = page.waitForResponse((response) => response.url().endsWith("/api/objects/batch")
      && response.request().method() === "POST" && response.request().postDataJSON()?.objects?.some((object) => object.deleted));
    await page.getByRole("button", { name: "Move to trash", exact: true }).click();
    expect((await (await deletionAccepted).json()).results.every((object) => ["accepted", "idempotent"].includes(object.status))).toBe(true);
    await otherContext.setOffline(false);
    const recoveredTitles = async () => (await other.locator(".tree-title").allTextContents()).filter((value) => !priorTitles.has(value));
    await expect.poll(recoveredTitles).toHaveLength(1);
    await expect(await source(other, (await recoveredTitles())[0])).toHaveValue(retainedEdit);
    expect(await other.locator(".tree-title").allTextContents()).not.toContain(title);
  } finally { await otherContext.close(); }
});
