import { resolve } from "node:path";
import { LOG_LEVELS, type LogLevel } from "./logging.js";

export interface ServerConfig {
  host: string;
  port: number;
  dataDirectory: string;
  allowRegistration: boolean;
  maxAttachmentBytes: number;
  userStorageQuotaBytes: number;
  userHistoryQuotaBytes: number;
  sessionTtlHours: number;
  appOrigin?: string;
  production: boolean;
  trustProxy: boolean;
  logLevel: LogLevel;
}

export function loadServerConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = environment.NODE_ENV === "production";
  const requestedLogLevel = environment.LOG_LEVEL ?? "info";
  if (!LOG_LEVELS.includes(requestedLogLevel as LogLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${requestedLogLevel}`);
  }
  return {
    host: environment.HOST ?? "127.0.0.1",
    port: Number(environment.PORT ?? 8787),
    dataDirectory: resolve(production ? "/data" : environment.MINT_NOTES_SMOKE_STORAGE_PATH ?? "./data"),
    allowRegistration: environment.ALLOW_REGISTRATION === "true",
    maxAttachmentBytes: Math.max(1, Number(environment.MAX_ATTACHMENT_SIZE_MB ?? 25)) * 1024 * 1024,
    userStorageQuotaBytes: Math.max(1, Number(environment.USER_STORAGE_QUOTA_MB ?? 2048)) * 1024 * 1024,
    userHistoryQuotaBytes: Math.max(1, Number(environment.USER_HISTORY_QUOTA_MB ?? 256)) * 1024 * 1024,
    sessionTtlHours: Number(environment.SESSION_TTL_HOURS ?? 168),
    appOrigin: environment.APP_ORIGIN || undefined,
    production,
    trustProxy: environment.TRUST_PROXY === "true",
    logLevel: requestedLogLevel as LogLevel
  };
}
