import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyLoggerOptions,
  type FastifyRequest
} from "fastify";

export const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent"
] as const;

export type LogLevel = typeof LOG_LEVELS[number];
export interface ServerLoggerOptions extends FastifyLoggerOptions {
  base?: { bootId: string } | null;
  redact?: { paths: string[]; censor: string };
  transport?: {
    target: string;
    options: {
      colorize: boolean;
      singleLine: boolean;
      translateTime: string;
      ignore: string;
    };
  };
}
export interface LogDestination {
  write(message: string): void;
}

interface LoggerConfig {
  production: boolean;
  logLevel: LogLevel;
  bootId?: string;
}

const REDACTED = "[Redacted]";
const REDACT_PATHS = [
  "req",
  "res",
  "request",
  "reply",
  "headers",
  "cookies",
  "body",
  "payload",
  "authorization",
  "cookie",
  "authSecret",
  "currentAuthSecret",
  "newAuthSecret",
  "recoveryAuthSecret",
  "currentRecoveryAuthSecret",
  "replacementRecoveryAuthSecret",
  "activationCode",
  "ciphertext",
  "metadataCiphertext",
  "nonce",
  "metadataNonce",
  "wrappedVaultKey",
  "recoveryWrappedVaultKey",
  "*.headers",
  "*.cookies",
  "*.body",
  "*.payload",
  "*.authSecret",
  "*.currentAuthSecret",
  "*.newAuthSecret",
  "*.recoveryAuthSecret",
  "*.currentRecoveryAuthSecret",
  "*.replacementRecoveryAuthSecret",
  "*.activationCode",
  "*.ciphertext",
  "*.metadataCiphertext",
  "*.nonce",
  "*.metadataNonce",
  "*.wrappedVaultKey",
  "*.recoveryWrappedVaultKey"
];

export function createLoggerOptions(
  config: LoggerConfig,
  destination?: LogDestination
): ServerLoggerOptions {
  const common: ServerLoggerOptions = {
    level: config.logLevel,
    base: config.bootId ? { bootId: config.bootId } : null,
    redact: { paths: REDACT_PATHS, censor: REDACTED },
    serializers: {
      err(error) {
        const { errorType, errorCode } = safeError(error);
        return { type: errorType, message: REDACTED, stack: REDACTED, errorCode };
      }
    }
  };
  if (destination) return { ...common, stream: destination };
  if (config.production) return common;
  return {
    ...common,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        singleLine: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname"
      }
    }
  };
}

declare const logReferenceBrand: unique symbol;
export type LogReference = string & { readonly [logReferenceBrand]: true };
export type LogReferenceKind = "user" | "object" | "endpoint" | "setup";

const REFERENCE_PREFIX: Record<LogReferenceKind, string> = {
  user: "usr",
  object: "obj",
  endpoint: "ep",
  setup: "setup"
};

export class LogReferenceFactory {
  readonly #secret: Buffer;

  constructor(secret: Uint8Array = randomBytes(32)) {
    this.#secret = Buffer.from(secret);
  }

