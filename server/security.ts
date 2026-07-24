import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashOpaqueSecret(secret: string): { salt: string; hash: string } {
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, 64, { N: 16384, r: 8, p: 1 });
  return { salt: salt.toString("base64"), hash: hash.toString("base64") };
}

export function verifyOpaqueSecret(secret: string, saltValue: string, hashValue: string): boolean {
  const salt = Buffer.from(saltValue, "base64");
  const expected = Buffer.from(hashValue, "base64");
  const actual = scryptSync(secret, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function createInviteCode(): string {
  return randomBytes(24).toString("base64url");
}

