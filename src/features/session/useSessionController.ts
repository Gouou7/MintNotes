import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../api";
import { cryptoClient } from "../../crypto/client";
import {
  broadcastAccountLogout,
  clearCurrentBrowserSessionGrant,
  clearPendingEndpointRevocation,
  forgetDeviceUnlock,
  flushPendingEndpointRevocations,
  getDeviceUnlock,
  getRememberedOfflineDevice,
  grantCurrentBrowserSession,
  hasCurrentBrowserSessionGrant,
  hasDevicePin,
  listenForBrowserSessionGrantRequests,
  markEndpointRevocationPending,
  rememberDeviceUnlock,
  requestBrowserSessionGrant,
  restoreDeviceUnlock,
  updateVerifiedDeviceSession
} from "../../crypto/deviceUnlock";
import { deleteLocalUserData, localDb, type DeviceUnlockCredential } from "../../storage/database";
import type { AuthEndpoint, User } from "../../types";

type AuthSession = { user: User; endpoint: AuthEndpoint };

function isReloadNavigation(): boolean {
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return navigation?.type === "reload";
}

export function sessionsMatch(left: AuthSession, right: AuthSession): boolean {
  return left.user.id === right.user.id
    && left.endpoint.id === right.endpoint.id
    && right.endpoint.remembered;
}

