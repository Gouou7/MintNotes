import { afterEach, describe, expect, it, vi } from "vitest";
import { cryptoClient } from "./client";
import {
  clearPinRefreshGrant,
  getRememberedOfflineDevice,
  hasDevicePin,
  isValidDevicePin,
  restoreDeviceUnlock,
  setDevicePin,
  unlockDeviceWithPin,
  updateVerifiedDeviceSession,
  verifiedSessionForCredential
} from "./deviceUnlock";
import {
  localDb,
  type DirectDeviceUnlockCredential,
  type LegacyDeviceUnlockCredential,
  type PinProtectedDeviceUnlockCredential
} from "../storage/database";

vi.mock("./client", () => ({
  cryptoClient: {
    derivePinVerifier: vi.fn(),
    lock: vi.fn(),
    unlockVaultFromDevice: vi.fn(),
    unlockVaultFromDeviceWithPin: vi.fn(),
    wrapVaultForDevice: vi.fn(),
    wrapVaultForDeviceWithPin: vi.fn()
  }
}));

const protectedCredential: PinProtectedDeviceUnlockCredential = {
  userId: "user-id",
  endpointId: "endpoint-id",
  mode: "remembered",
  deviceKey: {} as CryptoKey,
  version: 3,
  protection: "pin",
  pinKdfVersion: 1,
  pinSalt: "salt",
  pinCiphertext: "pin-ciphertext",
  pinNonce: "pin-nonce",
  failedPinAttempts: 0,
  autoLockMinutes: 5,
  updatedAt: "2026-07-25T00:00:00.000Z"
};
const directCredential: DirectDeviceUnlockCredential = {
  userId: protectedCredential.userId,
  endpointId: protectedCredential.endpointId,
  mode: "remembered",
  deviceKey: protectedCredential.deviceKey,
  version: 3,
  protection: "device",
  ciphertext: "direct-ciphertext",
  nonce: "direct-nonce",
  failedPinAttempts: 0,
  autoLockMinutes: 0,
  updatedAt: protectedCredential.updatedAt
};
const verifiedDirectCredential: DirectDeviceUnlockCredential = {
  ...directCredential,
  verifiedSession: {
    version: 1,
    user: { id: directCredential.userId, username: "user", displayName: "User", role: "user" },
    endpoint: { id: directCredential.endpointId, remembered: true },
    verifiedAt: "2026-07-25T01:00:00.000Z"
  }
};
const legacyCredential: LegacyDeviceUnlockCredential = {
  ...directCredential,
  version: 2,
  pinSalt: "legacy-salt",
  pinVerifier: "legacy-verifier"
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("device PIN validation", () => {
  it("accepts any four or more characters", () => {
    expect(isValidDevicePin("1234")).toBe(true);
    expect(isValidDevicePin("a!好?")).toBe(true);
    expect(isValidDevicePin("🔒🔑🗝️密")).toBe(true);
  });

  it("rejects PINs shorter than four characters", () => {
    expect(isValidDevicePin("abc")).toBe(false);
    expect(isValidDevicePin("")).toBe(false);
  });
});

describe("remembered offline device trust", () => {
  it("accepts only matching remembered credentials with a verified session snapshot", () => {
    expect(verifiedSessionForCredential(verifiedDirectCredential)?.user.id).toBe(directCredential.userId);
    expect(verifiedSessionForCredential({ ...verifiedDirectCredential, mode: "session" })).toBeNull();
    expect(verifiedSessionForCredential({
      ...verifiedDirectCredential,
      verifiedSession: {
        ...verifiedDirectCredential.verifiedSession!,
        endpoint: { id: "different-endpoint", remembered: true }
      }
    })).toBeNull();
    expect(verifiedSessionForCredential(directCredential)).toBeNull();
  });

  it("selects the most recently verified eligible remembered device", async () => {
    const older = {
      ...verifiedDirectCredential,
      userId: "older-user",
      endpointId: "older-endpoint",
      verifiedSession: {
        ...verifiedDirectCredential.verifiedSession!,
        user: { ...verifiedDirectCredential.verifiedSession!.user, id: "older-user" },
        endpoint: { id: "older-endpoint", remembered: true },
        verifiedAt: "2026-07-24T01:00:00.000Z"
      }
    };
    vi.spyOn(localDb.deviceCredentials, "toArray").mockResolvedValue([
      older,
      verifiedDirectCredential,
      { ...verifiedDirectCredential, userId: "session-user", mode: "session" }
    ]);

    await expect(getRememberedOfflineDevice()).resolves.toEqual({
      credential: verifiedDirectCredential,
      session: verifiedDirectCredential.verifiedSession
    });
  });

  it("backfills the verified session without replacing the wrapped credential", async () => {
    const user = { id: directCredential.userId, username: "user", displayName: "Updated", role: "user" as const };
    const endpoint = { id: directCredential.endpointId, remembered: true };
    vi.spyOn(localDb.deviceCredentials, "get").mockResolvedValue(directCredential);
    const put = vi.spyOn(localDb.deviceCredentials, "put").mockResolvedValue(directCredential.userId);

    await updateVerifiedDeviceSession(user, endpoint);

    expect(put).toHaveBeenCalledWith(expect.objectContaining({
      ciphertext: directCredential.ciphertext,
      nonce: directCredential.nonce,
      verifiedSession: expect.objectContaining({ version: 1, user, endpoint })
    }));
  });
});

describe("PIN-protected device unlock", () => {
  it("recognizes PIN encryption as the device lock boundary", () => {
    expect(hasDevicePin(protectedCredential)).toBe(true);
    expect(hasDevicePin(directCredential)).toBe(false);
  });

  it("replaces the directly usable credential with PIN ciphertext", async () => {
    vi.spyOn(localDb.deviceCredentials, "get").mockResolvedValue(directCredential);
    const put = vi.spyOn(localDb.deviceCredentials, "put").mockResolvedValue(directCredential.userId);
    vi.mocked(cryptoClient.wrapVaultForDeviceWithPin).mockResolvedValue({
      ciphertext: "protected-ciphertext",
      nonce: "protected-nonce",
      version: 1
    });
    vi.mocked(cryptoClient.wrapVaultForDevice).mockResolvedValue({
      ciphertext: "refresh-ciphertext",
      nonce: "refresh-nonce",
      version: 1
    });

    await setDevicePin(directCredential.userId, directCredential.endpointId, "246810");

    expect(put).toHaveBeenCalledWith(expect.objectContaining({
      version: 3,
      protection: "pin",
      pinCiphertext: "protected-ciphertext",
      pinNonce: "protected-nonce"
    }));
    const saved = put.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(saved).not.toHaveProperty("ciphertext");
    expect(saved).not.toHaveProperty("nonce");
  });

  it("does not restore a PIN-protected credential without an explicit refresh grant", async () => {
    vi.spyOn(localDb.deviceCredentials, "get").mockResolvedValue(protectedCredential);

    await expect(restoreDeviceUnlock(protectedCredential.userId, protectedCredential.endpointId)).resolves.toBe(false);

    expect(cryptoClient.unlockVaultFromDevice).not.toHaveBeenCalled();
    expect(cryptoClient.unlockVaultFromDeviceWithPin).not.toHaveBeenCalled();
  });

  it("restores a PIN-protected credential only from the current tab's refresh grant", async () => {
    vi.spyOn(localDb.deviceCredentials, "get").mockResolvedValue(directCredential);
    vi.spyOn(localDb.deviceCredentials, "put").mockResolvedValue(directCredential.userId);
    vi.mocked(cryptoClient.wrapVaultForDeviceWithPin).mockResolvedValue({
      ciphertext: "protected-ciphertext",
      nonce: "protected-nonce",
      version: 1
    });
    vi.mocked(cryptoClient.wrapVaultForDevice).mockResolvedValue({
      ciphertext: "refresh-ciphertext",
      nonce: "refresh-nonce",
      version: 1
    });
    await setDevicePin(directCredential.userId, directCredential.endpointId, "246810");

    vi.spyOn(localDb.deviceCredentials, "get").mockResolvedValue(protectedCredential);
    vi.mocked(cryptoClient.unlockVaultFromDevice).mockResolvedValue({ unlocked: true });

    await expect(restoreDeviceUnlock(protectedCredential.userId, protectedCredential.endpointId, true)).resolves.toBe(true);
    expect(cryptoClient.unlockVaultFromDevice).toHaveBeenCalledWith(
      protectedCredential.userId,
      protectedCredential.deviceKey,
      "refresh-ciphertext",
      "refresh-nonce"
    );
    expect(cryptoClient.unlockVaultFromDeviceWithPin).not.toHaveBeenCalled();
  });

  it("clears the refresh grant so a later refresh remains locked", async () => {
    vi.spyOn(localDb.deviceCredentials, "get").mockResolvedValue(directCredential);
    vi.spyOn(localDb.deviceCredentials, "put").mockResolvedValue(directCredential.userId);
    vi.mocked(cryptoClient.wrapVaultForDeviceWithPin).mockResolvedValue({
      ciphertext: "protected-ciphertext",
      nonce: "protected-nonce",
      version: 1
    });
    vi.mocked(cryptoClient.wrapVaultForDevice).mockResolvedValue({
      ciphertext: "refresh-ciphertext",
      nonce: "refresh-nonce",
      version: 1
    });
    await setDevicePin(directCredential.userId, directCredential.endpointId, "246810");
    clearPinRefreshGrant();

    vi.spyOn(localDb.deviceCredentials, "get").mockResolvedValue(protectedCredential);
    await expect(restoreDeviceUnlock(protectedCredential.userId, protectedCredential.endpointId, true)).resolves.toBe(false);
    expect(cryptoClient.unlockVaultFromDevice).not.toHaveBeenCalled();
  });

  it("does not let a refresh bypass the configured inactivity timeout", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValueOnce(1_000);
    vi.spyOn(localDb.deviceCredentials, "get").mockResolvedValue(directCredential);
    vi.spyOn(localDb.deviceCredentials, "put").mockResolvedValue(directCredential.userId);
    vi.mocked(cryptoClient.wrapVaultForDeviceWithPin).mockResolvedValue({
      ciphertext: "protected-ciphertext",
      nonce: "protected-nonce",
      version: 1
    });
    vi.mocked(cryptoClient.wrapVaultForDevice).mockResolvedValue({
      ciphertext: "refresh-ciphertext",
      nonce: "refresh-nonce",
      version: 1
    });
    await setDevicePin(directCredential.userId, directCredential.endpointId, "246810");

    now.mockReturnValue(5 * 60 * 1000 + 1_000);
    vi.spyOn(localDb.deviceCredentials, "get").mockResolvedValue(protectedCredential);

    await expect(restoreDeviceUnlock(protectedCredential.userId, protectedCredential.endpointId, true)).resolves.toBe(false);
    expect(cryptoClient.unlockVaultFromDevice).not.toHaveBeenCalled();
  });

  it("passes the entered PIN to the worker before releasing the vault", async () => {
    vi.spyOn(localDb.deviceCredentials, "get").mockResolvedValue(protectedCredential);
    const put = vi.spyOn(localDb.deviceCredentials, "put").mockResolvedValue(protectedCredential.userId);
    vi.mocked(cryptoClient.unlockVaultFromDeviceWithPin).mockResolvedValue({ unlocked: true });
    vi.mocked(cryptoClient.wrapVaultForDevice).mockResolvedValue({
      ciphertext: "refresh-ciphertext",
      nonce: "refresh-nonce",
      version: 1
    });

    await expect(unlockDeviceWithPin(protectedCredential.userId, protectedCredential.endpointId, "246810")).resolves.toBe("ok");

    expect(cryptoClient.unlockVaultFromDeviceWithPin).toHaveBeenCalledWith(
      protectedCredential.userId,
      protectedCredential.endpointId,
      protectedCredential.deviceKey,
      "246810",
      protectedCredential.pinSalt,
      protectedCredential.pinCiphertext,
      protectedCredential.pinNonce,
      1
    );
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ failedPinAttempts: 0 }));
  });

  it("upgrades a legacy verifier credential after the correct PIN unlocks it", async () => {
    vi.spyOn(localDb.deviceCredentials, "get").mockResolvedValue(legacyCredential);
    const put = vi.spyOn(localDb.deviceCredentials, "put").mockResolvedValue(legacyCredential.userId);
    vi.mocked(cryptoClient.derivePinVerifier).mockResolvedValue({ verifier: legacyCredential.pinVerifier! });
    vi.mocked(cryptoClient.unlockVaultFromDevice).mockResolvedValue({ unlocked: true });
    vi.mocked(cryptoClient.wrapVaultForDeviceWithPin).mockResolvedValue({
      ciphertext: "migrated-ciphertext",
      nonce: "migrated-nonce",
      version: 1
    });
    vi.mocked(cryptoClient.wrapVaultForDevice).mockResolvedValue({
      ciphertext: "refresh-ciphertext",
      nonce: "refresh-nonce",
      version: 1
    });

    await expect(unlockDeviceWithPin(legacyCredential.userId, legacyCredential.endpointId, "246810")).resolves.toBe("ok");

    expect(put).toHaveBeenCalledWith(expect.objectContaining({
      version: 3,
      protection: "pin",
      pinCiphertext: "migrated-ciphertext",
      pinNonce: "migrated-nonce"
    }));
    const saved = put.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(saved).not.toHaveProperty("ciphertext");
    expect(saved).not.toHaveProperty("pinVerifier");
  });

  it("does not release the vault for an incorrect PIN", async () => {
    vi.spyOn(localDb.deviceCredentials, "get").mockResolvedValue(protectedCredential);
    const put = vi.spyOn(localDb.deviceCredentials, "put").mockResolvedValue(protectedCredential.userId);
    vi.mocked(cryptoClient.unlockVaultFromDeviceWithPin).mockRejectedValue(new Error("decrypt failed"));
    vi.mocked(cryptoClient.lock).mockResolvedValue({ locked: true });

    await expect(unlockDeviceWithPin(protectedCredential.userId, protectedCredential.endpointId, "wrong")).resolves.toBe("invalid");

    expect(cryptoClient.lock).toHaveBeenCalled();
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ failedPinAttempts: 1 }));
  });
});
