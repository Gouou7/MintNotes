import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { openDatabase } from "../server-dist/database.js";
import { writeObject } from "../server-dist/sync/objectStore.js";
import { issueSyncLease } from "../server-dist/sync/protocol.js";
import { registerNoteBodyRoutes } from "../server-dist/sync/noteBodies.js";
import { loadServerConfig } from "../server-dist/config.js";
import { operationId } from "@mint-notes/application-client";
import { ApplicationStore } from "../packages/application-client/dist/node/store.js";

// Only temporary databases and child processes created by this script are touched.
const scope = { userId: "crash-test-user" };
const config = loadServerConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" });
async function removeFixture(directory) {
  const target = resolve(directory), pathFromTemp = relative(resolve(tmpdir()), target);
  assert(pathFromTemp && !pathFromTemp.startsWith("..") && !isAbsolute(pathFromTemp)
    && /^mint-(sync|cache)-crash-/.test(basename(target)), "Unexpected crash fixture cleanup target");
  await rm(target, { recursive: true, force: true });
}
const serverPoints = {
  "block-row": /INSERT INTO note_body_blocks VALUES/,
  "manifest-row": /INSERT INTO objects \(/,
  "reference-removal": /DELETE FROM note_body_refs/,
  "first-reference": /INSERT INTO note_body_refs VALUES/,
  receipt: /INSERT INTO sync_receipts\(/,
  "change-event": /INSERT INTO changes \(/,
  watermark: /UPDATE sync_state SET head/
};
const cachePoints = {
  "cache-operation": /INSERT INTO operations /,
  "cache-block": /INSERT OR IGNORE INTO body_blocks/,
  "cache-object": /INSERT INTO objects /,
  "recovery-block": /INSERT OR IGNORE INTO body_blocks/,
  "recovery-graph": /UPDATE operations SET body/
};
function pause(point) {
  process.send({ checkpoint: point });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error("Unreachable crash checkpoint");
}
function intercept(db, point, pattern) {
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => new Proxy(prepare(sql), {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      return (...args) => {
        const result = value.apply(target, args);
        if (key === "run" && pattern?.test(sql)) pause(point);
        return result;
      };
    }
  });
}
async function upload(db, input) {
  const app = Fastify();
  registerNoteBodyRoutes(app, db, config, "/api", async () => {}, () => scope);
  try {
    const response = await app.inject({ method: "POST", url: `/api/notes/${input.noteId}/body-blocks/batch`,
      headers: { "x-webmd-sync-lease": input.lease }, payload: { blocks: input.blocks } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().accepted, input.blocks.map((block) => block.blockId));
  } finally { await app.close(); }
}
async function child(directory, point) {
  const input = JSON.parse(await readFile(join(directory, "fixture.json"), "utf8"));
  if (point.startsWith("cache-") || point.startsWith("recovery-")) {
    const store = new ApplicationStore(directory, input.origin, input.connection);
    intercept(store.db, point, cachePoints[point]);
    if (point.startsWith("recovery-")) store.saveOperation(input.recovery);
    else store.stage(input.operation);
    pause(point);
  } else {
    const db = openDatabase(directory);
    intercept(db, point, serverPoints[point]);
    if (point === "block-row" || point === "blocks-committed") await upload(db, input);
    else assert.equal(writeObject(db, scope, input.noteId, input.write, 10_000_000).status, "accepted");
    pause(point);
  }
}
async function killAt(directory, point) {
  const processUnderTest = fork(fileURLToPath(import.meta.url), ["--child", directory, point], {
    execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc"]
  });
  let stderr = "";
  processUnderTest.stderr.on("data", (data) => { stderr = (stderr + data).slice(-3000); });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Checkpoint timed out: ${point}\n${stderr}`)), 15_000);
      processUnderTest.once("error", (error) => { clearTimeout(timeout); reject(error); });
      processUnderTest.once("exit", () => { clearTimeout(timeout); reject(new Error(`Exited before ${point}: ${stderr}`)); });
      processUnderTest.once("message", (message) => {
        clearTimeout(timeout);
        if (message.checkpoint === point) resolve();
        else reject(new Error("Unexpected crash checkpoint"));
      });
    });
    const exited = new Promise((resolve) => processUnderTest.once("exit", resolve));
    processUnderTest.kill("SIGKILL");
    await exited;
  } finally {
    if (processUnderTest.exitCode === null && processUnderTest.signalCode === null) {
      const exited = new Promise((resolve) => processUnderTest.once("exit", resolve));
      processUnderTest.kill("SIGKILL"); await exited;
    }
  }
}
const tables = ["objects", "note_body_refs", "sync_receipts", "changes", "sync_state"];
const snapshot = (db) => tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
async function serverCase(point) {
  const directory = await mkdtemp(join(tmpdir(), "mint-sync-crash-"));
  let db;
  try {
    db = openDatabase(directory);
    db.prepare(`INSERT INTO users (id,username,display_name,role,auth_salt,auth_hash,kdf_salt,kdf_params,
      wrapped_vault_key,wrapped_vault_nonce,recovery_auth_salt,recovery_auth_hash,recovery_wrapped_vault_key,recovery_wrapped_vault_nonce,created_at)
      VALUES (?, 'crash-fixture','Crash fixture','user','a','b','c','{}','d','e','f','g','h','i',?)`).run(scope.userId, new Date().toISOString());
    const noteId = randomUUID(), oldId = randomUUID();
    db.prepare("INSERT INTO note_body_blocks VALUES (?, ?, ?, ?, ?)").run(scope.userId, noteId, oldId, "o".repeat(32), "n".repeat(16));
    const initial = { objectType: "note", ciphertext: "old encrypted manifest".repeat(3), nonce: "n".repeat(16), encryptionVersion: 2,
      baseRevision: 0, deleted: false, bodyBlockIds: [oldId], idempotencyKey: operationId() };
    writeObject(db, scope, noteId, initial, 10_000_000);
    const blocks = [0, 1, 2].map((value) => ({ blockId: randomUUID(), ciphertext: String(value).repeat(40_000), nonce: "m".repeat(16) }));
    const input = { noteId, blocks, lease: issueSyncLease(db, scope.userId), write: { ...initial,
      ciphertext: "new complete encrypted manifest".repeat(3), baseRevision: 1,
      bodyBlockIds: blocks.map((block) => block.blockId), idempotencyKey: operationId() } };
    if (point !== "block-row" && point !== "blocks-committed") await upload(db, input);
    const before = snapshot(db);
    await writeFile(join(directory, "fixture.json"), JSON.stringify(input));
    db.close(); db = null;
    await killAt(directory, point);
    db = openDatabase(directory);
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
    if (point !== "manifest-committed") assert.deepEqual(snapshot(db), before, `${point}: old manifest/ref/receipt/cursor changed`);
    const count = db.prepare("SELECT COUNT(*) AS count FROM note_body_blocks").get().count;
    assert.equal(count, point === "block-row" ? 1 : 4);
    // Retry exactly the same bytes and operation identity after the hard process exit.
    await upload(db, input);
    const result = writeObject(db, scope, noteId, input.write, 10_000_000);
    assert.equal(result.status, point === "manifest-committed" ? "idempotent" : "accepted");
    assert.equal(result.revision, 2);
    assert.equal(writeObject(db, scope, noteId, input.write, 10_000_000).status, "idempotent");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sync_receipts").get().count, 2);
    assert.equal(db.prepare("SELECT ciphertext FROM objects WHERE object_id = ?").get(noteId).ciphertext, input.write.ciphertext);
  } finally { db?.close(); await removeFixture(directory); }
}
async function cacheCase(point) {
  const directory = await mkdtemp(join(tmpdir(), "mint-cache-crash-"));
  let store;
  try {
    const origin = "https://crash-fixture.example", connection = randomUUID(), noteId = randomUUID();
    store = new ApplicationStore(directory, origin, connection);
    const original = { objectId: noteId, objectType: "note", ciphertext: "original complete encrypted note", nonce: "old nonce",
      encryptionVersion: 1, revision: 1, baseRevision: 0, deleted: false, idempotencyKey: operationId() };
    const oldOperation = { operationId: original.idempotencyKey, requestHash: "original identity", body: { note: original,
      sourceAttachments: [], conflictNoteId: randomUUID() }, result: { operationId: original.idempotencyKey, objectId: noteId, status: "pending" } };
    store.stage(oldOperation); store.set("cursor", 42);
    const blocks = [0, 1, 2].map((value) => ({ blockId: randomUUID(), ciphertext: String(value).repeat(40_000), nonce: "nonce" }));
    const write = { ...original, objectId: point.startsWith("recovery-") ? oldOperation.body.conflictNoteId : noteId,
      ciphertext: "new complete encrypted note manifest", encryptionVersion: 2,
      revision: point.startsWith("recovery-") ? 1 : 2, baseRevision: point.startsWith("recovery-") ? 0 : 1,
      idempotencyKey: operationId(), bodyBlockIds: blocks.map((block) => block.blockId), bodyBlocks: blocks };
    const operation = { operationId: write.idempotencyKey, requestHash: "new identity", body: { note: write, sourceAttachments: [] },
      result: { operationId: write.idempotencyKey, objectId: noteId, status: "pending" } };
    const recovery = { ...oldOperation, body: { ...oldOperation.body, conflict: { note: write, attachments: [], chunks: [] } } };
    await writeFile(join(directory, "fixture.json"), JSON.stringify({ origin, connection, operation, recovery }));
    store.close(); store = null;
    await killAt(directory, point);
    store = new ApplicationStore(directory, origin, connection);
    assert.equal(store.get("cursor"), 42);
    assert.equal(store.db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    if (point.startsWith("recovery-")) {
      assert.deepEqual(store.object(noteId), original);
      assert.deepEqual(store.operation(oldOperation.operationId), point === "recovery-graph" ? recovery : oldOperation);
      assert.equal(store.operation(oldOperation.operationId).body.conflictNoteId, oldOperation.body.conflictNoteId);
      if (point === "recovery-graph") for (const block of blocks) assert.deepEqual(store.bodyBlock(write.objectId, block.blockId), block);
      store.saveOperation(recovery);
      assert.deepEqual(store.operation(oldOperation.operationId).body.note, original);
    } else {
      assert.deepEqual(store.operation(oldOperation.operationId), oldOperation);
      if (point !== "cache-committed") {
        assert.deepEqual(store.object(noteId), original);
        assert.equal(store.operation(operation.operationId), null);
        assert.equal(store.bodyBlock(noteId, blocks[0].blockId), null);
        store.stage(operation);
      }
      assert.deepEqual(store.operation(operation.operationId), operation);
      assert.deepEqual(store.object(noteId), write);
      for (const block of blocks) assert.deepEqual(store.bodyBlock(noteId, block.blockId), block);
    }
  } finally { store?.close(); await removeFixture(directory); }
}

if (process.argv[2] === "--child") {
  await child(process.argv[3], process.argv[4]);
} else {
  const cases = [...Object.keys(serverPoints), "blocks-committed", "manifest-committed",
    ...Object.keys(cachePoints), "cache-committed"];
  for (const point of cases) {
    await (point.startsWith("cache-") || point.startsWith("recovery-") ? cacheCase(point) : serverCase(point));
    console.log(`${point}: passed after SIGKILL and reopening`);
  }
  console.log(JSON.stringify({ hardCrashCheckpoints: cases.length, databaseIntegrity: true, exactRetry: true, retainedSources: true }));
}
