import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mint-storage-browser-"));
const child = spawn(process.execPath, ["server-dist/index.js"], {
  env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: "8791", MINT_NOTES_SMOKE_STORAGE_PATH: directory, ALLOW_REGISTRATION: "true", LOG_LEVEL: "silent" },
  stdio: "inherit"
});
process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
await new Promise((resolve) => child.once("exit", resolve));
await rm(directory, { recursive: true, force: true });
