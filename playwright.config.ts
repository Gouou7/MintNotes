import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/editor/browser", workers: 1, fullyParallel: false,
  timeout: 30000, expect: { timeout: 10000 },
  use: { baseURL: "http://127.0.0.1:5181", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "firefox", use: { browserName: "firefox", ...(process.env.MINT_EDITOR_FIREFOX_EXECUTABLE ? { launchOptions: { executablePath: process.env.MINT_EDITOR_FIREFOX_EXECUTABLE } } : {}) } }, { name: "webkit", use: { browserName: "webkit" } }],
  webServer: { command: "pnpm exec vite preview --config tests/editor/browser/vite.config.ts", url: "http://127.0.0.1:5181", reuseExistingServer: false, timeout: 30000 },
});
