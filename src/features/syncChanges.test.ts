import { describe, expect, it } from "vitest";
import type { LocalEncryptedObject } from "../storage/database";
import type { SyncChange } from "../types";
import { isAcknowledgedLocalEcho } from "./syncChanges";

const local: LocalEncryptedObject = {
  key: "user:note",
  userId: "user",
  objectId: "note",
  objectType: "note",
  ciphertext: "opaque",
  nonce: "nonce",
  encryptionVersion: 1,
  revision: 2,
  deleted: false,
  updatedAt: "2026-07-26T00:00:00.000Z"
};

const change: SyncChange = {
  objectId: "note",
  objectType: "note",
  ciphertext: "opaque",
  nonce: "nonce",
  encryptionVersion: 1,
  revision: 2,
  deleted: false,
  sequence: 10,
  serverUpdatedAt: "2026-07-26T00:00:01.000Z"
};

describe("synchronization change classification", () => {
  it("recognizes an already acknowledged encrypted version", () => {
    expect(isAcknowledgedLocalEcho(local, change)).toBe(true);
  });

  it("does not hide a newer remote revision", () => {
    expect(isAcknowledgedLocalEcho(local, { ...change, revision: 3 })).toBe(false);
  });

  it("does not hide a different envelope at the same revision", () => {
    expect(isAcknowledgedLocalEcho(local, { ...change, ciphertext: "different" })).toBe(false);
    expect(isAcknowledgedLocalEcho(local, { ...change, nonce: "different" })).toBe(false);
  });

  it("never treats a purge as a local echo", () => {
    expect(isAcknowledgedLocalEcho(local, { ...change, purged: true })).toBe(false);
  });
});
