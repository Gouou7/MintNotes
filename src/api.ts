const jsonHeaders = { "Content-Type": "application/json" };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(20_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    signal,
    headers: init.body ? { ...jsonHeaders, ...init.headers } : init.headers
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const expectedCredentialFailure = ["/api/auth/login", "/api/auth/reauth", "/api/auth/recover", "/api/auth/password", "/api/account/recovery-key"].includes(path)
    || (init.method === "DELETE" && path.startsWith("/api/admin/users/"));
  if (response.status === 401 && typeof window !== "undefined" && !expectedCredentialFailure) {
    window.dispatchEvent(new CustomEvent("webmd:session-invalid"));
  }
  if (!response.ok) throw new ApiError(String(data.error ?? `Request failed (${response.status})`), response.status, data);
  return data as T;
}

export async function uploadAttachmentChunk(path: string, ciphertext: ArrayBuffer, headers: Record<string, string>): Promise<void> {
  const response = await fetch(path, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/octet-stream", ...headers },
    body: ciphertext,
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new ApiError(data.error ?? `Attachment upload failed (${response.status})`, response.status, data);
  }
}

export async function downloadAttachmentChunk(path: string): Promise<{ ciphertext: ArrayBuffer; nonce: string; totalChunks: number; encryptionVersion: number }> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new ApiError(data.error ?? `Attachment download failed (${response.status})`, response.status, data);
  }
  return {
    ciphertext: await response.arrayBuffer(),
    nonce: response.headers.get("X-WebMD-Nonce") ?? "",
    totalChunks: Number(response.headers.get("X-WebMD-Total-Chunks") ?? 0),
    encryptionVersion: Number(response.headers.get("X-WebMD-Encryption-Version") ?? 1)
  };
}
