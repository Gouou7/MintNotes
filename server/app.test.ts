import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { loadServerConfig } from "./config";
import { openDatabase } from "./database";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function cookieHeader(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

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

describe("createApp", () => {
  it("registers security hooks and keeps object reads scoped to the authenticated account", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mint-notes-app-test-"));
    temporaryDirectories.push(directory);
    const db = openDatabase(directory);
    const config = {
      ...loadServerConfig({ NODE_ENV: "development" }),
      dataDirectory: directory,
      allowRegistration: true,
      appOrigin: "https://notes.example.test"
    };
    const app = await createApp({ config, db, maintenance: false });

    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { origin: "https://evil.example.test" },
      payload: registrationBody("blocked")
    })).statusCode).toBe(403);

    const alphaRegistration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { origin: config.appOrigin },
      payload: registrationBody("alpha")
    });
    const bravoRegistration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { origin: config.appOrigin },
      payload: registrationBody("bravo")
    });
    expect(alphaRegistration.statusCode).toBe(201);
    expect(bravoRegistration.statusCode).toBe(201);
    const alphaCookie = cookieHeader(alphaRegistration.headers["set-cookie"]);
    const bravoCookie = cookieHeader(bravoRegistration.headers["set-cookie"]);
    const objectId = "00000000-0000-4000-8000-000000000123";
    const write = (cookie: string, ciphertext: string) => app.inject({
      method: "PUT",
      url: `/api/objects/${objectId}`,
      headers: { cookie, origin: config.appOrigin },
      payload: {
        objectType: "note",
        ciphertext,
        nonce: "z".repeat(24),
        encryptionVersion: 1,
        baseRevision: 0,
        idempotencyKey: crypto.randomUUID(),
        deleted: false
      }
    });
    expect((await write(alphaCookie, "A".repeat(32))).statusCode).toBe(200);
    expect((await write(bravoCookie, "B".repeat(32))).statusCode).toBe(200);

    const alphaPull = await app.inject({ method: "GET", url: "/api/sync?since=0", headers: { cookie: alphaCookie } });
    const bravoPull = await app.inject({ method: "GET", url: "/api/sync?since=0", headers: { cookie: bravoCookie } });
    expect(alphaPull.json().changes).toEqual([expect.objectContaining({ objectId, ciphertext: "A".repeat(32) })]);
    expect(bravoPull.json().changes).toEqual([expect.objectContaining({ objectId, ciphertext: "B".repeat(32) })]);

    await app.close();
    db.close();
  });
});
