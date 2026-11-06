import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile, access } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";

function run(args, env, ipc = false) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe", ...(ipc ? ["ipc"] : [])]
  });
  let output = "";
  let errors = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { errors += chunk; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15000);
  const done = once(child, "close").then(([exitCode]) => ({ exitCode, output, errors })).finally(() => clearTimeout(timeout));
  return { child, done, lines: () => output.split("\n").slice(0, -1).filter((line) => line.startsWith("{")).map((line) => JSON.parse(line)) };
}

function serverEnvironment(directory, port, overrides = {}) {
  return {
    NODE_ENV: "development", HOST: "127.0.0.1", PORT: String(port),
    LOG_LEVEL: "info", APP_VERSION: "0.36.0", APP_ORIGIN: "",
    MINT_NOTES_SMOKE_STORAGE_PATH: directory, ...overrides
  };
}

async function expectFatal(env, phase, code) {
  const server = run(["server-dist/index.js"], env);
  const result = await server.done;
  assert.equal(result.exitCode, 1, result.errors);
  const fatal = server.lines().filter((line) => line.event === "server.fatal");
  assert.equal(fatal.length, 1, result.output);
  assert.equal(fatal[0].phase, phase);
  assert.equal(fatal[0].code, code);
  assert.ok(fatal[0].hint);
  assert.doesNotMatch(result.output, /fixture-secret|errorStack|errorMessage/);
}

export async function smokeServerDiagnostics(port) {
  const root = await mkdtemp(join(tmpdir(), "mint-diagnostics-"));
  const legacy = join(root, "legacy");
  const locked = join(root, "locked");
  const blocked = join(root, "blocked");
  let probeResponse = 200;
  const listener = createServer((_request, response) => {
    if (probeResponse) response.writeHead(probeResponse).end();
  });
  try {
    await mkdir(legacy);
    const fixture = new Database(join(legacy, "notes.sqlite"));
    fixture.pragma("user_version = 5");
    fixture.close();

    const migrated = run(["--input-type=module", "-e", `
      process.once("message", () => { process.emit("SIGTERM"); process.disconnect(); });
      await import("./server-dist/index.js");
    `], serverEnvironment(legacy, port), true);
    try {
      for (let attempt = 0; attempt < 100 && !migrated.lines().some((line) => line.event === "server.started"); attempt++) {
        if (migrated.child.exitCode !== null) break;
        await delay(50);
      }
      const records = migrated.lines();
      assert.equal(records[0]?.event, "server.starting");
      assert.deepEqual(records.filter((line) => line.event === "server.startup_step").map((line) => line.phase),
        ["config", "module_load", "storage_lock", "database_open", "migration_backup", "migration_apply", "app_setup", "http_listen"]);
      const started = records.find((line) => line.event === "server.started");
      assert.equal(started?.version, "0.36.0");
      assert.equal(started.port, port);
      assert.match(started.bootId, /^[a-f0-9]{16}$/);
      await access(join(legacy, "backups", "pre-schema6.sqlite.sha256"));
      migrated.child.send("stop");
      assert.equal((await migrated.done).exitCode, 0);
      assert.deepEqual(migrated.lines().slice(-2).map((line) => line.event), ["server.stopping", "server.stopped"]);
      assert.ok(migrated.lines().every((line) => line.bootId === started.bootId));
    } finally {
      if (migrated.child.exitCode === null && migrated.child.signalCode === null) migrated.child.kill("SIGKILL");
      await migrated.done;
    }

    await expectFatal(serverEnvironment(root, port, { LOG_LEVEL: "fixture-secret" }), "config", "CONFIG_INVALID");
    await mkdir(locked);
    await writeFile(join(locked, ".mint-notes.lock"), String(process.pid));
    await expectFatal(serverEnvironment(locked, port, { LOG_LEVEL: "silent" }), "storage_lock", "STORAGE_IN_USE_STOP_SERVICE_FIRST");

    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const probePort = listener.address().port;
    await expectFatal(serverEnvironment(blocked, probePort), "http_listen", "EADDRINUSE");

    const probe = () => run(["server-dist/healthcheck.js"], { PORT: String(probePort) }).done;
    const healthy = await probe();
    assert.equal(healthy.exitCode, 0);
    assert.equal(healthy.output, "");
    probeResponse = 503;
    const rejected = await probe();
    assert.equal(rejected.exitCode, 1);
    assert.deepEqual(JSON.parse(rejected.output), { event: "healthcheck.failed", code: "HTTP_ERROR", status: 503 });
    probeResponse = 0;
    const timedOut = await probe();
    assert.equal(timedOut.exitCode, 1);
    assert.equal(JSON.parse(timedOut.output).code, "TIMEOUT");
    listener.closeAllConnections();
    await new Promise((resolve) => listener.close(resolve));
    const refused = await probe();
    assert.equal(refused.exitCode, 1);
    assert.equal(JSON.parse(refused.output).code, "CONNECTION_REFUSED");
    console.log("Server startup and health diagnostics passed.");
  } finally {
    if (listener.listening) {
      listener.closeAllConnections();
      await new Promise((resolve) => listener.close(resolve));
    }
    await rm(root, { recursive: true, force: true });
  }
}
