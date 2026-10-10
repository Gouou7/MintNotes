export const APPLICATION_PROTOCOL_VERSION = 1 as const;
export const APPLICATION_API_PREFIX = "/api/apps/v1";
export type ApplicationAccess = "read" | "read-write";

export interface VaultEnvelope {
  version: 1;
  ciphertext: string;
  nonce: string;
}

export interface ApplicationPolicy {
  name: string;
  idleTimeoutDays: 7 | 30 | 90 | null;
  expiresAt: string | null;
}

export interface ApplicationConnection extends ApplicationPolicy {
  connectionId: string;
  access: ApplicationAccess;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  validUntil: string | null;
  status: "active" | "expired" | "revoked";
}

export interface ApplicationCredential {
  applicationKey: string;
  connectionId: string;
  authSecret: string;
  vaultEnvelope: VaultEnvelope;
}

export interface CreateApplicationConnectionRequest extends ApplicationPolicy {
  connectionId: string;
  access: ApplicationAccess;
  authSecret: string;
  vaultEnvelope: VaultEnvelope;
}

export interface ApplicationConnectionBootstrap {
  protocolVersion: 1;
  objectSchemaVersion: 2;
  encryptionVersion: 1;
  userId: string;
  connection: ApplicationConnection;
  vaultEnvelope: VaultEnvelope;
  historyEnabled: boolean;
  serverTime: string;
}

export class ApplicationError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message);
    this.name = "ApplicationError";
  }
}

export function effectiveApplicationExpiry(policy: {
  createdAt: string;
  lastUsedAt: string | null;
  idleTimeoutDays: number | null;
  expiresAt: string | null;
}): string | null {
  const deadlines = [
    policy.expiresAt ? Date.parse(policy.expiresAt) : Infinity,
    policy.idleTimeoutDays === null ? Infinity
      : Date.parse(policy.lastUsedAt ?? policy.createdAt) + policy.idleTimeoutDays * 86_400_000
  ];
  const deadline = Math.min(...deadlines);
  return Number.isFinite(deadline) ? new Date(deadline).toISOString() : null;
}

export function assertApplicationActive(connection: ApplicationConnection, now = Date.now()): void {
  if (connection.revokedAt || connection.status === "revoked") {
    throw new ApplicationError("APPLICATION_REVOKED", "Application connection was revoked", 401);
  }
  if (connection.status === "expired" || (connection.validUntil && Date.parse(connection.validUntil) <= now)) {
    throw new ApplicationError("APPLICATION_EXPIRED", "Application connection expired", 401);
  }
}