  create(kind: LogReferenceKind, id: string): LogReference {
    const digest = createHmac("sha256", this.#secret)
      .update(kind)
      .update("\0")
      .update(id)
      .digest("base64url")
      .slice(0, 12);
    return `${REFERENCE_PREFIX[kind]}_${digest}` as LogReference;
  }
}

export interface SafeError {
  errorType: "Error" | "UnknownError";
  errorCode?: string;
}

const safeErrorCodes = new Set([
  "INVALID_LOG_LEVEL", "INVALID_HOST", "INVALID_PORT", "INVALID_APP_ORIGIN",
  "INVALID_ALLOW_REGISTRATION", "INVALID_MAX_ATTACHMENT_SIZE_MB", "INVALID_USER_STORAGE_QUOTA_MB",
  "INVALID_USER_HISTORY_QUOTA_MB", "INVALID_SESSION_TTL_HOURS", "INVALID_TRUST_PROXY", "INVALID_NOTE_BODY_CHUNKING",
  "STORAGE_IN_USE_STOP_SERVICE_FIRST", "STORAGE_LOCK_INVALID",
  "SCHEMA_UNSUPPORTED", "BACKUP_INTEGRITY_FAILED",
  "EACCES", "EPERM", "EROFS", "ENOSPC", "ENOENT", "ENOTDIR", "EISDIR",
  "EADDRINUSE", "EADDRNOTAVAIL", "ENOTFOUND", "ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND",
  "SQLITE_BUSY", "SQLITE_LOCKED", "SQLITE_CANTOPEN", "SQLITE_PERM", "SQLITE_READONLY",
  "SQLITE_IOERR", "SQLITE_FULL", "SQLITE_CORRUPT", "SQLITE_NOTADB"
]);

export function safeError(error: unknown): SafeError {
  if (!(error instanceof Error)) return { errorType: "UnknownError" };
  const code = (error as Error & { code?: unknown }).code;
  return {
    errorType: "Error",
    ...(typeof code === "string" && safeErrorCodes.has(code) ? { errorCode: code } : {})
  };
}

export type StartupStep =
  | { phase: "module_load" | "config" | "storage_lock" | "database_open" | "app_setup" | "http_listen" }
  | { phase: "migration_backup" | "migration_apply"; fromSchema: number; toSchema: number };
export type ReportStartup = (step: StartupStep) => void;
type ServerSignal = "SIGINT" | "SIGTERM" | "fatal";
type FailurePhase = StartupStep["phase"] | "runtime" | "shutdown";
type FatalSource = "startup" | "uncaughtException" | "unhandledRejection" | "shutdown";
type FatalDiagnostic = { code: string; hint: string };

const phaseDiagnostics: Record<FailurePhase, FatalDiagnostic> = {
  module_load: { code: "APP_MODULE_LOAD_FAILED", hint: "Verify that the image or build contains the server and its runtime dependencies." },
  config: { code: "CONFIG_INVALID", hint: "Check the service environment against the deployment guide." },
  storage_lock: { code: "STORAGE_LOCK_FAILED", hint: "Check for other services or maintenance jobs using the data directory and verify mount permissions." },
  database_open: { code: "DATABASE_OPEN_FAILED", hint: "Check the mounted data directory and database permissions. Preserve the database and WAL." },
  migration_backup: { code: "MIGRATION_BACKUP_FAILED", hint: "Check disk space and backup directory permissions. Preserve any existing migration backup before retrying." },
  migration_apply: { code: "DATABASE_MIGRATION_FAILED", hint: "Preserve the database and verified upgrade backup. See the deployment guide before retrying." },
  app_setup: { code: "APP_SETUP_FAILED", hint: "Verify that the deployed build contains matching server and web assets." },
  http_listen: { code: "HTTP_LISTEN_FAILED", hint: "Check the service's listen address and port." },
  runtime: { code: "UNEXPECTED_ERROR", hint: "Check the preceding logs for the same boot ID." },
  shutdown: { code: "SHUTDOWN_FAILED", hint: "Check the preceding logs and confirm the service has stopped before maintenance." }
};

const knownDiagnostics = new Map<string, FatalDiagnostic>([
  ["STORAGE_IN_USE_STOP_SERVICE_FIRST", { code: "STORAGE_IN_USE_STOP_SERVICE_FIRST", hint: "Stop all services and maintenance jobs using this data directory before checking the lock file." }],
  ["STORAGE_LOCK_INVALID", { code: "STORAGE_LOCK_INVALID", hint: "Confirm the data directory is offline before inspecting the lock file. See the deployment guide." }],
  ["SCHEMA_UNSUPPORTED", { code: "SCHEMA_UNSUPPORTED", hint: "Check the supported upgrade paths in the deployment guide and preserve the original database." }],
  ["EADDRINUSE", { code: "EADDRINUSE", hint: "Check which process is already listening on the configured port." }]
]);

const storagePermissionCodes = new Set(["EACCES", "EPERM", "EROFS", "SQLITE_PERM", "SQLITE_READONLY"]);
const storagePhases = new Set<FailurePhase>(["storage_lock", "database_open", "migration_backup", "migration_apply"]);

function fatalDiagnostic(phase: FailurePhase, error: SafeError): FatalDiagnostic {
  const code = error.errorCode;
  if (code && storagePhases.has(phase) && storagePermissionCodes.has(code)) {
    return { code: "STORAGE_PERMISSION_DENIED", hint: "Check that the service user can write to the data mount and backup directory." };
  }
  return (code && knownDiagnostics.get(code)) || phaseDiagnostics[phase];
}

export function createBootLogger(environment: NodeJS.ProcessEnv = process.env, destination: LogDestination = process.stdout) {
  const bootId = randomBytes(8).toString("hex");
  const startedAt = performance.now();
  const version = environment.APP_VERSION === "development" || /^\d{1,9}\.\d{1,9}\.\d{1,9}$/.test(environment.APP_VERSION ?? "")
    ? environment.APP_VERSION : "development";
  const configuredLevel = LOG_LEVELS.find((level) => level === environment.LOG_LEVEL) ?? "info";
  const includeInfo = LOG_LEVELS.indexOf(configuredLevel) <= LOG_LEVELS.indexOf("info");
  let phase: FailurePhase = "module_load";
  let failed = false;

  function write(level: 30 | 60, event: string, msg: string, fields: Record<string, unknown> = {}) {
    if (level === 30 && !includeInfo) return;
    destination.write(`${JSON.stringify({ level, time: Date.now(), bootId, event, ...fields, msg })}\n`);
  }

  return {
    bootId,
    starting: () => write(30, "server.starting", "server process starting", { version, logLevel: configuredLevel }),
    step(step: StartupStep) {
      phase = step.phase;
      write(30, "server.startup_step", "server startup step", step);
    },
    started(port: number, production: boolean) {
      phase = "runtime";
      write(30, "server.started", "server listening", {
        version, port, mode: production ? "production" : "development", logLevel: configuredLevel,
        durationMs: Math.round(performance.now() - startedAt)
      });
    },
    stopping: (signal: ServerSignal) => write(30, "server.stopping", "server stopping", { signal }),
    stopped: (signal: ServerSignal) => write(30, "server.stopped", "server stopped", { signal }),
    fatal(source: FatalSource, error: unknown) {
      if (failed) return;
      failed = true;
      const failurePhase = source === "shutdown" ? "shutdown" : phase;
      const safe = safeError(error);
      const { code, hint } = fatalDiagnostic(failurePhase, safe);
      write(60, "server.fatal", "server fatal error", {
        source, phase: failurePhase, errorType: safe.errorType, code, causeCode: safe.errorCode, hint
      });
    }
  };
}

export interface ServerLogEventFields {
  "security.origin_rejected": { reason: "missing" | "mismatch" };
  "application.created": { actorRef: LogReference };
  "application.revoked": { actorRef: LogReference };
  "application.removed": { actorRef: LogReference };
  "auth.registered": { actorRef: LogReference; role: "admin" | "user" };
  "auth.activated": { actorRef: LogReference };
  "auth.login_succeeded": { actorRef: LogReference; endpointRef: LogReference; remembered: boolean };
  "auth.login_failed": { reason: "invalid_request" | "invalid_credentials" };
  "auth.logged_out": { actorRef: LogReference; endpointRef: LogReference };
  "auth.recovery_succeeded": { actorRef: LogReference };
  "auth.password_changed": { actorRef: LogReference };
  "auth.recovery_key_rotated": { actorRef: LogReference };
  "account.username_changed": { actorRef: LogReference; recoveryKeyReplaced: boolean };
  "account.endpoint_changed": { actorRef: LogReference; endpointRef: LogReference; action: "removed" | "signed_out" };
  "admin.account_setup_created": { actorRef: LogReference; setupRef: LogReference; expiresInHours: number };
  "admin.account_setup_deleted": { actorRef: LogReference; setupRef: LogReference };
  "admin.storage_quota_changed": { actorRef: LogReference; targetRef: LogReference; mode: string; quotaBytes: number | null };
  "admin.account_status_changed": { actorRef: LogReference; targetRef: LogReference; disabled: boolean };
  "admin.account_deleted": { actorRef: LogReference; targetRef: LogReference };
  "sync.object_conflict": { actorRef: LogReference; objectRef: LogReference; reason: "revision" | "objectType" | "idempotency" };
  "sync.batch_completed": { actorRef: LogReference; count: number; accepted: number; idempotent: number; conflicts: number };
  "storage.quota_rejected": { actorRef: LogReference; resource: "objects" | "attachments" | "history" };
  "sync.purge_completed": { actorRef: LogReference; count: number };
  "sync.purge_blocked": { actorRef: LogReference; count: number; reason: "conflict" | "protected_history" };
  "maintenance.completed": { job: "trash" | "history" | "endpoints" | "attachments"; affected: number };
  "maintenance.failed": { job: "trash" | "history" | "endpoints" | "attachments" } & SafeError;
}

const EVENT_MESSAGES: Record<keyof ServerLogEventFields, string> = {
  "security.origin_rejected": "state-changing request rejected by origin policy",
  "application.created": "application connection created",
  "application.revoked": "application connection revoked",
  "application.removed": "application connection record removed",
  "auth.registered": "account registered",
  "auth.activated": "account activated",
  "auth.login_succeeded": "login succeeded",
  "auth.login_failed": "login failed",
  "auth.logged_out": "endpoint logged out",
  "auth.recovery_succeeded": "account recovery succeeded",
  "auth.password_changed": "password changed",
  "auth.recovery_key_rotated": "recovery key rotated",
  "account.username_changed": "username changed",
  "account.endpoint_changed": "trusted endpoint changed",
  "admin.account_setup_created": "account setup created",
  "admin.account_setup_deleted": "account setup deleted",
  "admin.storage_quota_changed": "account storage quota changed",
  "admin.account_status_changed": "account status changed",
  "admin.account_deleted": "account deleted",
  "sync.object_conflict": "object synchronization conflict",
  "sync.batch_completed": "object batch processed",
  "storage.quota_rejected": "storage quota rejected write",
  "sync.purge_completed": "object purge completed",
  "sync.purge_blocked": "object purge blocked",
  "maintenance.completed": "maintenance job completed",
  "maintenance.failed": "maintenance job failed"
};

export type EventLogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export function logEvent<Event extends keyof ServerLogEventFields>(
  logger: FastifyBaseLogger,
  level: EventLogLevel,
  event: Event,
  fields: ServerLogEventFields[Event]
): void {
  const write = logger[level] as (fields: Record<string, unknown>, message: string) => void;
  write.call(logger, { event, ...fields }, EVENT_MESSAGES[event]);
}

function apiRoute(request: FastifyRequest): string {
  const route = request.routeOptions?.url;
  return typeof route === "string" && route.startsWith("/api") ? route : "unmatched";
}

export function registerHttpLogging(app: FastifyInstance): void {
  const reasonCodes = new WeakMap<FastifyRequest, string>();
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Request-ID", request.id);
  });

  app.addHook("preSerialization", async (request, reply, payload) => {
    if (reply.statusCode >= 400 && payload && typeof payload === "object" && Object.hasOwn(payload, "code")) {
      const code = (payload as { code: unknown }).code;
      if (typeof code === "string" && responseReasonCodes.has(code)) reasonCodes.set(request, code);
    }
    return payload;
  });

  app.addHook("onError", async (request, _reply, error) => {
    const route = apiRoute(request);
    if (route === "/api/health" || route === "unmatched") return;
    request.log.error({
      event: "http.request_error",
      requestId: request.id,
      method: request.method,
      route,
      ...safeError(error)
    }, "API request raised an unexpected error");
  });

  app.addHook("onResponse", async (request, reply) => {
    const route = apiRoute(request);
    const reasonCode = reasonCodes.get(request);
    if (route === "/api/health" || (route === "unmatched" && !reasonCode)) return;
    const fields = {
      event: "http.request_completed",
      requestId: request.id,
      method: request.method,
      route,
      statusCode: reply.statusCode,
      ...(reasonCode ? { reasonCode } : {}),
      durationMs: Math.round(reply.elapsedTime * 100) / 100
    };
    if (reply.statusCode >= 500) {
      request.log.error(fields, "API request completed with server error");
    } else if (reply.statusCode >= 400) {
      request.log.warn(fields, "API request completed with client error");
    } else {
      request.log.info(fields, "API request completed");
    }
  });
}

const responseReasonCodes = new Set([
  "BROWSER_SESSION_INVALID", "BROWSER_SESSION_CHANGED", "BROWSER_UPGRADE_REQUIRED", "DEVICE_REAUTH_REQUIRED",
  "PROTOCOL_UPGRADE_REQUIRED", "SYNC_RECONCILE_REQUIRED", "OWNERSHIP_INCOMPLETE",
  "CONTENT_QUOTA_EXCEEDED", "HISTORY_QUOTA_EXCEEDED", "METADATA_QUOTA_EXCEEDED"
]);

export function serverRequestId(): string {
  return randomUUID();
}
