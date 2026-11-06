import { localDb } from "../../storage/database";

const stateKey = "browser-account-selection";
const channelName = "webmd-account-selection";
export interface BrowserSelection {
  userId: string | null;
  generation: string;
  closing?: boolean;
}

export function supportsAccountSwitching() {
  return typeof navigator.locks?.request === "function" && typeof BroadcastChannel !== "undefined";
}

export async function readSelection(): Promise<BrowserSelection | undefined> {
  const row = await localDb.meta.get(stateKey);
  return row ? JSON.parse(row.value) as BrowserSelection : undefined;
}

export async function writeSelection(selection: BrowserSelection) {
  await localDb.meta.put({ key: stateKey, value: JSON.stringify(selection) });
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage(selection);
    channel.close();
  }
}

export function subscribeToSelection(listener: () => void) {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(channelName);
  channel.addEventListener("message", listener);
  return () => channel.close();
}

export async function browserAction<T>(action: () => Promise<T>): Promise<T> {
  return navigator.locks?.request ? navigator.locks.request(channelName, action) : action();
}

function workspaceName(generation: string) {
  return `webmd-open-workspace:${generation}`;
}

export async function retainWorkspace(generation: string): Promise<() => void> {
  if (!navigator.locks?.request) return () => undefined;
  return new Promise((resolve, reject) => {
    void navigator.locks.request(workspaceName(generation), { mode: "shared" }, () =>
      new Promise<void>((release) => resolve(release))).catch(reject);
  });
}

export async function awaitClosedWorkspaces(generation: string) {
  if (!navigator.locks?.request) return;
  await navigator.locks.request(workspaceName(generation), { signal: AbortSignal.timeout(5000) }, () => undefined);
}

const sessionChannel = "webmd-browser-session-context";

export function shareSessionContext(getContext: (generation: string) => string | undefined) {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(sessionChannel);
  channel.addEventListener("message", ({ data }) => {
    if (data.kind !== "request") return;
    const sessionId = getContext(data.generation);
    if (sessionId) channel.postMessage({ kind: "context", requestId: data.requestId, sessionId });
  });
  return () => channel.close();
}

export async function requestSessionContext(generation: string): Promise<string | undefined> {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(sessionChannel);
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const finish = (id?: string) => {
      window.clearTimeout(timeout);
      channel.close();
      resolve(id);
    };
    const timeout = window.setTimeout(() => finish(), 400);
    channel.addEventListener("message", ({ data }) => {
      if (data.kind === "context" && data.requestId === requestId && typeof data.sessionId === "string") finish(data.sessionId);
    });
    channel.postMessage({ kind: "request", generation, requestId });
  });
}
