import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "./dist/index.js";

const manifest = JSON.parse(await readFile(new URL("./openclaw.plugin.json", import.meta.url), "utf8"));
const directory = await mkdtemp(join(tmpdir(), "mint-plugin-runtime-"));
const key = `mint-app-v1.${crypto.randomUUID()}.${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
try {
  for (const registrationMode of ["discovery", "tool-discovery", "full"]) {
    const tools = []; const services = [];
    plugin.register({ registrationMode, pluginConfig: { baseUrl: "http://127.0.0.1:1", applicationKey: key }, registerTool: (tool, options) => { assert.equal(options.optional, true); tools.push(tool); }, registerService: (service) => services.push(service) });
    assert.deepEqual(tools.map((tool) => tool.name), manifest.contracts.tools);
    assert.equal(services.length, registrationMode === "full" ? 1 : 0);
    if (registrationMode !== "full") continue;
    await services[0].start({ stateDir: directory, config: { plugins: { entries: { "mint-notes": { config: { baseUrl: "http://127.0.0.1:1", applicationKey: key } } } } } });
    const result = await tools[0].execute("runtime-test", {});
    assert.deepEqual(result.details, { error: "OFFLINE_CACHE_MISSING" });
    assert.ok(!JSON.stringify(result).includes(key));
    await services[0].stop({ stateDir: directory });
    const stopped = await tools[0].execute("runtime-test-stopped", {});
    assert.deepEqual(stopped.details, { error: "CLIENT_NOT_STARTED" });
    await services[0].start({ stateDir: directory, config: { plugins: { entries: { "mint-notes": { config: { baseUrl: "http://127.0.0.1:1", applicationKey: { source: "env", provider: "missing", id: "UNAVAILABLE" } } } } } } });
    assert.deepEqual((await tools[0].execute("runtime-test-unresolved-secret", {})).details, { error: "CONFIG_INVALID" });
    await services[0].stop({ stateDir: directory });
  }
  console.log("OpenClaw SDK registration, worker startup and shutdown passed");
} finally { await rm(directory, { recursive: true, force: true }); }
