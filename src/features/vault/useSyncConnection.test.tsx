import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncConnection } from "./useSyncConnection";

const cursor = vi.hoisted(() => vi.fn());
vi.mock("../../storage/database", () => ({
  cursorKey: (userId: string) => `cursor:${userId}`,
  localDb: { meta: { get: cursor } }
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockEventSource extends EventTarget {
  static OPEN = 1;
  static instances: MockEventSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(readonly url: string) {
    super();
    MockEventSource.instances.push(this);
  }
}

const roots: Root[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", MockEventSource);
  MockEventSource.instances = [];
  cursor.mockReset().mockResolvedValue({ value: "42" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

async function mount(verified = true) {
  const synchronize = vi.fn().mockResolvedValue(undefined);
  const requestPull = vi.fn();
  const onHidden = vi.fn();
  const isActive = vi.fn().mockReturnValue(true);
  let connection!: ReturnType<typeof useSyncConnection>;
  let serverSessionVerified = verified;
  function Harness() {
    connection = useSyncConnection({
      userId: "user", clientId: "client", enabled: true, serverSessionVerified,
      isActive, synchronize, requestPull, onHidden
    });
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<Harness />));
  return {
    synchronize, requestPull, onHidden, isActive,
    connection: () => connection,
    verify: async () => {
      serverSessionVerified = true;
      await act(async () => root.render(<Harness />));
    }
  };
}

describe("sync connection lifecycle", () => {
  it("synchronizes and listens for changes despite a browser offline hint", async () => {
    const app = await mount();
    expect(app.synchronize).toHaveBeenCalledOnce();
    const source = MockEventSource.instances[0];
    expect(source.url).toBe("/api/sync/events?since=42&clientId=client");
    source.dispatchEvent(new Event("changed"));
    expect(app.requestPull).toHaveBeenCalledWith(250);
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(app.requestPull).toHaveBeenCalledWith(0);
  });

  it("waits for server session verification before any sync, cursor read or SSE", async () => {
    const app = await mount(false);
    app.connection().requestFallbackPull();
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("offline"));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(app.synchronize).not.toHaveBeenCalled();
    expect(app.requestPull).not.toHaveBeenCalled();
    expect(cursor).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(0);
    await app.verify();
    expect(app.synchronize).toHaveBeenCalledOnce();
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("treats an offline event as a reason to test the server without closing a working SSE", async () => {
    const app = await mount();
    const source = MockEventSource.instances[0];
    await act(async () => window.dispatchEvent(new Event("offline")));
    expect(app.synchronize).toHaveBeenCalledTimes(2);
    expect(source.close).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("retries a broken connection with backoff while the browser still reports offline", async () => {
    const app = await mount();
    MockEventSource.instances[0].onerror?.();
    app.connection().requestFallbackPull();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(app.requestPull).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(119_999));
    expect(app.requestPull).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(app.requestPull).toHaveBeenCalledTimes(2);
  });

  it("cancels fallback retries once SSE connects", async () => {
    const app = await mount();
    const source = MockEventSource.instances[0];
    source.onerror?.();
    source.readyState = MockEventSource.OPEN;
    source.onopen?.();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(app.requestPull).not.toHaveBeenCalled();
  });

  it("pauses hidden tabs and synchronizes when they become visible", async () => {
    const app = await mount();
    const source = MockEventSource.instances[0];
    source.onerror?.();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(source.close).toHaveBeenCalledOnce();
    expect(app.onHidden).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(app.requestPull).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(app.synchronize).toHaveBeenCalledTimes(2);
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it("does not reopen SSE after stopping with an outstanding cursor read", async () => {
    let finishRead!: (value: { value: string }) => void;
    cursor.mockReturnValueOnce(new Promise((resolve) => { finishRead = resolve; }));
    const app = await mount();
    app.connection().stop();
    await act(async () => finishRead({ value: "42" }));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("stops timers and rejects stale SSE events on lock or logout", async () => {
    const app = await mount();
    const source = MockEventSource.instances[0];
    source.onerror?.();
    app.isActive.mockReturnValue(false);
    app.connection().stop();
    source.dispatchEvent(new Event("changed"));
    source.onerror?.();
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(source.close).toHaveBeenCalledOnce();
    expect(app.requestPull).not.toHaveBeenCalled();
  });
});
