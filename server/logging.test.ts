import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { loadServerConfig } from "./config";
import { openDatabase } from "./database";
import { createLoggerOptions, LogReferenceFactory } from "./logging";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function registrationBody(username: string) {
  return {
    username,
    displayName: username,
    authSecret: `${username}-client-derived-secret-000001`,
    kdfSalt: "s".repeat(24),
    kdfParams: { algorithm: "argon2id", opsLimit: 3, memLimit: 67_108_864, version: 1 },
    wrappedVaultKey: "v".repeat(32),
    wrappedVaultNonce: "n".repeat(24),
    recoveryAuthSecret: `${username}-recovery-derived-secret-000001`,
    recoveryWrappedVaultKey: "w".repeat(32),
    recoveryWrappedVaultNonce: "q".repeat(24)
  };
}

function cookieHeader(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

describe("server logging configuration", () => {
  it("validates LOG_LEVEL and defaults it to info", () => {
    expect(loadServerConfig({ NODE_ENV: "production" }).logLevel).toBe("info");
    expect(loadServerConfig({ NODE_ENV: "development", LOG_LEVEL: "debug" }).logLevel).toBe("debug");
    expect(() => loadServerConfig({ LOG_LEVEL: "verbose" })).toThrow("Invalid LOG_LEVEL: verbose");
  });

  it("uses pretty development output and dependency-free production JSON", () => {
    const development = createLoggerOptions({ production: false, logLevel: "info" });
    const production = createLoggerOptions({ production: true, logLevel: "warn" });
    expect(development.transport).toMatchObject({ target: "pino-pretty" });
    expect(production.transport).toBeUndefined();
    expect(production.level).toBe("warn");
  });

  it("creates stable process-local anonymous references", () => {
    const first = new LogReferenceFactory(Buffer.alloc(32, 1));
    const sameSecret = new LogReferenceFactory(Buffer.alloc(32, 1));
    const nextProcess = new LogReferenceFactory(Buffer.alloc(32, 2));
    const rawId = "00000000-0000-4000-8000-000000000123";
    const reference = first.create("user", rawId);
    expect(reference).toMatch(/^usr_[A-Za-z0-9_-]{12}$/);
    expect(reference).toBe(first.create("user", rawId));
    expect(reference).toBe(sameSecret.create("user", rawId));
    expect(reference).not.toBe(first.create("object", rawId));
    expect(reference).not.toBe(nextProcess.create("user", rawId));
    expect(reference).not.toContain(rawId.slice(0, 8));
  });
});

describe("HTTP and business logs", () => {
  it("logs safe route templates, severities, request IDs, and key events", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mint-notes-logging-test-"));
    temporaryDirectories.push(directory);
    const db = openDatabase(directory);
    const lines: string[] = [];
    const config = {
      ...loadServerConfig({ NODE_ENV: "production", LOG_LEVEL: "debug" }),
      dataDirectory: directory,
      allowRegistration: true,
      appOrigin: "https://notes.example.test",
      userStorageQuotaBytes: 100
    };
    const app = await createApp({
      config,
      db,
      maintenance: false,
      logDestination: { write: (message) => lines.push(message) }
    });
    app.get("/api/test/error", async () => {
      throw new Error("controlled test failure");
    });
    app.get("/static-test", async () => ({ ok: true }));

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect((await app.inject({ method: "GET", url: "/static-test" })).statusCode).toBe(200);
    expect(lines).toHaveLength(0);

    const secretQuery = "query-value-must-not-be-logged";
    const account = registrationBody("log-private-user");
    const registration = await app.inject({
      method: "POST",
      url: `/api/auth/register?diagnostic=${secretQuery}`,
      headers: {
        origin: config.appOrigin,
        cookie: "untrusted-cookie-must-not-be-logged"
      },
      payload: account
    });
    expect(registration.statusCode, registration.body).toBe(201);
    expect(registration.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const userId = registration.json().user.id as string;
    const headers = {
      origin: config.appOrigin,
      cookie: cookieHeader(registration.headers["set-cookie"])
    };
    expect((await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.appOrigin },
      payload: {
        username: account.username,
        authSecret: "wrong-login-secret-must-not-be-logged",
        rememberDevice: false
      }
    })).statusCode).toBe(401);
    expect((await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.appOrigin },
      payload: {
        username: account.username,
        authSecret: account.authSecret,
        rememberDevice: true
      }
    })).statusCode).toBe(200);

    const objectId = "00000000-0000-4000-8000-000000000123";
    const firstCiphertext = "ciphertext-value-must-not-be-logged-01";
    const writePayload = (baseRevision: number, ciphertext: string) => ({
      objectType: "note",
      ciphertext,
      nonce: "nonce-value-must-not-be-logged",
      encryptionVersion: 1,
      baseRevision,
      idempotencyKey: crypto.randomUUID(),
      deleted: false
    });
    expect((await app.inject({
      method: "PUT",
      url: `/api/objects/${objectId}`,
      headers,
      payload: writePayload(0, firstCiphertext)
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "PUT",
      url: `/api/objects/${objectId}`,
      headers,
      payload: writePayload(0, "conflict-ciphertext-must-not-be-logged")
    })).statusCode).toBe(409);
    expect((await app.inject({
      method: "PUT",
      url: `/api/objects/${objectId}`,
      headers,
      payload: writePayload(1, "quota-ciphertext-must-not-be-logged")
    })).statusCode).toBe(413);

    expect((await app.inject({
      method: "POST",
      url: "/api/admin/account-setups",
      headers,
      payload: { username: "invited-user", displayName: "Private invite", expiresInHours: 24 }
    })).statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: "/api/test/error" })).statusCode).toBe(500);

    const records = lines.flatMap((line) => line.trim() ? [JSON.parse(line)] : []);
    const completionRecords = records.filter((record) => record.event === "http.request_completed");
    expect(completionRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ route: "/api/auth/register", statusCode: 201, level: 30 }),
      expect.objectContaining({ route: "/api/objects/:objectId", statusCode: 409, level: 40 }),
      expect.objectContaining({ route: "/api/objects/:objectId", statusCode: 413, level: 40 }),
      expect.objectContaining({ route: "/api/test/error", statusCode: 500, level: 50 })
    ]));
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "auth.registered", role: "admin" }),
      expect.objectContaining({ event: "auth.login_failed", reason: "invalid_credentials" }),
      expect.objectContaining({ event: "auth.login_succeeded", remembered: true }),
      expect.objectContaining({ event: "sync.object_conflict", reason: "revision" }),
      expect.objectContaining({ event: "storage.quota_rejected", resource: "objects" }),
      expect.objectContaining({ event: "admin.account_setup_created" }),
      expect.objectContaining({ event: "http.request_error", errorType: "Error" })
    ]));
    for (const record of records.filter((entry) => entry.event?.startsWith("http."))) {
      expect(record.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(record.durationMs === undefined || typeof record.durationMs === "number").toBe(true);
    }

    const output = lines.join("");
    for (const forbidden of [
      secretQuery,
      account.username,
      account.displayName,
      account.authSecret,
      account.recoveryAuthSecret,
      "wrong-login-secret-must-not-be-logged",
      account.wrappedVaultKey,
      "untrusted-cookie-must-not-be-logged",
      objectId,
      userId,
      firstCiphertext,
      "nonce-value-must-not-be-logged",
      "Private invite",
      "controlled test failure"
    ]) {
      expect(output).not.toContain(forbidden);
    }

    await app.close();
    db.close();
  });
});
