import { randomBytes, randomUUID } from "node:crypto";
import { browserInject } from "../auth/browserInject.testSupport.js";
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
  const register = async (username: string) => browserInject(app, {
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
    const otherLogin = await browserInject(app, {
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.appOrigin, "user-agent": "Firefox on Windows" },
      payload: { username: "alpha", authSecret: registrationBody("alpha").authSecret, rememberDevice: false }
    });
    const otherEndpointId = otherLogin.json().endpoint.id as string;
    const otherCookie = cookieHeader(otherLogin.headers["set-cookie"]);
    expect((await browserInject(app, {
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: otherCookie, origin: config.appOrigin }
    })).statusCode).toBe(200);

    expect((await browserInject(app, {
      method: "DELETE",
      url: `/api/account/endpoints/${otherEndpointId}`,
      headers: { cookie: bravoCookie, origin: config.appOrigin }
    })).statusCode).toBe(404);
    const removed = await browserInject(app, {
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
    const login = async (userAgent: string) => browserInject(app, {
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.appOrigin, "user-agent": userAgent },
      payload: { username: "alpha", authSecret: registrationBody("alpha").authSecret, rememberDevice: false }
    });
    const signedOutLogin = await login("signed-out device");
    const expiredLogin = await login("expired device");
    const signedOutId = signedOutLogin.json().endpoint.id as string;
    const expiredId = expiredLogin.json().endpoint.id as string;
    await browserInject(app, {
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

describe("browser session context", () => {
  it("binds requests to the active account and retires only the specified recovery grant", async () => {
    const { app, config, db, register } = await fixture();
    try {
      const origin = config.appOrigin;
      const alpha = await register("alpha");
      await register("beta");
      const login = (name: string, cookie: string, rememberDevice = true) => browserInject(app, {
        method: "POST", url: "/api/auth/login", headers: { origin, cookie },
        payload: { username: name, authSecret: registrationBody(name).authSecret, rememberDevice }
      });
      const a = await login("alpha", cookieHeader(alpha.headers["set-cookie"]));
      const aCookie = cookieHeader(a.headers["set-cookie"]);
      const grant = { id: randomUUID(), secret: randomBytes(32).toString("base64url") };
      const enroll = (cookie: string, credential: typeof grant) => browserInject(app, {
        method: "PUT", url: "/api/auth/device-grant", headers: { origin, cookie },
        payload: { ...credential, authSecret: registrationBody("alpha").authSecret }
      });
      expect((await enroll(aCookie, grant)).json()).toEqual({ id: grant.id });
      expect((await enroll(aCookie, grant)).json()).toEqual({ id: grant.id });
      expect(db.prepare("SELECT secret_hash FROM device_grants WHERE grant_id = ?").get(grant.id)).not.toMatchObject({ secret_hash: grant.secret });

      const oldClient = await app.inject({
        method: "POST", url: "/api/auth/login", headers: { origin, cookie: aCookie },
        payload: { username: "beta", authSecret: registrationBody("beta").authSecret }
      });
      expect(oldClient.statusCode).toBe(426);
      expect(oldClient.headers["set-cookie"]).toBeUndefined();
      const b = await login("beta", aCookie);
      const bCookie = cookieHeader(b.headers["set-cookie"]);
      expect((await app.inject({ url: "/api/auth/me", headers: { cookie: bCookie } })).statusCode).toBe(426);
      const stale = await app.inject({
        url: "/api/auth/me", headers: { cookie: bCookie, "x-webmd-session": a.json().sessionId }
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.headers["set-cookie"]).toBeUndefined();
      expect((await browserInject(app, { url: "/api/auth/me", headers: { cookie: aCookie } })).statusCode).toBe(401);

      const resume = (cookie: string, credential = grant) => browserInject(app, {
        method: "POST", url: "/api/auth/session/resume", headers: { origin, cookie }, payload: credential
      });
      expect((await resume("")).statusCode).toBe(401);
      expect((await resume(bCookie, { ...grant, secret: randomBytes(32).toString("base64url") })).statusCode).toBe(401);
      const expires = db.prepare("UPDATE device_grants SET expires_at = ? WHERE grant_id = ?");
      expires.run(new Date(Date.now() - 86_400_000).toISOString(), grant.id);
      expect((await resume(bCookie)).statusCode).toBe(401);
      expires.run(new Date(Date.now() + 86_400_000).toISOString(), grant.id);
      const recovered = await resume(bCookie);
      expect(recovered.statusCode).toBe(200);
      expect(recovered.json().user.username).toBe("alpha");
      const recoveredCookie = cookieHeader(recovered.headers["set-cookie"]);
      expect((await resume(recoveredCookie)).json().sessionId).toBe(recovered.json().sessionId);
      const newer = { id: randomUUID(), secret: randomBytes(32).toString("base64url") };
      expect((await enroll(recoveredCookie, newer)).statusCode).toBe(200);
      const revoke = (grantId: string) => browserInject(app, {
        method: "POST", url: "/api/auth/device-grant/revoke", headers: { origin, cookie: recoveredCookie },
        payload: { endpointId: recovered.json().endpoint.id, grantId }
      });
      expect((await revoke(grant.id)).statusCode).toBe(200);
      expect((await resume(recoveredCookie, newer)).statusCode).toBe(200);
      expect((await revoke(newer.id)).statusCode).toBe(200);
      expect((await resume(recoveredCookie, newer)).statusCode).toBe(401);

      const old = await login("alpha", recoveredCookie, false);
      const fresh = await login("alpha", cookieHeader(old.headers["set-cookie"]), false);
      const freshCookie = cookieHeader(fresh.headers["set-cookie"]);
      const endpointId = fresh.json().endpoint.id;
      const revokeSession = (sessionId?: string) => browserInject(app, {
        method: "POST", url: "/api/auth/device-grant/revoke", headers: { origin, cookie: freshCookie },
        payload: { endpointId, sessionId }
      });
      expect((await revokeSession()).statusCode).toBe(200);
      expect((await revokeSession(old.json().sessionId)).statusCode).toBe(200);
      expect((await browserInject(app, { url: "/api/auth/me", headers: { cookie: freshCookie } })).statusCode).toBe(200);
      expect((await revokeSession(fresh.json().sessionId)).statusCode).toBe(200);
      expect((await browserInject(app, { url: "/api/auth/me", headers: { cookie: freshCookie } })).statusCode).toBe(401);
    } finally {
      await app.close();
      db.close();
    }
  });
});
