import type { CryptoClient } from "./client";
import {
  localDb,
  type DeviceUnlockCredential,
  type DirectDeviceUnlockCredential,
  type LegacyDeviceUnlockCredential,
  type PinProtectedDeviceUnlockCredential,
  type VerifiedDeviceSession
} from "../storage/database";
import type { AuthEndpoint, User } from "../types";

const PIN_REFRESH_GRANT_KEY = "webmd-pin-refresh-grant-v1";

interface PinRefreshGrant {
  userId: string;
  endpointId: string;
  ciphertext: string;
  nonce: string;
  lastActivityAt: number;
  generation?: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function equalVerifier(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function clearPinRefreshGrant(): void {
  sessionStorage.removeItem(PIN_REFRESH_GRANT_KEY);
}

export async function rememberDeviceUnlock(
  user: User,
  endpoint: AuthEndpoint,
  mode: "remembered" | "session",
  cryptoClient: CryptoClient
): Promise<DeviceUnlockCredential> {
  const userId = user.id;
  const endpointId = endpoint.id;
  const previous = await localDb.deviceCredentials.get(userId);
  const verifiedSession = createVerifiedSession(user, endpoint);
  if (previous?.endpointId === endpointId && hasDevicePin(previous)) {
    const credential: DeviceUnlockCredential = {
      ...previous,
      mode,
      verifiedSession,
      failedPinAttempts: 0,
      updatedAt: new Date().toISOString()
    };
    await localDb.deviceCredentials.put(credential);
    await grantPinRefresh(credential, cryptoClient);
    return credential;
  }
  const deviceKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const wrapped = await cryptoClient.wrapVaultForDevice(userId, deviceKey);
  const credential: DirectDeviceUnlockCredential = {
    userId,
    endpointId,
    mode,
    deviceKey,
    verifiedSession,
    ciphertext: wrapped.ciphertext,
    nonce: wrapped.nonce,
    version: 3,
    protection: "device",
    failedPinAttempts: 0,
    autoLockMinutes: previous?.endpointId === endpointId && !hasDevicePin(previous) ? previous.autoLockMinutes : 0,
    updatedAt: new Date().toISOString()
  };
  await localDb.deviceCredentials.put(credential);
  return credential;
}

export async function getDeviceUnlock(userId: string, endpointId?: string): Promise<DeviceUnlockCredential | undefined> {
  const credential = await localDb.deviceCredentials.get(userId);
  if (!credential || (credential.version !== 2 && credential.version !== 3) || (endpointId && credential.endpointId !== endpointId)) return undefined;
  if (credential.version === 3 && credential.protection !== "device" && credential.protection !== "pin") return undefined;
  return credential;
}

function createVerifiedSession(user: User, endpoint: AuthEndpoint): VerifiedDeviceSession {
  return {
    version: 1,
    user,
    endpoint,
    verifiedAt: new Date().toISOString()
  };
}

export function verifiedSessionForCredential(
  credential: DeviceUnlockCredential | null | undefined
): VerifiedDeviceSession | null {
  const verified = credential?.verifiedSession;
  if (
    !credential
    || credential.mode !== "remembered"
    || !verified
    || verified.version !== 1
    || verified.user.id !== credential.userId
    || verified.endpoint.id !== credential.endpointId
    || !verified.endpoint.remembered
    || Number.isNaN(Date.parse(verified.verifiedAt))
  ) return null;
  return verified;
}

export async function getRememberedOfflineDevice(): Promise<{
  credential: DeviceUnlockCredential;
  session: VerifiedDeviceSession;
} | null> {
  const candidates = (await localDb.deviceCredentials.toArray())
    .map((credential) => ({ credential, session: verifiedSessionForCredential(credential) }))
    .filter((entry): entry is { credential: DeviceUnlockCredential; session: VerifiedDeviceSession } => Boolean(entry.session))
    .sort((left, right) => Date.parse(right.session.verifiedAt) - Date.parse(left.session.verifiedAt));
  return candidates[0] ?? null;
}

export async function updateVerifiedDeviceSession(
  user: User,
  endpoint: AuthEndpoint
): Promise<DeviceUnlockCredential | undefined> {
  const credential = await getDeviceUnlock(user.id, endpoint.id);
  if (!credential) return undefined;
  const updated: DeviceUnlockCredential = {
    ...credential,
    mode: endpoint.remembered ? "remembered" : "session",
    verifiedSession: createVerifiedSession(user, endpoint),
    updatedAt: new Date().toISOString()
  };
  await localDb.deviceCredentials.put(updated);
  return updated;
}

export function hasDevicePin(credential: DeviceUnlockCredential | null | undefined): boolean {
  return Boolean(credential && (
    isPinProtectedCredential(credential)
    || (credential.version === 2 && credential.pinSalt && credential.pinVerifier)
  ));
}

function isPinProtectedCredential(credential: DeviceUnlockCredential): credential is PinProtectedDeviceUnlockCredential {
  return credential.version === 3 && credential.protection === "pin";
}

function isLegacyPinCredential(credential: DeviceUnlockCredential): credential is LegacyDeviceUnlockCredential & {
  pinSalt: string;
  pinVerifier: string;
} {
  return credential.version === 2 && Boolean(credential.pinSalt && credential.pinVerifier);
}

function readPinRefreshGrant(userId: string, endpointId: string): PinRefreshGrant | null {
  try {
    const grant = JSON.parse(sessionStorage.getItem(PIN_REFRESH_GRANT_KEY) ?? "null") as Partial<PinRefreshGrant> | null;
    if (
      grant?.userId !== userId
      || grant.endpointId !== endpointId
      || typeof grant.ciphertext !== "string"
      || typeof grant.nonce !== "string"
      || typeof grant.lastActivityAt !== "number"
      || !Number.isFinite(grant.lastActivityAt)
    ) return null;
    return grant as PinRefreshGrant;
  } catch {
    return null;
  }
}

export async function grantPinRefresh(
  credential: DeviceUnlockCredential, cryptoClient: CryptoClient, generation?: string
): Promise<void> {
  if (!hasDevicePin(credential)) {
    clearPinRefreshGrant();
    return;
  }
  try {
    const wrapped = await cryptoClient.wrapVaultForDevice(credential.userId, credential.deviceKey);
    const grant: PinRefreshGrant = {
      userId: credential.userId,
      endpointId: credential.endpointId,
      ciphertext: wrapped.ciphertext,
      nonce: wrapped.nonce,
      lastActivityAt: Date.now(),
      generation
    };
    sessionStorage.setItem(PIN_REFRESH_GRANT_KEY, JSON.stringify(grant));
  } catch {
    clearPinRefreshGrant();
  }
}

export function touchPinRefreshGrant(userId: string, endpointId: string): void {
  const grant = readPinRefreshGrant(userId, endpointId);
  if (!grant) return;
  sessionStorage.setItem(PIN_REFRESH_GRANT_KEY, JSON.stringify({ ...grant, lastActivityAt: Date.now() }));
}

export async function restoreDeviceUnlock(
  userId: string,
  endpointId: string,
  allowPinRefresh = false,
  cryptoClient: CryptoClient,
  generation?: string
): Promise<boolean> {
  const credential = await getDeviceUnlock(userId, endpointId);
  if (!credential) return false;
  if (isPinProtectedCredential(credential) || isLegacyPinCredential(credential)) {
    const grant = allowPinRefresh ? readPinRefreshGrant(userId, endpointId) : null;
    const expired = Boolean(
      grant
      && credential.autoLockMinutes > 0
      && Date.now() - grant.lastActivityAt >= credential.autoLockMinutes * 60 * 1000
    );
    if (!grant || expired || grant.generation !== generation) {
      clearPinRefreshGrant();
      return false;
    }
    try {
      await cryptoClient.unlockVaultFromDevice(userId, credential.deviceKey, grant.ciphertext, grant.nonce);
      touchPinRefreshGrant(userId, endpointId);
      return true;
    } catch {
      clearPinRefreshGrant();
      await cryptoClient.lock().catch(() => undefined);
      return false;
    }
  }
  try {
    await cryptoClient.unlockVaultFromDevice(userId, credential.deviceKey, credential.ciphertext, credential.nonce);
    if (credential.version === 2) {
      const migrated: DirectDeviceUnlockCredential = {
        userId: credential.userId,
        endpointId: credential.endpointId,
        mode: credential.mode,
        deviceKey: credential.deviceKey,
        verifiedSession: credential.verifiedSession,
        ciphertext: credential.ciphertext,
        nonce: credential.nonce,
        version: 3,
        protection: "device",
        failedPinAttempts: 0,
        autoLockMinutes: credential.autoLockMinutes,
        updatedAt: new Date().toISOString()
      };
      await localDb.deviceCredentials.put(migrated);
    }
    return true;
  } catch {
    // A browser/Web Crypto operation may fail transiently. Preserve the
    // credential so a master-password fallback can replace it safely; never
    // turn a refresh error into irreversible local trust deletion.
    await cryptoClient.lock().catch(() => undefined);
    return false;
  }
}

export function isValidDevicePin(pin: string): boolean {
  return [...pin].length >= 4;
}

export async function setDevicePin(userId: string, endpointId: string, pin: string, cryptoClient: CryptoClient, generation?: string): Promise<void> {
  if (!isValidDevicePin(pin)) throw new Error("PIN 至少需要 4 个字符");
  const credential = await getDeviceUnlock(userId, endpointId);
  if (!credential) throw new Error("当前设备没有可用的本机解锁凭据");
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const wrapped = await cryptoClient.wrapVaultForDeviceWithPin(userId, endpointId, credential.deviceKey, pin, salt);
  const protectedCredential: PinProtectedDeviceUnlockCredential = {
    userId,
    endpointId,
    mode: credential.mode,
    deviceKey: credential.deviceKey,
    verifiedSession: credential.verifiedSession,
    version: 3,
    protection: "pin",
    pinKdfVersion: 1,
    pinSalt: salt,
    pinCiphertext: wrapped.ciphertext,
    pinNonce: wrapped.nonce,
    failedPinAttempts: 0,
    autoLockMinutes: credential.autoLockMinutes,
    updatedAt: new Date().toISOString()
  };
  await localDb.deviceCredentials.put(protectedCredential);
  await grantPinRefresh(protectedCredential, cryptoClient, generation);
}

export async function removeDevicePin(userId: string, endpointId: string, cryptoClient: CryptoClient): Promise<void> {
  const credential = await getDeviceUnlock(userId, endpointId);
  if (!credential) return;
  const wrapped = await cryptoClient.wrapVaultForDevice(userId, credential.deviceKey);
  const directCredential: DirectDeviceUnlockCredential = {
    userId,
    endpointId,
    mode: credential.mode,
    deviceKey: credential.deviceKey,
    verifiedSession: credential.verifiedSession,
    version: 3,
    protection: "device",
    ciphertext: wrapped.ciphertext,
    nonce: wrapped.nonce,
    failedPinAttempts: 0,
    autoLockMinutes: 0,
    updatedAt: new Date().toISOString()
  };
  await localDb.deviceCredentials.put(directCredential);
  clearPinRefreshGrant();
}

async function recordFailedPin(
  credential: DeviceUnlockCredential,
  sessionId?: string
): Promise<"invalid" | "exhausted"> {
  clearPinRefreshGrant();
  return localDb.transaction("rw", localDb.deviceCredentials, localDb.deviceGrants, localDb.pendingEndpointRevocations, async () => {
    const latest = await localDb.deviceCredentials.get(credential.userId);
    if (!latest || latest.endpointId !== credential.endpointId) return "exhausted";
    const failedPinAttempts = latest.failedPinAttempts + 1;
    if (failedPinAttempts >= 5) {
      const grant = await localDb.deviceGrants.get(credential.userId);
      await localDb.pendingEndpointRevocations.put({
        userId: credential.userId, endpointId: credential.endpointId,
        grantId: grant?.endpointId === credential.endpointId ? grant.id : undefined, sessionId, createdAt: new Date().toISOString()
      });
      await localDb.deviceCredentials.delete(credential.userId);
      await localDb.deviceGrants.delete(credential.userId);
      return "exhausted";
    }
    await localDb.deviceCredentials.put({ ...latest, failedPinAttempts, updatedAt: new Date().toISOString() });
    return "invalid";
  });
}

export async function unlockDeviceWithPin(
  userId: string, endpointId: string, pin: string, cryptoClient: CryptoClient, sessionId?: string
): Promise<"ok" | "invalid" | "exhausted"> {
  const credential = await getDeviceUnlock(userId, endpointId);
  if (!credential || !hasDevicePin(credential)) return "invalid";

  if (isPinProtectedCredential(credential)) {
    try {
      await cryptoClient.unlockVaultFromDeviceWithPin(
        userId,
        endpointId,
        credential.deviceKey,
        pin,
        credential.pinSalt,
        credential.pinCiphertext,
        credential.pinNonce,
        credential.pinKdfVersion
      );
    } catch {
      await cryptoClient.lock().catch(() => undefined);
      return recordFailedPin(credential, sessionId);
    }
    await localDb.deviceCredentials.put({ ...credential, failedPinAttempts: 0, updatedAt: new Date().toISOString() });
    await grantPinRefresh(credential, cryptoClient);
    return "ok";
  }

  if (!isLegacyPinCredential(credential)) return "invalid";
  const { verifier } = await cryptoClient.derivePinVerifier(pin, credential.pinSalt);
  if (!equalVerifier(verifier, credential.pinVerifier)) return recordFailedPin(credential, sessionId);

  try {
    await cryptoClient.unlockVaultFromDevice(userId, credential.deviceKey, credential.ciphertext, credential.nonce);
    const wrapped = await cryptoClient.wrapVaultForDeviceWithPin(userId, endpointId, credential.deviceKey, pin, credential.pinSalt);
    const migrated: PinProtectedDeviceUnlockCredential = {
      userId,
      endpointId,
      mode: credential.mode,
      deviceKey: credential.deviceKey,
      verifiedSession: credential.verifiedSession,
      version: 3,
      protection: "pin",
      pinKdfVersion: 1,
      pinSalt: credential.pinSalt,
      pinCiphertext: wrapped.ciphertext,
      pinNonce: wrapped.nonce,
      failedPinAttempts: 0,
      autoLockMinutes: credential.autoLockMinutes,
      updatedAt: new Date().toISOString()
    };
    await localDb.deviceCredentials.put(migrated);
    await grantPinRefresh(migrated, cryptoClient);
    return "ok";
  } catch (error) {
    await cryptoClient.lock().catch(() => undefined);
    throw error;
  }
}

export async function setAutoLockMinutes(userId: string, endpointId: string, autoLockMinutes: number): Promise<void> {
  if (![0, 1, 2, 5, 10, 15, 30, 60].includes(autoLockMinutes)) throw new Error("不支持的自动锁定时间");
  const credential = await getDeviceUnlock(userId, endpointId);
  if (!credential) throw new Error("当前设备没有可用的本机解锁凭据");
  await localDb.deviceCredentials.put({ ...credential, autoLockMinutes, updatedAt: new Date().toISOString() });
  if (autoLockMinutes > 0) touchPinRefreshGrant(userId, endpointId);
}

export async function clearPendingEndpointRevocation(endpointId: string): Promise<void> {
  await localDb.pendingEndpointRevocations.delete(endpointId);
}

export async function flushPendingEndpointRevocations(): Promise<void> {
  const pending = await localDb.pendingEndpointRevocations.toArray();
  for (const entry of pending) {
    try {
      const response = await fetch("/api/auth/device-grant/revoke", {
        method: "POST", signal: AbortSignal.timeout(2500), credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpointId: entry.endpointId, grantId: entry.grantId, sessionId: entry.sessionId })
      });
      const result = await response.json().catch(() => null) as { endpointId?: string; grantId?: string; sessionId?: string } | null;
      if (response.ok && result?.endpointId === entry.endpointId && result.grantId === entry.grantId && result.sessionId === entry.sessionId) {
        await localDb.transaction("rw", localDb.pendingEndpointRevocations, async () => {
          const latest = await localDb.pendingEndpointRevocations.get(entry.endpointId);
          if (latest?.grantId === entry.grantId && latest?.sessionId === entry.sessionId && latest?.createdAt === entry.createdAt) {
            await localDb.pendingEndpointRevocations.delete(entry.endpointId);
          }
        });
      }
    } catch {
      // Keep the pending revocation until the matching browser can confirm it.
    }
  }
}
