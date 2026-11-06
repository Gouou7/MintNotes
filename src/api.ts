export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export function createApiClient(options: { signal?: AbortSignal; requireSession?: boolean; onInvalid?: (error: ApiError) => void } = {}) {
  let sessionId: string | undefined;
  let syncLease = "";
  let binding = new AbortController();
  async function request(path: string, init: RequestInit = {}, timeout?: number) {
    const expected = sessionId;
    if (options.requireSession && !expected) throw new DOMException("No verified session", "InvalidStateError");
    const signals = [options.signal, binding.signal, init.signal, timeout ? AbortSignal.timeout(timeout) : undefined].filter((signal): signal is AbortSignal => !!signal);
    const headers = new Headers(init.headers);
    headers.set("X-WebMD-Protocol", "3");
    headers.set("X-WebMD-Browser", "1");
    if (expected) headers.set("X-WebMD-Session", expected);
    if (syncLease) headers.set("X-WebMD-Sync-Lease", syncLease);
    const response = await fetch(path, {
      ...init, credentials: "same-origin", cache: "no-store", headers,
      signal: signals.length ? AbortSignal.any(signals) : undefined
    });
    const assertCurrent = () => {
      options.signal?.throwIfAborted();
      if (expected !== sessionId) throw new DOMException("Inactive session", "AbortError");
    };
    assertCurrent();
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      const error = new ApiError(String(data.error ?? `Request failed (${response.status})`), response.status, data);
      if (expected && expected === sessionId && !options.signal?.aborted
        && (data.code === "BROWSER_SESSION_CHANGED" || data.code === "BROWSER_SESSION_INVALID")) options.onInvalid?.(error);
      if (response.status === 413) storageRefresh();
      throw error;
    }
    return { response, assertCurrent };
  }

  return {
    bindSession(id: string | undefined) {
      if (id === sessionId) return;
      binding.abort();
      binding = new AbortController();
      syncLease = "";
      sessionId = id;
    },
    setSyncLease(value: string) { syncLease = value; },
    async api<T>(path: string, init: RequestInit = {}): Promise<T> {
      const headers = new Headers(init.headers);
      if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      const { response, assertCurrent } = await request(path, { ...init, headers }, 20_000);
      const data = await response.json().catch(() => ({})) as T;
      assertCurrent();
      if (init.method && init.method !== "GET" && /objects|attachments|history|avatar|storage-quota/.test(path)) storageRefresh();
      return data;
    },
    async uploadAttachmentChunk(path: string, ciphertext: ArrayBuffer, headers: Record<string, string>) {
      await request(path, { method: "PUT", headers: { "Content-Type": "application/octet-stream", ...headers }, body: ciphertext }, 30_000);
      storageRefresh();
    },
    async downloadAttachmentChunk(path: string, signal?: AbortSignal) {
      const { response, assertCurrent } = await request(path, { signal }, 30_000);
      const ciphertext = await response.arrayBuffer();
      assertCurrent();
      return {
        ciphertext, nonce: response.headers.get("X-WebMD-Nonce") ?? "",
        totalChunks: Number(response.headers.get("X-WebMD-Total-Chunks") ?? 0),
        encryptionVersion: Number(response.headers.get("X-WebMD-Encryption-Version") ?? 1)
      };
    },
    async stream(path: string, signal: AbortSignal) {
      return (await request(path, { signal, headers: { Accept: "text/event-stream" } })).response;
    }
  };
}

function storageRefresh() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("webmd:storage-refresh"));
}

export type ApiClient = ReturnType<typeof createApiClient>;
export const api = createApiClient().api;
