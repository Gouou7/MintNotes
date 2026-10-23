// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hashToken } from "../security";
import { verifyApplicationSecret } from "./service";

describe("application secret verification", () => {
  it("compares the complete base64url SHA-256 digest", () => {
    const secret = "a".repeat(43);
    const hash = hashToken(secret);
    expect(verifyApplicationSecret(secret, hash)).toBe(true);
    // Both hashes previously decoded to empty buffers when interpreted as hex.
    expect(verifyApplicationSecret("d".repeat(43), hash)).toBe(false);
    const bytes = Buffer.from(hash, "base64url");
    bytes[31] ^= 1;
    expect(verifyApplicationSecret(secret, bytes.toString("base64url"))).toBe(false);
  });

  it("rejects malformed, truncated and noncanonical stored hashes", () => {
    const secret = "a".repeat(43);
    const hash = hashToken(secret);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const alias = hash.slice(0, -1) + alphabet[alphabet.indexOf(hash.at(-1)!) ^ 1];
    expect(Buffer.from(alias, "base64url")).toEqual(Buffer.from(hash, "base64url"));
    for (const invalid of ["", hash.slice(0, -1), `${hash}=`, `${hash.slice(0, -1)}!`, alias]) {
      expect(verifyApplicationSecret(secret, invalid)).toBe(false);
    }
  });
});
