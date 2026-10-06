import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@voidzero-dev/vite-plus-test": "vitest" } },
  test: { environment: "happy-dom", include: [".generated/typora-web/tests/**/*.test.ts"], maxWorkers: 1 },
});
