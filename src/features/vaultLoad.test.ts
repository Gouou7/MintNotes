import { describe, expect, it } from "vitest";
import type { LocalEncryptedObject } from "../storage/database";
import type { VaultObject } from "../types";
import { decryptAvailableLocalObjects, decryptFailureFingerprint } from "./vaultLoad";

function encryptedObject(objectId: string): LocalEncryptedObject {
  return {
    key: `user:${objectId}`,
    userId: "user",
    objectId,
    objectType: "note",
    ciphertext: "opaque",
    nonce: "nonce",
    encryptionVersion: 1,
    revision: 1,
    deleted: false,
    updatedAt: "2026-07-21T00:00:00.000Z"
  };
}

describe("vault local loading", () => {
  it("keeps readable notes visible when one encrypted record fails", async () => {
    const readable = encryptedObject("readable");
    const damaged = encryptedObject("damaged");
    const result = await decryptAvailableLocalObjects([readable, damaged], new Map(), async (object) => {
      if (object.objectId === "damaged") throw new Error("authentication failed");
      return {
        kind: "note",
        title: "保留的笔记",
        markdown: "content",
        parentId: null,
        tags: [],
        favorite: false,
        locked: false,
        deleted: false,
        createdAt: object.updatedAt,
        updatedAt: object.updatedAt,
        manualOrder: 0,
        attachmentIds: [],
        schemaVersion: 2
      } satisfies VaultObject;
    });

    expect(result.documents.map((document) => document.objectId)).toEqual(["readable"]);
    expect(result.failed.map((object) => object.objectId)).toEqual(["damaged"]);
    expect(result.attachments).toEqual([]);
  });

  it("normalizes legacy documents without a lock field as unlocked", async () => {
    const readable = encryptedObject("legacy");
    const result = await decryptAvailableLocalObjects([readable], new Map(), async (object) => ({
      kind: "note",
      title: "Legacy",
      markdown: "",
      parentId: null,
      tags: [],
      favorite: false,
      deleted: false,
      createdAt: object.updatedAt,
      updatedAt: object.updatedAt,
      manualOrder: 0,
      attachmentIds: [],
      schemaVersion: 2
    } as unknown as VaultObject));

    expect(result.documents[0]?.locked).toBe(false);
  });

  it("changes the dismissible failure fingerprint when encrypted content changes", () => {
    const original = encryptedObject("damaged");
    expect(decryptFailureFingerprint({ ...original, nonce: "new-nonce" })).not.toBe(decryptFailureFingerprint(original));
    expect(decryptFailureFingerprint({ ...original, revision: 2 })).not.toBe(decryptFailureFingerprint(original));
  });
});
