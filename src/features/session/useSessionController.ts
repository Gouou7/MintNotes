import { useEffect, useRef, useState } from "react";
import { ApiError, createApiClient } from "../../api";
import { createCryptoClient, type CryptoClient } from "../../crypto/client";
import {
  clearPinRefreshGrant, clearPendingEndpointRevocation, flushPendingEndpointRevocations,
  getDeviceUnlock, getRememberedOfflineDevice, grantPinRefresh, hasDevicePin,
  rememberDeviceUnlock, restoreDeviceUnlock, unlockDeviceWithPin, updateVerifiedDeviceSession, verifiedSessionForCredential
} from "../../crypto/deviceUnlock";
import { deleteLocalUserData, localDb, type DeviceUnlockCredential } from "../../storage/database";
import type { AuthEndpoint, BrowserSession, User } from "../../types";
import { awaitClosedWorkspaces, browserAction, readSelection, requestSessionContext, retainWorkspace, shareSessionContext, subscribeToSelection, supportsAccountSwitching, writeSelection } from "./browserCoordinator";
import { enrollDevice, requestSession } from "./deviceSession";
import type { WorkspaceServices } from "./workspaceServices";

type Account = { user: User; endpoint: AuthEndpoint; credential: DeviceUnlockCredential | null };
type CloseWorkspace = (discard: boolean) => Promise<boolean>;
interface Runtime extends WorkspaceServices {
  id: string;
  generation: string;
  account: Account;
  online: BrowserSession | null;
  release(): void;
  abort: AbortController;
}
const linkKey = "webmd-active-browser-session-v1";
type SessionLink = { userId: string; endpointId: string; generation: string; sessionId: string };

function readSessionLink(): SessionLink | null {
  try { return JSON.parse(sessionStorage.getItem(linkKey) ?? "null") as SessionLink | null; }
  catch { return null; }
}

function linkFor(account: Account, generation?: string) {
  const link = readSessionLink();
  return link?.userId === account.user.id && link.endpointId === account.endpoint.id && link.generation === generation
    ? link : null;
}

