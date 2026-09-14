import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./config";

describe("server configuration", () => {
  it("allows an omitted application origin and validates explicit HTTPS origins in production", () => {
    expect(loadServerConfig({ NODE_ENV: "production" }).appOrigin).toBeUndefined();
    expect(loadServerConfig({ NODE_ENV: "production", APP_ORIGIN: "" }).appOrigin).toBeUndefined();
    expect(() => loadServerConfig({ NODE_ENV: "production", APP_ORIGIN: "not-a-url" })).toThrow("Invalid APP_ORIGIN");
    expect(() => loadServerConfig({ NODE_ENV: "production", APP_ORIGIN: "http://notes.example.test" })).toThrow("Invalid APP_ORIGIN");
    expect(() => loadServerConfig({ NODE_ENV: "production", APP_ORIGIN: "https://notes.example.test/" })).toThrow("Invalid APP_ORIGIN");
    expect(loadServerConfig({ NODE_ENV: "production", APP_ORIGIN: "https://notes.example.test" }).appOrigin)
      .toBe("https://notes.example.test");
  });

  it("keeps proxy trust opt-in outside the standard deployment templates", () => {
    expect(loadServerConfig({ NODE_ENV: "production" }).trustProxy).toBe(false);
    expect(loadServerConfig({ TRUST_PROXY: "" }).trustProxy).toBe(false);
    expect(loadServerConfig({ TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(loadServerConfig({ TRUST_PROXY: "false" }).trustProxy).toBe(false);
  });

  it("rejects malformed numeric and boolean settings before startup", () => {
    expect(() => loadServerConfig({ PORT: "not-a-port" })).toThrow("Invalid PORT");
    expect(() => loadServerConfig({ PORT: "70000" })).toThrow("Invalid PORT");
    expect(() => loadServerConfig({ SESSION_TTL_HOURS: "0" })).toThrow("Invalid SESSION_TTL_HOURS");
    expect(() => loadServerConfig({ USER_STORAGE_QUOTA_MB: "Infinity" })).toThrow("Invalid USER_STORAGE_QUOTA_MB");
    expect(() => loadServerConfig({ TRUST_PROXY: "yes" })).toThrow("Invalid TRUST_PROXY");
    expect(() => loadServerConfig({ ALLOW_REGISTRATION: "1" })).toThrow("Invalid ALLOW_REGISTRATION");
  });
});
