import { afterEach, describe, expect, it, vi } from "vitest";
import { cryptoClient } from "./client";
import { hasDevicePin, isValidDevicePin, restoreDeviceUnlock, setDevicePin, unlockDeviceWithPin } from "./deviceUnlock";
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

  it("never restores a PIN-protected credential during refresh", async () => {
    vi.spyOn(localDb.deviceCredentials, "get").mockResolvedValue(protectedCredential);

    await expect(restoreDeviceUnlock(protectedCredential.userId, protectedCredential.endpointId)).resolves.toBe(false);

    expect(cryptoClient.unlockVaultFromDevice).not.toHaveBeenCalled();
    expect(cryptoClient.unlockVaultFromDeviceWithPin).not.toHaveBeenCalled();
  });

  it("passes the entered PIN to the worker before releasing the vault", async () => {
    vi.spyOn(localDb.deviceCredentials, "get").mockResolvedValue(protectedCredential);
    const put = vi.spyOn(localDb.deviceCredentials, "put").mockResolvedValue(protectedCredential.userId);
    vi.mocked(cryptoClient.unlockVaultFromDeviceWithPin).mockResolvedValue({ unlocked: true });

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
