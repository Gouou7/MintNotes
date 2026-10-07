import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)), publicDir: fileURLToPath(new URL("../../../public", import.meta.url)), plugins: [react()],
  build: { outDir: "../../../.generated/editor-fixture", emptyOutDir: true, rollupOptions: { input: { editor: fileURLToPath(new URL("index.html", import.meta.url)), workspace: fileURLToPath(new URL("workspace.html", import.meta.url)) } } },
  preview: { host: "127.0.0.1", port: 5181, strictPort: true },
});
