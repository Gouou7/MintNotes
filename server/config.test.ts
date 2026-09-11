import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./config";

describe("server configuration", () => {
  it("requires an exact HTTPS application origin in production", () => {
    expect(() => loadServerConfig({ NODE_ENV: "production" })).toThrow("APP_ORIGIN is required in production");
    expect(() => loadServerConfig({ NODE_ENV: "production", APP_ORIGIN: "http://notes.example.test" })).toThrow("Invalid APP_ORIGIN");
    expect(() => loadServerConfig({ NODE_ENV: "production", APP_ORIGIN: "https://notes.example.test/" })).toThrow("Invalid APP_ORIGIN");
    expect(loadServerConfig({ NODE_ENV: "production", APP_ORIGIN: "https://notes.example.test" }).appOrigin)
      .toBe("https://notes.example.test");
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
