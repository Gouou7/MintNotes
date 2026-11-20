import { test, expect } from "@playwright/test";
import { argon2id } from "hash-wasm";
import { operationId } from "../../../packages/application-client/dist/index.js";
import { b64, randomBytes, deriveSubkey, seal, encodeVaultObject, encodeNoteCatalog } from "../../../packages/application-client/dist/crypto.js";

test.use({ serviceWorkers: "block" });

const password = "Catalog browser test passphrase 2026";
const paragraph = "# Download target\n\n";
const smallBody = paragraph + "Typical body text. ".repeat(100);
const largeBody = paragraph + "Long body text. ".repeat(9_000);

async function seedLibrary(request, username) {
  const key = randomBytes(32), salt = randomBytes(16);
  const context = b64(randomBytes(16));
  const root = await argon2id({ password, salt, iterations: 3, parallelism: 1, memorySize: 65_536, hashLength: 32, outputType: "binary" });
  const wrapped = await seal(key, await deriveSubkey(root, "webmd-vault-wrapping-v1"), `webmd:vault-envelope:v2:${context}`);
  const authSecret = b64(await deriveSubkey(root, "webmd-authentication-v1"));
  root.fill(0);
  const registration = await request.post("/api/auth/register", { headers: { "X-WebMD-Browser": "1" }, data: {
    username, displayName: username, authSecret, kdfSalt: b64(salt),
    kdfParams: { algorithm: "argon2id", opsLimit: 3, memLimit: 67_108_864, version: 1 },
    envelopeVersion: 2, envelopeContext: context, wrappedVaultKey: wrapped.ciphertext, wrappedVaultNonce: wrapped.nonce,
    recoveryAuthSecret: b64(randomBytes(32)), recoveryWrappedVaultKey: wrapped.ciphertext, recoveryWrappedVaultNonce: wrapped.nonce
  } });
  expect(registration.status()).toBe(201);
  const { user, sessionId } = await registration.json();
  const headers = { "X-WebMD-Protocol": "3", "X-WebMD-Browser": "1", "X-WebMD-Session": sessionId };
  const statusResponse = await request.get("/api/sync/status", { headers });
  expect(statusResponse.ok()).toBe(true);
  const status = await statusResponse.json();
  headers["X-WebMD-Sync-Lease"] = status.lease;
  const ids = [], batch = [];
  let fullBytes = 0;
  const stamp = Date.now();
  for (let index = 0; index < 1_000; index++) {
    const objectId = crypto.randomUUID();
    ids.push(objectId);
    const time = new Date(stamp - index * 1_000).toISOString();
    const document = {
      kind: "note", schemaVersion: 2, title: `Catalog note ${String(index).padStart(4, "0")}`, markdown: index === 1 ? largeBody : smallBody,
      parentId: null, tags: [], favorite: false, locked: false, deleted: false, createdAt: time, updatedAt: time,
      manualOrder: index, attachmentIds: []
    };
    const encoded = await encodeVaultObject(key, user.id, objectId, "note", 1, document, async () => { throw new Error("Missing fixture block"); });
    const { bodyBlocks, ...envelope } = encoded;
    fullBytes += envelope.ciphertext.length + (bodyBlocks ?? []).reduce((sum, block) => sum + block.ciphertext.length, 0);
    if (bodyBlocks?.length) {
      const blocks = await request.post(`/api/notes/${objectId}/body-blocks/batch`, { headers, data: { blocks: bodyBlocks } });
      expect(blocks.ok()).toBe(true);
    } else if (index !== 999) {
      envelope.catalog = await encodeNoteCatalog(key, user.id, { ...envelope, objectId, objectType: "note", revision: 1, deleted: false }, document);
    }
    batch.push({ ...envelope, objectId, objectType: "note", baseRevision: 0, idempotencyKey: operationId(), deleted: false });
    if (batch.length === 50) {
      const response = await request.post("/api/objects/batch", { headers, data: { objects: batch.splice(0) } });
      expect(response.ok()).toBe(true);
      expect((await response.json()).results.every((entry) => entry.status === "accepted")).toBe(true);
    }
  }
  key.fill(0);
  return { ids, fullBytes };
}

