import type { FastifyReply, FastifyRequest } from "fastify";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
}

export interface SessionContext {
  id: string;
  endpointId: string;
  endpointFirstSeenAt: string;
  remembered: boolean;
  createdAt: string;
  lastSeenAt: string;
}

declare const authenticatedScopeBrand: unique symbol;

export interface AuthenticatedScope {
  readonly userId: string;
  readonly sessionId: string;
  readonly endpointId: string;
  readonly [authenticatedScopeBrand]: true;
}

export function authenticatedScope(request: FastifyRequest): AuthenticatedScope {
  if (!request.sessionUser || !request.sessionContext) {
    throw new Error("Authenticated scope requested before authentication");
  }
  return {
    userId: request.sessionUser.id,
    sessionId: request.sessionContext.id,
    endpointId: request.sessionContext.endpointId
  } as AuthenticatedScope;
}

declare module "fastify" {
  interface FastifyRequest {
    sessionUser: SessionUser | null;
    sessionContext: SessionContext | null;
  }
}

export type AuthGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
