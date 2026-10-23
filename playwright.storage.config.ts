import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/storage/browser", workers: 1, fullyParallel: false, timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { ...(process.env.MINT_STORAGE_BROWSER_CHANNEL ? { channel: process.env.MINT_STORAGE_BROWSER_CHANNEL } : {}), baseURL: "http://127.0.0.1:8791", actionTimeout: 15_000, screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
    { name: "narrow", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } }
  ],
  webServer: { command: "node scripts/storage-browser-server.mjs", url: "http://127.0.0.1:8791/api/health", reuseExistingServer: false, timeout: 30_000 }
});
