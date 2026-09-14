import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { loadServerConfig, type ServerConfig } from "../config";
import { registerOriginProtection } from "./originProtection";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createTestApp(overrides: Partial<ServerConfig> = {}) {
  const config = { ...loadServerConfig({ NODE_ENV: "development" }), ...overrides };
  const app = Fastify({ trustProxy: config.trustProxy });
  apps.push(app);
  registerOriginProtection(app, config);
  app.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: "/change",
    handler: (request) => ({ ip: request.ip })
  });
  return app;
}

describe("origin protection", () => {
  it.each(["notes.example.test", "notes.example.test:8443", "other.example.test"])("accepts the public HTTPS origin at %s without a fixed origin", async (host) => {
    const app = createTestApp({ production: true, trustProxy: true });
    const response = await app.inject({
      method: "POST",
      url: "/change",
      headers: { host, origin: `https://${host}`, "x-forwarded-proto": "https", "x-forwarded-for": "192.0.2.10" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().ip).toBe("192.0.2.10");
  });

  it.each([
    undefined,
    "null",
    "https://evil.example.test",
    "http://notes.example.test:8443",
    "https://notes.example.test",
    "https://notes.example.test:9443"
  ])("rejects missing or cross-origin writes in automatic mode: %s", async (origin) => {
    const app = createTestApp({ production: true, trustProxy: true });
    const response = await app.inject({
      method: "POST",
      url: "/change",
      headers: {
        host: "notes.example.test:8443",
        ...(origin === undefined ? {} : { origin }),
        "x-forwarded-proto": "https",
        "x-forwarded-host": "evil.example.test"
      }
    });
    expect(response.statusCode).toBe(403);
  });

  it("requires HTTPS in automatic production mode and ignores forwarding headers when trust is disabled", async () => {
    const untrusted = createTestApp({ production: true, trustProxy: false });
    expect((await untrusted.inject({
      method: "POST", url: "/change",
      headers: { host: "notes.example.test", origin: "https://notes.example.test", "x-forwarded-proto": "https" }
    })).statusCode).toBe(403);
    const trusted = createTestApp({ production: true, trustProxy: true });
    expect((await trusted.inject({
      method: "POST", url: "/change",
      headers: { host: "notes.example.test", origin: "http://notes.example.test", "x-forwarded-proto": "http" }
    })).statusCode).toBe(403);
    expect((await trusted.inject({
      method: "POST", url: "/change",
      headers: { host: "notes.example.test", origin: "https://notes.example.test" }
    })).statusCode).toBe(403);
    const development = createTestApp();
    const response = await development.inject({
      method: "POST", url: "/change",
      headers: { host: "localhost:8787", origin: "http://localhost:8787", "x-forwarded-proto": "https", "x-forwarded-for": "192.0.2.10" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().ip).toBe("127.0.0.1");
  });

  it("does not widen an explicit origin to match a different proxy host", async () => {
    const app = createTestApp({ production: true, trustProxy: true, appOrigin: "https://notes.example.test" });
    expect((await app.inject({
      method: "POST", url: "/change",
      headers: { host: "other.example.test", origin: "https://other.example.test", "x-forwarded-proto": "https" }
    })).statusCode).toBe(403);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)("checks explicit origins for %s", async (method) => {
    const app = createTestApp({ production: true, appOrigin: "https://notes.example.test" });
    expect((await app.inject({ method, url: "/change" })).statusCode).toBe(403);
    expect((await app.inject({ method, url: "/change", headers: { origin: "https://evil.example.test" } })).statusCode).toBe(403);
    expect((await app.inject({ method, url: "/change", headers: { origin: "https://notes.example.test" } })).statusCode).toBe(200);
  });

  it("leaves read requests and local development without an Origin usable", async () => {
    const production = createTestApp({ production: true });
    expect((await production.inject({ method: "GET", url: "/change" })).statusCode).toBe(200);
    const development = createTestApp();
    expect((await development.inject({ method: "POST", url: "/change" })).statusCode).toBe(200);
    expect((await development.inject({ method: "POST", url: "/change", headers: { host: "localhost:8787", origin: "http://localhost:8787" } })).statusCode).toBe(200);
    expect((await development.inject({ method: "POST", url: "/change", headers: { host: "localhost:8787", origin: "http://evil.example.test" } })).statusCode).toBe(403);
  });
});
