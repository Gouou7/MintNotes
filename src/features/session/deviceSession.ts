import { ApiError, api, createApiClient } from "../../api";
import type { CryptoClient } from "../../crypto/client";
import { localDb } from "../../storage/database";
import type { AuthEndpoint, BrowserSession, User } from "../../types";

export async function requestSession(account: { user: User; endpoint: AuthEndpoint }, worker: CryptoClient, previous?: string, renew = false) {
  const transport = createApiClient({ requireSession: true });
  const check = async (id: string) => {
    transport.bindSession(id);
    const session = await transport.api<BrowserSession>("/api/auth/me");
    if (session.user.id !== account.user.id || session.endpoint.id !== account.endpoint.id || session.sessionId !== id) {
      throw new ApiError("Browser session changed", 409);
    }
    return session;
  };
  if (previous && !renew) {
    try { return await check(previous); }
    catch (error) {
      if (!(error instanceof ApiError) || ![401, 409].includes(error.status)) throw error;
    }
  }
  const grant = await localDb.deviceGrants.get(account.user.id);
  if (!grant || grant.endpointId !== account.endpoint.id) return previous && renew ? check(previous) : null;
  const secret = await worker.openDeviceGrant(grant.userId, grant.endpointId, grant.id, grant.ciphertext, grant.nonce);
  let resumed: BrowserSession;
  try {
    resumed = await api<BrowserSession>("/api/auth/session/resume", {
      method: "POST", body: JSON.stringify({ id: grant.id, secret })
    });
  } catch (error) {
    if (grant.pending && error instanceof ApiError && error.data.code === "DEVICE_REAUTH_REQUIRED") return null;
    throw error;
  }
  if (resumed.user.id !== account.user.id || resumed.endpoint.id !== account.endpoint.id) throw new ApiError("Browser session changed", 409);
  const session = await check(resumed.sessionId);
  if (grant.pending) await localDb.deviceGrants.update(grant.userId, { pending: false });
  return session;
}

export async function enrollDevice(session: BrowserSession, worker: CryptoClient, authSecret: string) {
  const transport = createApiClient({ requireSession: true });
  transport.bindSession(session.sessionId);
  const prior = await localDb.deviceGrants.get(session.user.id);
  const candidate = prior?.pending && prior.endpointId === session.endpoint.id ? prior : undefined;
  const id = candidate?.id ?? crypto.randomUUID();
  let secret: string;
  if (candidate) {
    secret = await worker.openDeviceGrant(candidate.userId, candidate.endpointId, id, candidate.ciphertext, candidate.nonce);
  } else {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    secret = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    bytes.fill(0);
    const sealed = await worker.sealDeviceGrant(session.user.id, session.endpoint.id, id, secret);
    await localDb.deviceGrants.put({ userId: session.user.id, endpointId: session.endpoint.id, id, version: 1, pending: true, ...sealed });
  }
  const receipt = await transport.api<{ id: string }>("/api/auth/device-grant", {
    method: "PUT", body: JSON.stringify({ id, secret, authSecret })
  });
  if (receipt.id !== id) throw new Error("Device authorization unavailable");
  await localDb.deviceGrants.update(session.user.id, { pending: false });
}