export function useSessionController() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [credential, setCredential] = useState<DeviceUnlockCredential | null>(null);
  const [restoringDevice, setRestoringDevice] = useState(true);
  const [serverSessionVerified, setServerSessionVerified] = useState(false);
  const [offlineUnavailable, setOfflineUnavailable] = useState(false);
  const verificationInFlight = useRef<Promise<void> | null>(null);

  const clearSessionState = useCallback(async (userId?: string) => {
    if (userId) await forgetDeviceUnlock(userId).catch(() => undefined);
    await cryptoClient.lock().catch(() => undefined);
    setUser(null);
    setSession(null);
    setCredential(null);
    setServerSessionVerified(false);
    setOfflineUnavailable(false);
  }, []);

  const restoreOfflineSession = useCallback(async (): Promise<boolean> => {
    const remembered = await getRememberedOfflineDevice();
    if (!remembered) {
      setOfflineUnavailable(true);
      return false;
    }
    const { credential: stored, session: verified } = remembered;
    const offlineSession = { user: verified.user, endpoint: verified.endpoint };
    if (!hasDevicePin(stored)) {
      const restored = await restoreDeviceUnlock(stored.userId, stored.endpointId, false);
      if (!restored) {
        await forgetDeviceUnlock(stored.userId).catch(() => undefined);
        setOfflineUnavailable(true);
        return false;
      }
      setUser(verified.user);
    }
    setSession(offlineSession);
    setCredential(stored);
    setServerSessionVerified(false);
    setOfflineUnavailable(false);
    return true;
  }, []);

  const restoreVerifiedSession = useCallback(async (
    remote: AuthSession,
    preserveUnlockState = false
  ): Promise<boolean> => {
    const stored = await getDeviceUnlock(remote.user.id, remote.endpoint.id);
    if (!stored) return false;
    if (stored.mode === "session") {
      const browserSessionGranted = hasCurrentBrowserSessionGrant(remote.endpoint.id)
        || await requestBrowserSessionGrant(remote.endpoint.id);
      if (!browserSessionGranted) {
        await forgetDeviceUnlock(remote.user.id);
        await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        return false;
      }
    }
    const updated = await updateVerifiedDeviceSession(remote.user, remote.endpoint) ?? stored;
    setSession(remote);
    setCredential(updated);
    setServerSessionVerified(true);
    setOfflineUnavailable(false);
    if (preserveUnlockState) {
      setUser((current) => current ? remote.user : null);
      return true;
    }
    const allowPinRefresh = hasDevicePin(updated) && isReloadNavigation();
    if (await restoreDeviceUnlock(remote.user.id, remote.endpoint.id, allowPinRefresh)) {
      setUser(remote.user);
    }
    return true;
  }, []);

  useEffect(() => listenForBrowserSessionGrantRequests(), []);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!navigator.onLine) {
        await restoreOfflineSession();
        return;
      }
      try {
        await flushPendingEndpointRevocations();
        const remote = await api<AuthSession>("/api/auth/me");
        if (active) await restoreVerifiedSession(remote);
      } catch (value) {
        if (!active) return;
        if (value instanceof ApiError && value.status === 401) {
          const credentials = await localDb.deviceCredentials.toArray();
          await Promise.all(credentials.map((entry) => forgetDeviceUnlock(entry.userId)));
          return;
        }
        await restoreOfflineSession();
      }
    })().finally(() => {
      if (active) setRestoringDevice(false);
    });
    return () => { active = false; };
  }, [restoreOfflineSession, restoreVerifiedSession]);

  useEffect(() => {
    const invalidate = () => {
      const currentUserId = session?.user.id;
      void clearSessionState(currentUserId);
    };
    window.addEventListener("webmd:session-invalid", invalidate);
    return () => window.removeEventListener("webmd:session-invalid", invalidate);
  }, [clearSessionState, session?.user.id]);

  useEffect(() => {
    if (!session || serverSessionVerified) return;
    let cancelled = false;

    const verify = () => {
      if (
        cancelled
        || verificationInFlight.current
        || !navigator.onLine
        || document.visibilityState !== "visible"
      ) return;
      const expected = session;
      const attempt = (async () => {
        try {
          await flushPendingEndpointRevocations();
          const remote = await api<AuthSession>("/api/auth/me");
          if (cancelled) return;
          if (!sessionsMatch(expected, remote)) {
            await clearSessionState(expected.user.id);
            return;
          }
          await restoreVerifiedSession(remote, true);
        } catch (value) {
          if (cancelled) return;
          if (value instanceof ApiError && value.status === 401) {
            await clearSessionState(expected.user.id);
          }
        }
      })().finally(() => {
        if (verificationInFlight.current === attempt) verificationInFlight.current = null;
      });
      verificationInFlight.current = attempt;
    };

    const visibility = () => {
      if (document.visibilityState === "visible") verify();
    };
    const timer = window.setInterval(verify, 30_000);
    window.addEventListener("online", verify);
    document.addEventListener("visibilitychange", visibility);
    verify();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", verify);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [clearSessionState, restoreVerifiedSession, serverSessionVerified, session]);

  useEffect(() => {
    if (!offlineUnavailable || session) return;
    const online = () => setOfflineUnavailable(false);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [offlineUnavailable, session]);

  useEffect(() => {
    const logoutAcrossTabs = (event: Event) => {
      const userId = (event as CustomEvent<{ userId?: string }>).detail?.userId;
      const current = session;
      if (!current || current.user.id !== userId) return;
      clearCurrentBrowserSessionGrant();
      setUser(null);
      setSession(null);
      setCredential(null);
      setServerSessionVerified(false);
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
      unlockedUser,
      endpoint,
      endpoint.remembered ? "remembered" : "session"
    ).catch(() => undefined);
    setSession({ user: unlockedUser, endpoint });
    setCredential(stored ?? null);
    setUser(unlockedUser);
    setServerSessionVerified(true);
    setOfflineUnavailable(false);
  };

  const logoutLockedSession = async () => {
    const current = session;
    if (current) {
      await deleteLocalUserData(current.user.id);
      broadcastAccountLogout(current.user.id);
    }
    clearCurrentBrowserSessionGrant();
    await cryptoClient.lock().catch(() => undefined);
    const loggedOut = await api("/api/auth/logout", { method: "POST" })
      .then(() => true)
      .catch(() => false);
    if (current) {
      if (loggedOut) await clearPendingEndpointRevocation(current.endpoint.id).catch(() => undefined);
      else await markEndpointRevocationPending(current.user.id, current.endpoint.id).catch(() => undefined);
    }
    setUser(null);
    setSession(null);
    setCredential(null);
    setServerSessionVerified(false);
  };

  const handleTrustExhausted = async () => {
    const current = session;
    if (current) await forgetDeviceUnlock(current.user.id).catch(() => undefined);
    clearCurrentBrowserSessionGrant();
    await cryptoClient.lock().catch(() => undefined);
    const loggedOut = await api("/api/auth/logout", { method: "POST" })
      .then(() => true)
      .catch(() => false);
    if (current) {
      if (loggedOut) await clearPendingEndpointRevocation(current.endpoint.id).catch(() => undefined);
      else await markEndpointRevocationPending(current.user.id, current.endpoint.id).catch(() => undefined);
    }
    setUser(null);
    setSession(null);
    setCredential(null);
    setServerSessionVerified(false);
  };

  const unlockStoredSession = async (refreshCredential = false) => {
    if (!session || !credential) return;
    if (refreshCredential) {
      if (!serverSessionVerified) return;
      const next = await rememberDeviceUnlock(session.user, session.endpoint, credential.mode);
      setCredential(next);
    }
    grantCurrentBrowserSession(session.endpoint.id);
    setUser(session.user);
  };

  const updateDisplayName = (displayName: string) => {
    const nextSession = session
      ? { ...session, user: { ...session.user, displayName } }
      : null;
    setUser((current) => current ? { ...current, displayName } : current);
    setSession(nextSession);
    if (serverSessionVerified && nextSession) {
      void updateVerifiedDeviceSession(nextSession.user, nextSession.endpoint)
        .then((next) => { if (next) setCredential(next); })
        .catch(() => undefined);
    }
  };

  const updateUsername = (username: string) => {
    const nextSession = session
      ? { ...session, user: { ...session.user, username } }
      : null;
    setUser((current) => current ? { ...current, username } : current);
    setSession(nextSession);
    if (serverSessionVerified && nextSession) {
      void updateVerifiedDeviceSession(nextSession.user, nextSession.endpoint)
        .then((next) => { if (next) setCredential(next); })
        .catch(() => undefined);
    }
  };

  const handleVaultLocked = (logout: boolean) => {
    if (!user || !session) return;
    setUser(null);
    if (logout) {
      setSession(null);
      setCredential(null);
      setServerSessionVerified(false);
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
    serverSessionVerified,
    offlineUnavailable,
    handleUnlocked,
    logoutLockedSession,
    handleTrustExhausted,
    unlockStoredSession,
    updateDisplayName,
    updateUsername,
    handleVaultLocked,
    setCredential
  };
}
