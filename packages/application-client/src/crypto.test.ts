// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applicationAuthSecret, applicationEnvelopeAad, b64, createApplicationCredential, deriveSubkey, open, randomBytes, VaultCipher } from "./crypto";
import type { ApplicationConnectionBootstrap } from "./protocol";
import { makeDocument } from "./documentFactory";

function bootstrap(credential: Awaited<ReturnType<typeof createApplicationCredential>>, userId: string): ApplicationConnectionBootstrap {
  return { protocolVersion: 1, objectSchemaVersion: 2, encryptionVersion: 1, userId, historyEnabled: true, serverTime: new Date().toISOString(),
    vaultEnvelope: credential.vaultEnvelope, connection: { connectionId: credential.connectionId, name: "test", access: "read-write", idleTimeoutDays: 30,
      expiresAt: null, createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null, validUntil: null, status: "active" } };
}
describe("shared application cryptography", () => {
  it("derives separate authentication and wrapping keys, binds user and connection, and rejects tampering", async () => {
    const root = randomBytes(32); const userId = crypto.randomUUID();
    const credential = await createApplicationCredential(userId, root);
    const seed = (await import("./crypto")).fromB64(credential.applicationKey.split(".")[2]);
    const wrapping = await deriveSubkey(seed, `webmd-application-vault-wrapping-v1:${credential.connectionId}`);
    expect(b64(wrapping)).not.toBe(credential.authSecret);
    expect(await applicationAuthSecret(credential.applicationKey)).toEqual({ connectionId: credential.connectionId, authSecret: credential.authSecret });
    expect(await open(credential.vaultEnvelope.ciphertext, credential.vaultEnvelope.nonce, wrapping, applicationEnvelopeAad(userId, credential.connectionId))).toEqual(root);
    await expect(VaultCipher.unlock(credential.applicationKey, { ...bootstrap(credential, userId), userId: crypto.randomUUID() })).rejects.toThrow();
    const cipher = await VaultCipher.unlock(credential.applicationKey, bootstrap(credential, userId));
    const note = makeDocument([], "note", "title", null, "Markdown");
    const encrypted = { objectId: note.objectId, objectType: "note" as const, revision: 7, deleted: false, ...await cipher.encryptObject(note.objectId, "note", 7, note) };
    expect(await cipher.decryptObject(encrypted)).toMatchObject({ markdown: "Markdown" });
    await expect(cipher.decryptObject({ ...encrypted, revision: 8 })).rejects.toThrow();
    await expect(cipher.decryptObject({ ...encrypted, deleted: true })).rejects.toThrow();
    cipher.dispose(); await expect(cipher.decryptObject(encrypted)).rejects.toThrow();
    await expect(cipher.encryptObject(note.objectId, "note", 8, note)).rejects.toMatchObject({ code: "CLIENT_STOPPED" });
  });
  it("snapshots mutable vault keys before deriving a credential", async () => {
    const userId = crypto.randomUUID(); const root = randomBytes(32); const expected = root.slice();
    const creating = createApplicationCredential(userId, root); root.fill(0);
    const credential = await creating;
    const seed = (await import("./crypto")).fromB64(credential.applicationKey.split(".")[2]);
    const wrapping = await deriveSubkey(seed, `webmd-application-vault-wrapping-v1:${credential.connectionId}`);
    expect(await open(credential.vaultEnvelope.ciphertext, credential.vaultEnvelope.nonce, wrapping, applicationEnvelopeAad(userId, credential.connectionId))).toEqual(expected);
  });
  it("rejects malformed application keys", async () => {
    for (const value of ["password", "mint-app-v1.invalid.key", `mint-app-v1.${crypto.randomUUID()}.${"a".repeat(44)}`]) {
      await expect(applicationAuthSecret(value)).rejects.toMatchObject({ code: "INVALID_APPLICATION_KEY" });
    }
  });
});