async function openSidebar(page) {
  const shell = page.locator(".app-shell");
  await expect(shell).toBeVisible();
  const narrow = page.viewportSize().width < 700;
  const closed = await shell.evaluate((element, narrow) => narrow ? !element.classList.contains("tree-open") : element.classList.contains("tree-collapsed"), narrow);
  if (closed) {
    await page.getByRole("button", { name: "Open left sidebar", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "New note", exact: true })).toBeVisible();
}

async function chooseMode(page, label, limit) {
  await openSidebar(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Notes and storage", exact: true }).click();
  await page.getByRole("combobox", { name: "Note downloads", exact: true }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  if (limit) {
    const input = page.getByRole("spinbutton", { name: "Number of recently updated notes" });
    await input.fill(String(limit));
    await input.press("Tab");
    await expect(input).toHaveValue(String(limit));
  }
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
}

test("lists a mixed-format vault before body downloads and prioritizes the opened note in all modes", async ({ request, page, context }, info) => {
  test.setTimeout(150_000);
  const username = `catalog-${info.project.name}`;
  const { ids, fullBytes } = await seedLibrary(request, username);
  const bodyRequests = [];
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if (/\/api\/objects\/[\da-f-]{36}$|\/body-blocks\/read$/.test(path) && !["PUT", "PATCH"].includes(req.method())) bodyRequests.push(path);
  });
  const pages = [];
  page.on("response", (response) => {
    if (response.url().includes("/sync/snapshot?") && response.ok()) pages.push(response.body().then((body) => body.length));
  });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route(`**/api/objects/${ids[0]}?*`, async (route) => {
    await gate;
    await route.continue().catch(() => undefined);
  });
  try {
    await page.addInitScript(() => localStorage.setItem("webmd-notes-language", "en"));
    await page.goto("/");
    await page.getByLabel("Username", { exact: true }).fill(username);
    await page.getByLabel("Master password", { exact: true }).fill(password);
    const started = Date.now();
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.locator(".app-shell")).toBeVisible();
    const listMs = Date.now() - started;
    await openSidebar(page);
    await expect(page.locator(".document-tree .tree-title")).toHaveCount(1_000);
    await expect.poll(() => bodyRequests.slice()).toEqual([`/api/objects/${ids[0]}`]);
    const opened = Date.now();
    await page.getByText("Catalog note 0001", { exact: true }).click();
    await expect(page.locator(".title-input")).toBeEditable();
    const mode = page.getByRole("button", { name: "Source", exact: true });
    if (await mode.getAttribute("aria-pressed") !== "true") await mode.click();
    await expect(page.locator(".editor-area textarea")).toHaveValue(largeBody);
    const openMs = Date.now() - opened;
    await chooseMode(page, "Download on demand");
    release();
    const requestsBeforeIdle = bodyRequests.length;
    await page.waitForTimeout(700);
    expect(bodyRequests).toHaveLength(requestsBeforeIdle);
    await chooseMode(page, "Download recent notes", 3);
    await expect.poll(() => bodyRequests.includes(`/api/objects/${ids[2]}`)).toBe(true);
    expect(bodyRequests).not.toContain(`/api/objects/${ids[3]}`);
    await chooseMode(page, "Download on demand");
    await context.setOffline(true);
    await openSidebar(page);
    await page.getByText("Catalog note 0004", { exact: true }).click();
    await expect(page.getByText("This note has no current offline copy.", { exact: true })).toBeVisible();
    if (info.project.name === "narrow") await expect(page.locator(".app-shell")).not.toHaveClass(/tree-open/);
    await openSidebar(page);
    await page.getByText("Catalog note 0001", { exact: true }).click();
    await expect(page.locator(".editor-area textarea")).toHaveValue(largeBody);
    await context.setOffline(false);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
    await chooseMode(page, "Download all");
    await expect.poll(() => bodyRequests.includes(`/api/objects/${ids[3]}`)).toBe(true);
    const catalogBytes = (await Promise.all(pages)).reduce((total, bytes) => total + bytes, 0);
    expect(catalogBytes).toBeLessThan(fullBytes);
    console.log(`Catalog (${info.project.name}): list ${listMs} ms, open ${openMs} ms, directory ${catalogBytes} bytes, full ciphertext ${fullBytes} bytes`);
    await info.attach("catalog-download-metrics", { body: JSON.stringify({ listMs, openMs, catalogBytes, fullCiphertextBytes: fullBytes }), contentType: "application/json" });
  } finally { release(); }
});
