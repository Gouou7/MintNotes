import { useEffect, useRef, useState } from "react";
import type { ApplicationConnection, ApplicationCredential, ApplicationPolicy, CreateApplicationConnectionRequest } from "@mint-notes/application-client";
import { api } from "../../api";
import { cryptoClient } from "../../crypto/client";

function connectionList(value: { connections: ApplicationConnection[] }): ApplicationConnection[] {
  if (!Array.isArray(value.connections)) throw new Error("Invalid application connection list");
  return value.connections;
}

const prefix = "/api/account/application-connections";

export function useApplicationConnections(userId: string, online: boolean) {
  const [connections, setConnections] = useState<ApplicationConnection[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [applicationKey, setApplicationKey] = useState<string | null>(null);
  const [retryPending, setRetryPending] = useState(false);
  const pending = useRef<{ credential: ApplicationCredential; request: CreateApplicationConnectionRequest } | null>(null);
  const lifetime = useRef(0);
  const running = useRef<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const generation = ++lifetime.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    pending.current = null;
    running.current = null;
    setApplicationKey(null);
    setRetryPending(false);
    setConnections([]);
    setBusy(online);
    setError(false);
    if (online) void api<{ connections: ApplicationConnection[] }>(prefix, { signal: controller.signal })
      .then((value) => { if (lifetime.current === generation) setConnections(connectionList(value)); })
      .catch(() => { if (lifetime.current === generation) setError(true); })
      .finally(() => { if (lifetime.current === generation) setBusy(false); });
    return () => { ++lifetime.current; abort.current?.abort(); pending.current = null; };
  }, [userId, online]);

  const run = async (operation: (signal: AbortSignal, generation: number) => Promise<void>): Promise<boolean> => {
    if (!online || busy || running.current !== null) return false;
    const generation = lifetime.current;
    running.current = generation;
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    setBusy(true);
    setError(false);
    try {
      await operation(controller.signal, generation);
      return lifetime.current === generation;
    } catch {
      if (lifetime.current === generation) setError(true);
      return false;
    } finally { if (lifetime.current === generation) { running.current = null; setBusy(false); } }
  };

  const refresh = () => run(async (signal, generation) => {
    const value = await api<{ connections: ApplicationConnection[] }>(prefix, { signal });
    if (lifetime.current === generation) setConnections(connectionList(value));
  });

  const create = (policy: ApplicationPolicy, access: "read" | "read-write") => run(async (signal, generation) => {
    if (!pending.current) {
      const credential = await cryptoClient.createApplicationCredential(userId);
      if (lifetime.current !== generation || signal.aborted) return;
      pending.current = { credential, request: { ...policy, access, connectionId: credential.connectionId,
        authSecret: credential.authSecret, vaultEnvelope: credential.vaultEnvelope } };
      setRetryPending(true);
    }
    const attempt = pending.current;
    let value: { connection: ApplicationConnection };
    try { value = await api(prefix, { method: "POST", body: JSON.stringify(attempt.request), signal }); }
    catch (error) {
      if (lifetime.current === generation && error && typeof error === "object" && "status" in error
        && typeof error.status === "number" && error.status >= 400 && error.status < 500 && error.status !== 429) {
        pending.current = null; setRetryPending(false);
      }
      throw error;
    }
    if (lifetime.current !== generation || signal.aborted) return;
    if (!value?.connection || value.connection.connectionId !== attempt.request.connectionId) throw new Error("Invalid application registration response");
    setConnections((rows) => [value.connection, ...rows.filter((row) => row.connectionId !== value.connection.connectionId)]);
    setApplicationKey(attempt.credential.applicationKey);
    pending.current = null;
    setRetryPending(false);
  });

  const update = (id: string, policy: ApplicationPolicy) => run(async (signal, generation) => {
    const value = await api<{ connection: ApplicationConnection }>(`${prefix}/${id}`, { method: "PATCH", body: JSON.stringify(policy), signal });
    if (lifetime.current === generation) setConnections((rows) => rows.map((row) => row.connectionId === id ? value.connection : row));
  });

  const revoke = (id: string | null) => run(async (signal, generation) => {
    await api(id ? `${prefix}/${id}` : `${prefix}/revoke-all`, { method: id ? "DELETE" : "POST", signal });
    const value = await api<{ connections: ApplicationConnection[] }>(prefix, { signal });
    if (lifetime.current === generation) setConnections(connectionList(value));
  });

  const dismissKey = () => { setApplicationKey(null); pending.current = null; setRetryPending(false); };
  return { connections, busy, error, applicationKey, retryPending, create, update, revoke, refresh, dismissKey };
}
