import { cryptoClient } from "./client";
import { localDb, type DeviceUnlockCredential } from "../storage/database";

const SESSION_GRANT_KEY = "webmd-device-session-grant";
const SESSION_CHANNEL = "webmd-device-session";
const ACCOUNT_LOGOUT_EVENT = "webmd:local-account-logout";

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

export function grantCurrentBrowserSession(endpointId: string): void {
  sessionStorage.setItem(SESSION_GRANT_KEY, endpointId);
}

export function hasCurrentBrowserSessionGrant(endpointId: string): boolean {
  return sessionStorage.getItem(SESSION_GRANT_KEY) === endpointId;
}

export function clearCurrentBrowserSessionGrant(): void {
  sessionStorage.removeItem(SESSION_GRANT_KEY);
}

export function listenForBrowserSessionGrantRequests(): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  channel.addEventListener("message", (event: MessageEvent<{ type?: string; endpointId?: string; requestId?: string; userId?: string }>) => {
    const message = event.data;
    if (message.type === "request" && message.endpointId && message.requestId && hasCurrentBrowserSessionGrant(message.endpointId)) {
      channel.postMessage({ type: "grant", endpointId: message.endpointId, requestId: message.requestId });
    } else if (message.type === "account-logout" && message.userId) {
      clearCurrentBrowserSessionGrant();
      window.dispatchEvent(new CustomEvent(ACCOUNT_LOGOUT_EVENT, { detail: { userId: message.userId } }));
    }
  });
  return () => channel.close();
}

export function broadcastAccountLogout(userId: string): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  channel.postMessage({ type: "account-logout", userId });
  channel.close();
}

export async function requestBrowserSessionGrant(endpointId: string): Promise<boolean> {
  if (hasCurrentBrowserSessionGrant(endpointId) || typeof BroadcastChannel === "undefined") return hasCurrentBrowserSessionGrant(endpointId);
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const finish = (granted: boolean) => {
      channel.close();
      if (granted) grantCurrentBrowserSession(endpointId);
      resolve(granted);
    };
    const timer = window.setTimeout(() => finish(false), 400);
    channel.addEventListener("message", (event: MessageEvent<{ type?: string; endpointId?: string; requestId?: string }>) => {
      if (event.data.type === "grant" && event.data.endpointId === endpointId && event.data.requestId === requestId) {
        window.clearTimeout(timer);
        finish(true);
      }
    });
    channel.postMessage({ type: "request", endpointId, requestId });
  });
}

export async function rememberDeviceUnlock(
  userId: string,
  endpointId: string,
  mode: "remembered" | "session"
): Promise<DeviceUnlockCredential> {
  const previous = await localDb.deviceCredentials.get(userId);
  const deviceKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const wrapped = await cryptoClient.wrapVaultForDevice(userId, deviceKey);
  const credential: DeviceUnlockCredential = {
    userId,
    endpointId,
    mode,
    deviceKey,
    ciphertext: wrapped.ciphertext,
    nonce: wrapped.nonce,
    version: 2,
    pinSalt: previous?.endpointId === endpointId ? previous.pinSalt : undefined,
    pinVerifier: previous?.endpointId === endpointId ? previous.pinVerifier : undefined,
    failedPinAttempts: 0,
    autoLockMinutes: previous?.endpointId === endpointId ? previous.autoLockMinutes : 0,
    updatedAt: new Date().toISOString()
  };
  await localDb.deviceCredentials.put(credential);
  grantCurrentBrowserSession(endpointId);
  return credential;
}

export async function getDeviceUnlock(userId: string, endpointId?: string): Promise<DeviceUnlockCredential | undefined> {
  const credential = await localDb.deviceCredentials.get(userId);
  if (!credential || credential.version !== 2 || (endpointId && credential.endpointId !== endpointId)) return undefined;
  return credential;
}

export async function restoreDeviceUnlock(userId: string, endpointId: string): Promise<boolean> {
  const credential = await getDeviceUnlock(userId, endpointId);
  if (!credential) return false;
  try {
    await cryptoClient.unlockVaultFromDevice(userId, credential.deviceKey, credential.ciphertext, credential.nonce);
    grantCurrentBrowserSession(endpointId);
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

export async function setDevicePin(userId: string, endpointId: string, pin: string): Promise<void> {
  if (!isValidDevicePin(pin)) throw new Error("PIN 至少需要 4 个字符");
  const credential = await getDeviceUnlock(userId, endpointId);
  if (!credential) throw new Error("当前设备没有可用的本机解锁凭据");
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const { verifier } = await cryptoClient.derivePinVerifier(pin, salt);
  await localDb.deviceCredentials.put({ ...credential, pinSalt: salt, pinVerifier: verifier, failedPinAttempts: 0, updatedAt: new Date().toISOString() });
}

export async function removeDevicePin(userId: string, endpointId: string): Promise<void> {
  const credential = await getDeviceUnlock(userId, endpointId);
  if (!credential) return;
  await localDb.deviceCredentials.put({ ...credential, pinSalt: undefined, pinVerifier: undefined, failedPinAttempts: 0, updatedAt: new Date().toISOString() });
}

export async function verifyDevicePin(userId: string, endpointId: string, pin: string): Promise<"ok" | "invalid" | "exhausted"> {
  const credential = await getDeviceUnlock(userId, endpointId);
  if (!credential?.pinSalt || !credential.pinVerifier) return "invalid";
  const { verifier } = await cryptoClient.derivePinVerifier(pin, credential.pinSalt);
  if (equalVerifier(verifier, credential.pinVerifier)) {
    await localDb.deviceCredentials.put({ ...credential, failedPinAttempts: 0, updatedAt: new Date().toISOString() });
    return "ok";
  }
  const failedPinAttempts = credential.failedPinAttempts + 1;
  if (failedPinAttempts >= 5) {
    await forgetDeviceUnlock(userId);
    return "exhausted";
  }
  await localDb.deviceCredentials.put({ ...credential, failedPinAttempts, updatedAt: new Date().toISOString() });
  return "invalid";
}

export async function setAutoLockMinutes(userId: string, endpointId: string, autoLockMinutes: number): Promise<void> {
  if (![0, 1, 2, 5, 10, 15, 30, 60].includes(autoLockMinutes)) throw new Error("不支持的自动锁定时间");
  const credential = await getDeviceUnlock(userId, endpointId);
  if (!credential) throw new Error("当前设备没有可用的本机解锁凭据");
  await localDb.deviceCredentials.put({ ...credential, autoLockMinutes, updatedAt: new Date().toISOString() });
}

export async function markEndpointRevocationPending(userId: string, endpointId: string): Promise<void> {
  await localDb.transaction("rw", localDb.pendingEndpointRevocations, async () => {
    await localDb.pendingEndpointRevocations.clear();
    await localDb.pendingEndpointRevocations.put({ endpointId, userId, createdAt: new Date().toISOString() });
  });
}

export async function clearPendingEndpointRevocation(endpointId: string): Promise<void> {
  await localDb.pendingEndpointRevocations.delete(endpointId);
}

export async function flushPendingEndpointRevocations(): Promise<void> {
  const pending = await localDb.pendingEndpointRevocations.toArray();
  for (const entry of pending) {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (response.ok || response.status === 401) await localDb.pendingEndpointRevocations.delete(entry.endpointId);
    } catch {
      // Offline attempts remain durable and are retried before the next session restore.
    }
  }
}

export async function forgetDeviceUnlock(userId: string): Promise<void> {
  await localDb.deviceCredentials.delete(userId);
  clearCurrentBrowserSessionGrant();
}
