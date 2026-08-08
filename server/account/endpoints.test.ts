import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadServerConfig } from "../config.js";
import { openDatabase } from "../database.js";
import { cleanupInactiveEndpoints, INACTIVE_ENDPOINT_RETENTION_DAYS } from "./endpoints.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
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

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "mint-notes-endpoints-test-"));
  temporaryDirectories.push(directory);
  const db = openDatabase(directory);
  const config = {
    ...loadServerConfig({ NODE_ENV: "development" }),
    dataDirectory: directory,
    allowRegistration: true,
    appOrigin: "https://notes.example.test"
  };
  const app = await createApp({ config, db, maintenance: false });
  const register = async (username: string) => app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { origin: config.appOrigin, "user-agent": `${username} current device` },
    payload: registrationBody(username)
  });
  return { app, config, db, register };
}

describe("login device endpoints", () => {
  it("lets an account immediately remove its inactive endpoint without exposing another account", async () => {
    const { app, config, db, register } = await fixture();
    const alphaRegistration = await register("alpha");
    const bravoRegistration = await register("bravo");
    const alphaCookie = cookieHeader(alphaRegistration.headers["set-cookie"]);
    const bravoCookie = cookieHeader(bravoRegistration.headers["set-cookie"]);
    const otherLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.appOrigin, "user-agent": "Firefox on Windows" },
      payload: { username: "alpha", authSecret: registrationBody("alpha").authSecret, rememberDevice: false }
    });
    const otherEndpointId = otherLogin.json().endpoint.id as string;
    const otherCookie = cookieHeader(otherLogin.headers["set-cookie"]);
    expect((await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: otherCookie, origin: config.appOrigin }
    })).statusCode).toBe(200);

    expect((await app.inject({
      method: "DELETE",
      url: `/api/account/endpoints/${otherEndpointId}`,
      headers: { cookie: bravoCookie, origin: config.appOrigin }
    })).statusCode).toBe(404);
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/account/endpoints/${otherEndpointId}`,
      headers: { cookie: alphaCookie, origin: config.appOrigin }
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ ok: true, action: "removed" });
    expect(db.prepare("SELECT 1 FROM trusted_endpoints WHERE endpoint_id = ?").get(otherEndpointId)).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM sessions WHERE endpoint_id = ?").get(otherEndpointId)).toBeUndefined();

    await app.close();
    db.close();
  });

  it("automatically deletes signed-out and expired endpoints after the retention timeout", async () => {
    const { app, config, db, register } = await fixture();
    await register("alpha");
    const login = async (userAgent: string) => app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.appOrigin, "user-agent": userAgent },
      payload: { username: "alpha", authSecret: registrationBody("alpha").authSecret, rememberDevice: false }
    });
    const signedOutLogin = await login("signed-out device");
    const expiredLogin = await login("expired device");
    const signedOutId = signedOutLogin.json().endpoint.id as string;
    const expiredId = expiredLogin.json().endpoint.id as string;
    await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: cookieHeader(signedOutLogin.headers["set-cookie"]), origin: config.appOrigin }
    });
    const now = new Date("2026-08-09T12:00:00.000Z");
    const old = new Date(now.getTime() - (INACTIVE_ENDPOINT_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE trusted_endpoints SET revoked_at = ?, last_seen_at = ? WHERE endpoint_id = ?")
      .run(old, old, signedOutId);
    db.prepare("UPDATE trusted_endpoints SET last_seen_at = ? WHERE endpoint_id = ?").run(old, expiredId);
    db.prepare("UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE endpoint_id = ?").run(old, old, expiredId);

    expect(cleanupInactiveEndpoints(db, now)).toBe(2);
    expect(db.prepare("SELECT 1 FROM trusted_endpoints WHERE endpoint_id IN (?, ?)").all(signedOutId, expiredId)).toEqual([]);

    await app.close();
    db.close();
  });
});
