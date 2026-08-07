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
      payload: {
        ...registrationBody("bravo"),
        envelopeVersion: 2,
        envelopeContext: "registration_context_1234"
      }
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

  it("changes a legacy username atomically and preserves password and recovery credentials", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mint-notes-username-test-"));
    temporaryDirectories.push(directory);
    const db = openDatabase(directory);
    const config = {
      ...loadServerConfig({ NODE_ENV: "development" }),
      dataDirectory: directory,
      allowRegistration: true,
      appOrigin: "https://notes.example.test"
    };
    const app = await createApp({ config, db, maintenance: false });
    const alpha = registrationBody("alpha");
    const bravo = registrationBody("bravo");
    const alphaRegistration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { origin: config.appOrigin },
      payload: alpha
    });
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { origin: config.appOrigin },
      payload: bravo
    });
    const alphaCookie = cookieHeader(alphaRegistration.headers["set-cookie"]);
    const otherDeviceLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.appOrigin, "user-agent": "Mint Notes other device" },
      payload: { username: "alpha", authSecret: alpha.authSecret, rememberDevice: true }
    });
    const otherDeviceCookie = cookieHeader(otherDeviceLogin.headers["set-cookie"]);
    const changePayload = {
      username: "renamed-alpha",
      currentAuthSecret: alpha.authSecret,
      currentRecoveryAuthSecret: alpha.recoveryAuthSecret,
      envelopeVersion: 2,
      envelopeContext: "abcdefghijklmnopqrstuv",
      wrappedVaultKey: "x".repeat(32),
      wrappedVaultNonce: "y".repeat(24),
      recoveryWrappedVaultKey: "z".repeat(32),
      recoveryWrappedVaultNonce: "r".repeat(24)
    };

    expect((await app.inject({
      method: "PATCH",
      url: "/api/account/username",
      headers: { cookie: alphaCookie, origin: config.appOrigin },
      payload: { ...changePayload, username: "bravo" }
    })).statusCode).toBe(409);
    expect((await app.inject({
      method: "PATCH",
      url: "/api/account/username",
      headers: { cookie: alphaCookie, origin: config.appOrigin },
      payload: { ...changePayload, currentRecoveryAuthSecret: "incorrect-recovery-secret-value" }
    })).statusCode).toBe(401);

    const changed = await app.inject({
      method: "PATCH",
      url: "/api/account/username",
      headers: { cookie: alphaCookie, origin: config.appOrigin },
      payload: changePayload
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().user.username).toBe("renamed-alpha");
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: otherDeviceCookie } })).statusCode).toBe(401);
    expect((await app.inject({
      method: "PATCH",
      url: "/api/account/username",
      headers: { cookie: alphaCookie, origin: config.appOrigin },
      payload: { ...changePayload, username: "another-alpha", envelopeContext: "different_context_12345" }
    })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/auth/parameters/alpha" })).statusCode).toBe(404);
    const parameters = await app.inject({ method: "GET", url: "/api/auth/parameters/renamed-alpha" });
    expect(parameters.statusCode).toBe(200);
    expect(parameters.json()).toMatchObject({
      envelopeBinding: { version: 2, context: changePayload.envelopeContext },
      recoveryWrappedVaultKey: changePayload.recoveryWrappedVaultKey
    });
    expect((await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.appOrigin },
      payload: { username: "alpha", authSecret: alpha.authSecret, rememberDevice: false }
    })).statusCode).toBe(401);
    const renamedLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.appOrigin },
      payload: { username: "renamed-alpha", authSecret: alpha.authSecret, rememberDevice: false }
    });
    expect(renamedLogin.statusCode).toBe(200);
    expect(renamedLogin.json()).toMatchObject({
      user: { username: "renamed-alpha" },
      wrappedVaultKey: changePayload.wrappedVaultKey
    });

    await app.close();
    db.close();
  });

  it("can replace a missing recovery key atomically with the username change", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mint-notes-username-recovery-test-"));
    temporaryDirectories.push(directory);
    const db = openDatabase(directory);
    const config = {
      ...loadServerConfig({ NODE_ENV: "development" }),
      dataDirectory: directory,
      allowRegistration: true,
      appOrigin: "https://notes.example.test"
    };
    const app = await createApp({ config, db, maintenance: false });
    const account = registrationBody("delta");
    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { origin: config.appOrigin },
      payload: account
    });
    const cookie = cookieHeader(registration.headers["set-cookie"]);
    const replacementRecoveryAuthSecret = "delta-replacement-recovery-secret-0001";
    const changed = await app.inject({
      method: "PATCH",
      url: "/api/account/username",
      headers: { cookie, origin: config.appOrigin },
      payload: {
        username: "renamed-delta",
        currentAuthSecret: account.authSecret,
        replacementRecoveryAuthSecret,
        envelopeVersion: 2,
        envelopeContext: "replacement_context_1234",
        wrappedVaultKey: "j".repeat(32),
        wrappedVaultNonce: "k".repeat(24),
        recoveryWrappedVaultKey: "l".repeat(32),
        recoveryWrappedVaultNonce: "m".repeat(24)
      }
    });
    expect(changed.statusCode).toBe(200);
    const recover = (recoveryAuthSecret: string) => app.inject({
      method: "POST",
      url: "/api/auth/recover",
      headers: { origin: config.appOrigin },
      payload: {
        username: "renamed-delta",
        recoveryAuthSecret,
        newAuthSecret: "delta-new-authentication-secret-0001",
        newKdfSalt: "s".repeat(24),
        newKdfParams: { algorithm: "argon2id", opsLimit: 3, memLimit: 67_108_864, version: 1 },
        newWrappedVaultKey: "n".repeat(32),
        newWrappedVaultNonce: "o".repeat(24)
      }
    });
    expect((await recover(account.recoveryAuthSecret)).statusCode).toBe(401);
    expect((await recover(replacementRecoveryAuthSecret)).statusCode).toBe(200);

    await app.close();
    db.close();
  });
});