function isReload() {
  return (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "reload";
}

async function listAccounts(): Promise<Account[]> {
  return (await localDb.deviceCredentials.toArray()).flatMap((credential) => {
    const verified = verifiedSessionForCredential(credential);
    return verified ? [{ user: verified.user, endpoint: verified.endpoint, credential }] : [];
  });
}

export function useSessionController() {
  const [workspace, setWorkspace] = useState<Runtime | null>(null);
  const [locked, setLocked] = useState<Account | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chooser, setChooser] = useState(false);
  const [login, setLogin] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"switchFailed" | "reauth" | null>(null);
  const [online, setOnline] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const current = useRef<Runtime | null>(null);
  const closeHandler = useRef<CloseWorkspace | null>(null);
  const closeFlight = useRef<Promise<boolean> | null>(null);
  const authWorker = useRef<CryptoClient | null>(null);
  const verifyFlight = useRef(false);
  const changing = useRef(false);

  const refreshAccounts = async () => {
    const entries = await listAccounts();
    setAccounts(entries);
    return entries;
  };

  function leaveWorkspace(discard = false) {
    if (closeFlight.current) return closeFlight.current;
    const instance = current.current;
    if (!instance) return Promise.resolve(true);
    const task = (async () => {
      if (closeHandler.current && !await closeHandler.current(discard)) return false;
      current.current = null;
      instance.abort.abort();
      instance.cryptoClient.dispose();
      clearPinRefreshGrant();
      sessionStorage.removeItem(linkKey);
      setWorkspace(null);
      setOnline(false);
      setLocked(instance.account.credential && hasDevicePin(instance.account.credential) ? instance.account : null);
      instance.release();
      return true;
    })().finally(() => { closeFlight.current = null; });
    closeFlight.current = task;
    return task;
  }

  async function closeForChange(discard = false, retainTabSession = false) {
    const selection = await readSelection();
    if (!selection?.userId) return;
    const link = readSessionLink();
    const sessionId = current.current?.online?.sessionId ?? link?.sessionId;
    changing.current = true;
    try {
      await writeSelection({ ...selection, closing: true });
      if (!await leaveWorkspace(discard)) throw new Error("Local save failed");
      await awaitClosedWorkspaces(selection.generation);
    } catch (reason) {
      await writeSelection({ ...selection, closing: false });
      throw reason;
    } finally { changing.current = false; }
    if (!retainTabSession && sessionId && navigator.onLine) {
      const transport = createApiClient();
      transport.bindSession(sessionId);
      await transport.api("/api/auth/session/close", {
        method: "POST", signal: AbortSignal.timeout(2500)
      }).catch(() => undefined);
    }
    const next = { userId: selection.userId, generation: crypto.randomUUID() };
    await writeSelection(next);
    sessionStorage.removeItem(linkKey);
    if (retainTabSession && link?.userId === next.userId) {
      sessionStorage.setItem(linkKey, JSON.stringify({ ...link, generation: next.generation }));
    }
  }

  async function mountWorkspace(account: Account, worker: CryptoClient, session: BrowserSession | null) {
    let selection = await readSelection();
    if (!selection || selection.userId !== account.user.id || selection.closing) {
      selection = { userId: account.user.id, generation: crypto.randomUUID() };
      await writeSelection(selection);
    }
    if (session) {
      const credential = await updateVerifiedDeviceSession(session.user, session.endpoint).catch(() => undefined);
      account = { user: session.user, endpoint: session.endpoint, credential: credential ?? account.credential };
    }
    const release = await retainWorkspace(selection.generation);
    const abort = new AbortController();
    const instance: Runtime = {
      id: crypto.randomUUID(), generation: selection.generation, account, online: session, release, abort,
      cryptoClient: worker,
      transport: createApiClient({ requireSession: true, signal: abort.signal, onInvalid: () => {
        if (current.current !== instance) return;
        instance.online = null;
        instance.transport.bindSession(undefined);
        sessionStorage.removeItem(linkKey);
        setOnline(false);
        void reverify();
      } })
    };
    instance.transport.bindSession(session?.sessionId);
    if (session) storeSessionLink(instance, session);
    if (account.credential && hasDevicePin(account.credential)) await grantPinRefresh(account.credential, worker, selection.generation);
    current.current = instance;
    setSelectedId(account.user.id);
    setLocked(null);
    setChooser(false);
    setLogin(false);
    setError(null);
    setOnline(Boolean(session));
    setWorkspace(instance);
  }

  function storeSessionLink(instance: Runtime, session: BrowserSession) {
    sessionStorage.setItem(linkKey, JSON.stringify({
      userId: session.user.id, endpointId: session.endpoint.id,
      sessionId: session.sessionId, generation: instance.generation
    } satisfies SessionLink));
  }

  async function connect(account: Account, worker: CryptoClient) {
    if (!navigator.onLine) return null;
    const selection = await readSelection();
    const previous = linkFor(account, selection?.generation)?.sessionId;
    try {
      await flushPendingEndpointRevocations();
      return await requestSession(account, worker, previous);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status < 500 && reason.status !== 429) throw reason;
      return null;
    }
  }

  async function reverify() {
    const instance = current.current;
    if (verifyFlight.current || !navigator.onLine || document.visibilityState === "hidden") return;
    verifyFlight.current = true;
    try {
      await browserAction(async () => {
        if (current.current !== instance) return;
        if (!instance) {
          await flushPendingEndpointRevocations();
          return;
        }
        const selection = await readSelection();
        if (current.current !== instance || selection?.closing || selection?.generation !== instance.generation) return;
        try {
          await flushPendingEndpointRevocations();
          const expiresAt = instance.online?.expiresAt;
          const renew = instance.online?.endpoint.remembered && !!expiresAt && Date.parse(expiresAt) - Date.now() < 30 * 86_400_000;
          const session = await requestSession(instance.account, instance.cryptoClient, instance.online?.sessionId, renew);
          if (current.current !== instance || instance.abort.signal.aborted) return;
          if (!session) {
            if (!await getDeviceUnlock(instance.account.user.id, instance.account.endpoint.id)) {
              await invalidateTrust(instance.account);
            } else if (instance.account.credential?.mode === "session" && await leaveWorkspace()) {
              setLogin(true);
            }
            return;
          }
          instance.online = session;
          if (JSON.stringify(instance.account.user) !== JSON.stringify(session.user)) {
            const credential = await updateVerifiedDeviceSession(session.user, session.endpoint).catch(() => undefined);
            if (current.current !== instance || instance.abort.signal.aborted) return;
            instance.account = { user: session.user, endpoint: session.endpoint, credential: credential ?? instance.account.credential };
            setWorkspace({ ...instance });
          }
          instance.transport.bindSession(session.sessionId);
          storeSessionLink(instance, session);
          setOnline(true);
        } catch (reason) {
          if (current.current !== instance || instance.abort.signal.aborted) return;
          if (reason instanceof ApiError && reason.data.code === "DEVICE_REAUTH_REQUIRED") {
            await invalidateTrust(instance.account);
          }
        }
      });
    } catch {
      // The local workspace remains available when coordination is temporarily unavailable.
    } finally { verifyFlight.current = false; }
  }

  async function forgetTrust(account: Account) {
    await localDb.transaction("rw", localDb.deviceCredentials, localDb.deviceGrants, async () => {
      await localDb.deviceCredentials.delete(account.user.id);
      await localDb.deviceGrants.delete(account.user.id);
    });
  }

  async function invalidateTrust(account: Account) {
    await forgetTrust(account);
    const instance = current.current;
    if (instance?.account.user.id === account.user.id) {
      instance.online = null;
      instance.transport.bindSession(undefined);
      setOnline(false);
    }
    setError("reauth");
    if ((await readSelection())?.userId === account.user.id) {
      try { await closeForChange(); }
      catch { return; } // Keep unsaved content accessible until the workspace can close safely.
    }
    setLocked(null);
    setChooser((await refreshAccounts()).length > 0);
  }

  async function openAccount(account: Account, pin?: string, allowReload = false) {
    const credential = account.credential;
    if (!credential) return;
    const worker = createCryptoClient();
    try {
      const selection = await readSelection();
      if (pin !== undefined) {
        const link = linkFor(account, selection?.generation);
        const result = await unlockDeviceWithPin(account.user.id, account.endpoint.id, pin, worker, link?.sessionId);
        if (result === "invalid") return "invalid";
        if (result === "exhausted") {
          if (navigator.onLine) void flushPendingEndpointRevocations();
          await invalidateTrust(account);
          return "exhausted";
        }
      } else if (!await restoreDeviceUnlock(account.user.id, account.endpoint.id, allowReload, worker, selection?.generation)) {
        if (hasDevicePin(credential)) setLocked(account);
        else { setLogin(true); setError("reauth"); }
        return;
      }
      let session: BrowserSession | null;
      try {
        session = await connect(account, worker);
      } catch (reason) {
        if (!(reason instanceof ApiError) || reason.data.code !== "DEVICE_REAUTH_REQUIRED") throw reason;
        await invalidateTrust(account);
        return;
      }
      if (!session && credential.mode === "session") {
        setLogin(true);
        return;
      }
      await mountWorkspace(account, worker, session);
      if (navigator.onLine && !session && !await localDb.deviceGrants.get(account.user.id)) setError("reauth");
      return "ok";
    } finally {
      if (current.current?.cryptoClient !== worker) worker.dispose();
    }
  }

  useEffect(() => {
    let active = true;
    void browserAction(async () => {
      if (!active) return;
      let selection = await readSelection();
      if (selection?.closing) {
        selection = { userId: selection.userId, generation: crypto.randomUUID() };
        await writeSelection(selection);
      }
      const entries = await refreshAccounts();
      if (!active) return;
      const remembered = selection ? entries.find((entry) => entry.user.id === selection?.userId)
        : (await getRememberedOfflineDevice())?.session;
      let account: Account | undefined = remembered && {
        user: remembered.user, endpoint: remembered.endpoint,
        credential: await getDeviceUnlock(remembered.user.id, remembered.endpoint.id) ?? null
      };
      if (!account && selection?.userId) {
        const stored = await getDeviceUnlock(selection.userId);
        if (stored?.verifiedSession && stored.mode === "session" && navigator.onLine) {
          const previous = readSessionLink();
          const sessionId = previous?.generation === selection.generation && previous.userId === selection.userId
            ? previous.sessionId : await requestSessionContext(selection.generation);
          if (sessionId) {
            sessionStorage.setItem(linkKey, JSON.stringify({
              userId: stored.userId, endpointId: stored.endpointId, generation: selection.generation, sessionId
            } satisfies SessionLink));
            account = { user: stored.verifiedSession.user, endpoint: stored.verifiedSession.endpoint, credential: stored };
          }
        }
      }
      setSelectedId(selection?.userId ?? account?.user.id ?? null);
      if (account?.credential && active) await openAccount(account, undefined, isReload());
      else setChooser(entries.length > 0);
    }).catch(() => { if (active) setError("switchFailed"); })
      .finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const check = async () => {
      if (changing.current) return;
      const instance = current.current;
      const selection = await readSelection();
      if (instance && (selection?.closing || selection?.generation !== instance.generation)) {
        if (await leaveWorkspace()) {
          setSelectedId(selection?.userId ?? null);
          setChooser(true);
          await refreshAccounts();
        }
      }
    };
    const wake = () => {
      setBrowserOnline(navigator.onLine);
      void check().then(reverify).catch(() => undefined);
    };
    const stopSharing = shareSessionContext((generation) => {
      const instance = current.current;
      if (!changing.current && instance?.generation === generation) return instance.online?.sessionId;
    });
    const unsubscribe = subscribeToSelection(() => { void check().catch(() => undefined); });
    const interval = window.setInterval(wake, 30_000);
    window.addEventListener("online", wake);
    window.addEventListener("offline", wake);
    window.addEventListener("pageshow", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      unsubscribe();
      stopSharing();
      window.clearInterval(interval);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", wake);
      window.removeEventListener("pageshow", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  async function action<T>(task: () => Promise<T>) {
    setBusy(true);
    setError(null);
    try { return await browserAction(task); }
    finally { setBusy(false); }
  }

  const showChooser = () => {
    setError(null);
    setLogin(false);
    setChooser(true);
    void refreshAccounts().catch(() => setError("switchFailed"));
  };

  const choose = (account: Account) => action(async () => {
    if (current.current?.account.user.id === account.user.id) {
      setChooser(false);
      return;
    }
    const selection = await readSelection();
    if (selection?.userId !== account.user.id) await closeForChange();
    const credential = await getDeviceUnlock(account.user.id, account.endpoint.id);
    if (!credential) { await refreshAccounts(); return; }
    const target = { ...account, credential };
    setChooser(false);
    if (hasDevicePin(credential)) setLocked(target);
    else { setLocked(null); await openAccount(target); }
  }).catch(() => setError("switchFailed"));

  async function runAuthentication<T>(task: () => Promise<T>): Promise<T> {
    return action(async () => {
      try { await closeForChange(); }
      catch { throw new Error("Browser account change blocked"); }
      if (navigator.onLine) await flushPendingEndpointRevocations();
      return task();
    });
  }

  async function handleUnlocked(session: BrowserSession, worker: CryptoClient, authSecret?: string) {
    if (!session.sessionId) throw new Error("Browser session unavailable");
    const verified = await requestSession(session, worker, session.sessionId);
    if (!verified) throw new Error("Browser session unavailable");
    const credential = await rememberDeviceUnlock(session.user, session.endpoint, session.endpoint.remembered ? "remembered" : "session", worker);
    await clearPendingEndpointRevocation(session.endpoint.id);
    if (session.endpoint.remembered && authSecret) await enrollDevice(session, worker, authSecret);
    if (!session.endpoint.remembered) await localDb.deviceGrants.delete(session.user.id);
    await mountWorkspace({ user: session.user, endpoint: session.endpoint, credential }, worker, verified);
    authWorker.current = null;
    await refreshAccounts();
  }

  const beginLogin = () => {
    setChooser(false);
    setLogin(true);
    setError(null);
  };

  const getAuthWorker = () => authWorker.current ??= createCryptoClient();

  const close = (reason: "lock" | "logout") => action(async () => {
    const account = current.current?.account ?? locked;
    if (!account) return;
    const selection = await readSelection();
    const sessionId = current.current?.online?.sessionId ?? linkFor(account, selection?.generation)?.sessionId;
    if (selection?.userId === account.user.id) await closeForChange(reason === "logout", reason === "lock" && account.credential?.mode === "session");
    if (reason === "logout") {
      const grant = await localDb.deviceGrants.get(account.user.id);
      await deleteLocalUserData(account.user.id, {
        userId: account.user.id, endpointId: account.endpoint.id,
        grantId: grant?.endpointId === account.endpoint.id ? grant.id : undefined, sessionId, createdAt: new Date().toISOString()
      });
      if (selection?.userId === account.user.id) {
        await writeSelection({ userId: null, generation: crypto.randomUUID() });
      }
      if (navigator.onLine) void flushPendingEndpointRevocations();
      setLocked(null);
      setChooser((await refreshAccounts()).length > 0);
      setSelectedId(null);
      return;
    }
    setLocked(account);
  }).catch(() => setError("switchFailed"));

  const unlock = (pin: string) => action(async () => {
    if (!locked) return;
    const selection = await readSelection();
    if (selection?.userId !== locked.user.id) await closeForChange();
    return openAccount(locked, pin);
  });

  const updateAccount = (update: Partial<User> | DeviceUnlockCredential | null, isCredential = false) => {
    const instance = current.current;
    if (!instance) return;
    if (isCredential) {
      instance.account = { ...instance.account, credential: update as DeviceUnlockCredential | null };
    } else {
      instance.account = { ...instance.account, user: { ...instance.account.user, ...update } };
      if (instance.online) void updateVerifiedDeviceSession(instance.account.user, instance.account.endpoint).catch(() => undefined);
    }
    setWorkspace({ ...instance });
  };

  return {
    workspace, locked, accounts, selectedId, chooser, login, restoring, busy, error, online, browserOnline,
    canSwitch: supportsAccountSwitching(), refreshAccounts, showChooser, choose, beginLogin, getAuthWorker, runAuthentication, handleUnlocked,
    close, unlock, updateAccount, registerClose: (handler: CloseWorkspace | null) => { closeHandler.current = handler; },
    cancelChooser: () => { setChooser(false); setError(null); },
    cancelLogin: () => {
      authWorker.current?.dispose();
      authWorker.current = null;
      setLogin(false);
      if (!current.current) showChooser();
    }
  };
}
