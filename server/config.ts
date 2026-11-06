import { resolve } from "node:path";
import { z } from "zod";
import { LOG_LEVELS, type LogLevel } from "./logging.js";

export interface ServerConfig {
  bodyChunkingEnabled?: boolean;
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

const portValue = z.coerce.number().int().min(1).max(65_535);
const positiveNumber = z.coerce.number().finite().positive();

function invalidSetting(name: string): Error {
  return Object.assign(new Error(`Invalid ${name}`), { code: `INVALID_${name}` });
}

function numericEnvironmentValue(
  name: string,
  value: string | undefined,
  fallback: number,
  schema: z.ZodNumber | z.ZodEffects<z.ZodNumber, number, unknown> = positiveNumber
): number {
  const parsed = schema.safeParse(value ?? fallback);
  if (!parsed.success) throw invalidSetting(name);
  return parsed.data;
}

function booleanEnvironmentValue(name: string, value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw invalidSetting(name);
}

function applicationOrigin(value: string | undefined, production: boolean): string | undefined {
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalidSetting("APP_ORIGIN");
  }
  if (parsed.origin !== value || (production && parsed.protocol !== "https:")) {
    throw invalidSetting("APP_ORIGIN");
  }
  return parsed.origin;
}

export function loadServerConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = environment.NODE_ENV === "production";
  const requestedLogLevel = environment.LOG_LEVEL ?? "info";
  if (!LOG_LEVELS.includes(requestedLogLevel as LogLevel)) {
    throw invalidSetting("LOG_LEVEL");
  }
  const host = environment.HOST ?? "127.0.0.1";
  if (!host.trim() || host !== host.trim()) throw invalidSetting("HOST");
  return {
    bodyChunkingEnabled: booleanEnvironmentValue("NOTE_BODY_CHUNKING", environment.NOTE_BODY_CHUNKING, true),
    host,
    port: numericEnvironmentValue("PORT", environment.PORT, 8787, portValue),
    dataDirectory: resolve(production ? "/data" : environment.MINT_NOTES_SMOKE_STORAGE_PATH ?? "./data"),
    allowRegistration: booleanEnvironmentValue("ALLOW_REGISTRATION", environment.ALLOW_REGISTRATION),
    maxAttachmentBytes: numericEnvironmentValue("MAX_ATTACHMENT_SIZE_MB", environment.MAX_ATTACHMENT_SIZE_MB, 25) * 1024 * 1024,
    userStorageQuotaBytes: numericEnvironmentValue("USER_STORAGE_QUOTA_MB", environment.USER_STORAGE_QUOTA_MB, 2048) * 1024 * 1024,
    userHistoryQuotaBytes: numericEnvironmentValue("USER_HISTORY_QUOTA_MB", environment.USER_HISTORY_QUOTA_MB, 256) * 1024 * 1024,
    sessionTtlHours: numericEnvironmentValue("SESSION_TTL_HOURS", environment.SESSION_TTL_HOURS, 168),
    appOrigin: applicationOrigin(environment.APP_ORIGIN, production),
    production,
    trustProxy: booleanEnvironmentValue("TRUST_PROXY", environment.TRUST_PROXY),
    logLevel: requestedLogLevel as LogLevel
  };
}
