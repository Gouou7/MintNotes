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

declare module "fastify" {
  interface FastifyRequest {
    sessionUser: SessionUser | null;
    sessionContext: SessionContext | null;
  }
}

export type AuthGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
