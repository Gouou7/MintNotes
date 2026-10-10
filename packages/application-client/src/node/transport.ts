import { ApplicationError } from "../protocol.js";

export function normalizeApplicationUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ApplicationError("INVALID_SERVER_URL", "Invalid server address"); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new ApplicationError("INVALID_SERVER_URL", "Use an HTTPS server origin, or loopback HTTP for development");
  }
  return url.origin;
}

const remoteErrorCodes = new Set(["APPLICATION_INVALID", "APPLICATION_REVOKED", "APPLICATION_EXPIRED", "APPLICATION_READ_ONLY", "HISTORY_CLEARED"]);

export class ApplicationTransport {
  constructor(private origin: string, private bearer: string, private lifetime: AbortSignal) {}

  async request(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    const signals = [this.lifetime, AbortSignal.timeout(10_000)];
    if (signal) signals.push(signal);
    let response: Response;
    try {
      response = await fetch(`${this.origin}/api/apps/v1${path}`, { ...init, credentials: "omit", redirect: "error", cache: "no-store",
        signal: AbortSignal.any(signals), headers: { ...init.headers, Authorization: `Bearer ${this.bearer}` } });
    } catch {
      if (this.lifetime.aborted || signal?.aborted) throw new ApplicationError("CANCELLED", "Request cancelled");
      throw new ApplicationError("NETWORK_UNAVAILABLE", "The notes server is unavailable");
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { code?: unknown };
      if (response.status >= 500) throw new ApplicationError("NETWORK_UNAVAILABLE", "The notes server is unavailable", response.status);
      throw new ApplicationError(typeof data.code === "string" && remoteErrorCodes.has(data.code) ? data.code : `HTTP_${response.status}`, "The notes request was rejected", response.status);
    }
    return response;
  }

  async json<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
    const response = await this.request(path, { ...init, headers: { "Content-Type": "application/json", ...init.headers } }, signal);
    try { return await response.json() as T; }
    catch { throw new ApplicationError("INVALID_RESPONSE", "The notes server returned an invalid response"); }
  }

  dispose(): void { this.bearer = ""; }
}
