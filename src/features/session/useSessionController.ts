import { useEffect, useState } from "react";
import { ApiError, api } from "../../api";
import { cryptoClient } from "../../crypto/client";
import {
  broadcastAccountLogout,
  clearCurrentBrowserSessionGrant,
  clearPendingEndpointRevocation,
  forgetDeviceUnlock,
  flushPendingEndpointRevocations,
  getDeviceUnlock,
  grantCurrentBrowserSession,
  hasCurrentBrowserSessionGrant,
  hasDevicePin,
  listenForBrowserSessionGrantRequests,
  rememberDeviceUnlock,
  requestBrowserSessionGrant,
  restoreDeviceUnlock
} from "../../crypto/deviceUnlock";
import { deleteLocalUserData, localDb, type DeviceUnlockCredential } from "../../storage/database";
import type { AuthEndpoint, User } from "../../types";

type AuthSession = { user: User; endpoint: AuthEndpoint };

function isReloadNavigation(): boolean {
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return navigation?.type === "reload";
}

export function useSessionController() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [credential, setCredential] = useState<DeviceUnlockCredential | null>(null);
  const [restoringDevice, setRestoringDevice] = useState(true);

  useEffect(() => listenForBrowserSessionGrantRequests(), []);

  useEffect(() => {
    let active = true;
    void flushPendingEndpointRevocations().then(() => api<AuthSession>("/api/auth/me"))
      .then(async ({ user: sessionUser, endpoint }) => {
        const stored = await getDeviceUnlock(sessionUser.id, endpoint.id);
        if (!stored) return;
        const browserSessionGranted = hasCurrentBrowserSessionGrant(endpoint.id)
          || await requestBrowserSessionGrant(endpoint.id);
        if (stored.mode === "session" && !browserSessionGranted) {
          await forgetDeviceUnlock(sessionUser.id);
          await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
          return;
        }
        if (!active) return;
        setSession({ user: sessionUser, endpoint });
        setCredential(stored);
        const allowPinRefresh = hasDevicePin(stored) && isReloadNavigation();
        if (await restoreDeviceUnlock(sessionUser.id, endpoint.id, allowPinRefresh) && active) {
          setUser(sessionUser);
        }
      })
      .catch(async (value) => {
        if (!(value instanceof ApiError) || value.status !== 401) return;
        const credentials = await localDb.deviceCredentials.toArray();
        await Promise.all(credentials.map((entry) => forgetDeviceUnlock(entry.userId)));
      })
      .finally(() => { if (active) setRestoringDevice(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const invalidate = () => {
      const current = session;
      void (async () => {
        if (current) await forgetDeviceUnlock(current.user.id).catch(() => undefined);
        await cryptoClient.lock().catch(() => undefined);
        setUser(null);
        setSession(null);
        setCredential(null);
      })();
    };
    window.addEventListener("webmd:session-invalid", invalidate);
    return () => window.removeEventListener("webmd:session-invalid", invalidate);
  }, [session]);

  useEffect(() => {
    const logoutAcrossTabs = (event: Event) => {
      const userId = (event as CustomEvent<{ userId?: string }>).detail?.userId;
      const current = session;
      if (!current || current.user.id !== userId) return;
      clearCurrentBrowserSessionGrant();
      setUser(null);
      setSession(null);
      setCredential(null);
      void cryptoClient.lock()
        .catch(() => undefined)
        .then(() => deleteLocalUserData(current.user.id).catch(() => undefined));
    };
    window.addEventListener("webmd:local-account-logout", logoutAcrossTabs);
    return () => window.removeEventListener("webmd:local-account-logout", logoutAcrossTabs);
  }, [session]);

  const handleUnlocked = async (unlockedUser: User, endpoint: AuthEndpoint) => {
    await clearPendingEndpointRevocation(endpoint.id).catch(() => undefined);
    const stored = await rememberDeviceUnlock(
      unlockedUser.id,
      endpoint.id,
      endpoint.remembered ? "remembered" : "session"
    ).catch(() => undefined);
    setSession({ user: unlockedUser, endpoint });
    setCredential(stored ?? null);
    setUser(unlockedUser);
  };

  const logoutLockedSession = async () => {
    const endpointId = session?.endpoint.id;
    if (session) {
      await deleteLocalUserData(session.user.id);
      broadcastAccountLogout(session.user.id);
    }
    clearCurrentBrowserSessionGrant();
    await cryptoClient.lock().catch(() => undefined);
    const loggedOut = await api("/api/auth/logout", { method: "POST" })
      .then(() => true)
      .catch(() => false);
    if (loggedOut && endpointId) {
      await clearPendingEndpointRevocation(endpointId).catch(() => undefined);
    }
    setUser(null);
    setSession(null);
    setCredential(null);
  };

  const handleTrustExhausted = async () => {
    const endpointId = session?.endpoint.id;
    if (session) await forgetDeviceUnlock(session.user.id).catch(() => undefined);
    clearCurrentBrowserSessionGrant();
    await cryptoClient.lock().catch(() => undefined);
    const loggedOut = await api("/api/auth/logout", { method: "POST" })
      .then(() => true)
      .catch(() => false);
    if (loggedOut && endpointId) {
      await clearPendingEndpointRevocation(endpointId).catch(() => undefined);
    }
    setUser(null);
    setSession(null);
    setCredential(null);
  };

  const unlockStoredSession = async (refreshCredential = false) => {
    if (!session || !credential) return;
    if (refreshCredential) {
      const next = await rememberDeviceUnlock(session.user.id, session.endpoint.id, credential.mode);
      setCredential(next);
    }
    grantCurrentBrowserSession(session.endpoint.id);
    setUser(session.user);
  };

  const updateDisplayName = (displayName: string) => {
    setUser((current) => current ? { ...current, displayName } : current);
    setSession((current) => current
      ? { ...current, user: { ...current.user, displayName } }
      : current);
  };

  const handleVaultLocked = (logout: boolean) => {
    if (!user || !session) return;
    setUser(null);
    if (logout) {
      setSession(null);
      setCredential(null);
    } else {
      void getDeviceUnlock(user.id, session.endpoint.id)
        .then((next) => setCredential(next ?? null));
    }
  };

  return {
    user,
    session,
    credential,
    restoringDevice,
    handleUnlocked,
    logoutLockedSession,
    handleTrustExhausted,
    unlockStoredSession,
    updateDisplayName,
    handleVaultLocked,
    setCredential
  };
}
