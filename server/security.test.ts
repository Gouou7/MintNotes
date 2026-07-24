import { describe, expect, it } from "vitest";
import { createInviteCode, createSessionToken, hashOpaqueSecret, hashToken, verifyOpaqueSecret } from "./security";

describe("server security helpers", () => {
  it("stores and verifies an opaque client-derived secret", () => {
    const value = "client-derived-secret-with-high-entropy";
    const stored = hashOpaqueSecret(value);
    expect(stored.hash).not.toContain(value);
    expect(verifyOpaqueSecret(value, stored.salt, stored.hash)).toBe(true);
    expect(verifyOpaqueSecret(`${value}-wrong`, stored.salt, stored.hash)).toBe(false);
  });

  it("creates non-repeating opaque tokens and stores only their hashes", () => {
    const sessionA = createSessionToken();
    const sessionB = createSessionToken();
    expect(sessionA).not.toBe(sessionB);
    expect(hashToken(sessionA)).not.toBe(sessionA);
    expect(createInviteCode()).not.toBe(createInviteCode());
  });
});

