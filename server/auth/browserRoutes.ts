import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { logEvent, type LogReferenceFactory } from "../logging.js";
import type { SessionUser } from "../types.js";
import type { createSessionService } from "./sessionService.js";

export function registerBrowserSessionRoutes(
  app: FastifyInstance, service: ReturnType<typeof createSessionService>, logRefs: LogReferenceFactory
) {
  const { authenticate, revokeEndpoint, enroll, resume, close, revokeBrowserGrant, endpointSummary } = service;

  app.post("/api/auth/logout", { preHandler: authenticate }, async (request, reply) => {
    const user = request.sessionUser as SessionUser;
    const endpointId = request.sessionContext!.endpointId;
    const expected = z.object({ endpointId: z.string().uuid() }).optional().safeParse(request.body);
    if (!expected.success || (expected.data && expected.data.endpointId !== endpointId)) return reply.code(409).send({ error: "Logout endpoint mismatch" });
    revokeEndpoint(user.id, endpointId);
    logEvent(request.log, "info", "auth.logged_out", {
      actorRef: logRefs.create("user", user.id),
      endpointRef: logRefs.create("endpoint", endpointId)
    });
    return { ok: true, endpointId };
  });

  const secretField = z.string().min(20).max(1024);
  const grantFields = { id: z.string().uuid(), secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/) };
  const deviceRate = { rateLimit: { max: 30, timeWindow: "1 minute" } };
  app.put("/api/auth/device-grant", { preHandler: authenticate, config: deviceRate }, async (request, reply) => {
    const input = z.object({ ...grantFields, authSecret: secretField }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: "Invalid device grant" });
    if (!enroll(request, input.data)) return reply.code(401).send({ error: "Device verification required" });
    return { id: input.data.id };
  });
  app.post("/api/auth/session/resume", { config: deviceRate }, async (request, reply) => {
    const input = z.object(grantFields).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: "Invalid device grant" });
    const session = resume(request, reply, input.data.id, input.data.secret);
    return session ?? reply.code(401).send({ error: "Device verification required", code: "DEVICE_REAUTH_REQUIRED" });
  });
  app.post("/api/auth/session/close", { preHandler: authenticate }, async (request) => {
    close(request.sessionContext!.id);
    return { ok: true };
  });
  app.post("/api/auth/device-grant/revoke", { config: deviceRate }, async (request, reply) => {
    const input = z.object({
      endpointId: z.string().uuid(), grantId: z.string().uuid().optional(), sessionId: z.string().uuid().optional()
    }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: "Invalid device grant" });
    if (!revokeBrowserGrant(request, input.data)) {
      return reply.code(404).send({ error: "Device authorization unavailable" });
    }
    return input.data;
  });

  app.get("/api/auth/me", { preHandler: authenticate }, async (request) => ({
    user: request.sessionUser,
    sessionId: request.sessionContext!.id,
    expiresAt: request.sessionContext!.expiresAt,
    endpoint: endpointSummary(request.sessionContext!.endpointId, request.sessionContext!.remembered)
  }));
}
