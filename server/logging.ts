import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  type FastifyBaseLogger,
  type FastifyError,
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
  base?: null;
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
    base: null,
    redact: { paths: REDACT_PATHS, censor: REDACTED },
    serializers: {
      err(error: FastifyError) {
        return {
          type: error.name,
          message: REDACTED,
          stack: REDACTED
        };
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
  errorType: string;
  errorMessage: string;
  errorStack?: string;
}

export function safeError(error: unknown): SafeError {
  if (error instanceof Error) {
    return {
      errorType: error.name,
      errorMessage: error.message,
      ...(error.stack ? { errorStack: error.stack } : {})
    };
  }
  return { errorType: "UnknownError", errorMessage: "Non-Error value thrown" };
}

function safeRequestError(error: unknown): { errorType: string; errorCode?: string } {
  if (!(error instanceof Error)) return { errorType: "UnknownError" };
  const code = (error as Error & { code?: unknown }).code;
  return {
    errorType: error.name,
    ...(typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code) ? { errorCode: code } : {})
  };
}

export interface ServerLogEventFields {
  "server.started": { host: string; port: number; mode: "development" | "production"; logLevel: LogLevel };
  "server.stopping": { signal: "SIGINT" | "SIGTERM" | "fatal" };
  "server.stopped": { signal: "SIGINT" | "SIGTERM" | "fatal" };
  "server.fatal": { source: "startup" | "uncaughtException" | "unhandledRejection" } & SafeError;
  "security.origin_rejected": { reason: "missing" | "mismatch" };
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
  "server.started": "server started",
  "server.stopping": "server stopping",
  "server.stopped": "server stopped",
  "server.fatal": "server fatal error",
  "security.origin_rejected": "state-changing request rejected by origin policy",
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
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Request-ID", request.id);
  });

  app.addHook("onError", async (request, _reply, error) => {
    const route = apiRoute(request);
    if (route === "/api/health" || route === "unmatched") return;
    request.log.error({
      event: "http.request_error",
      requestId: request.id,
      method: request.method,
      route,
      ...safeRequestError(error)
    }, "API request raised an unexpected error");
  });

  app.addHook("onResponse", async (request, reply) => {
    const route = apiRoute(request);
    if (route === "/api/health" || route === "unmatched") return;
    const fields = {
      event: "http.request_completed",
      requestId: request.id,
      method: request.method,
      route,
      statusCode: reply.statusCode,
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

export function serverRequestId(): string {
  return randomUUID();
}
