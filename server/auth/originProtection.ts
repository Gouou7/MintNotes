import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../config.js";
import { logEvent } from "../logging.js";

export function registerOriginProtection(
  app: FastifyInstance,
  config: Pick<ServerConfig, "production" | "appOrigin">
): void {
  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && !request.routeOptions.config.applicationAuth) return;
    const origin = request.headers.origin;
    if (!origin) {
      // Only explicitly registered application routes have this flag. They
      // independently authenticate Bearer credentials and never use Cookies.
      if (request.routeOptions.config.applicationAuth) return;
      if (config.production || config.appOrigin) {
        logEvent(request.log, "warn", "security.origin_rejected", { reason: "missing" });
        return reply.code(403).send({ error: "Origin header required for state change" });
      }
      return;
    }
    // Keep the original Host (including its port). The controlled proxy must
    // preserve it and overwrite forwarded headers before reaching the app.
    const allowed = config.appOrigin ?? `${request.protocol}://${request.headers.host}`;
    const insecureAutomaticOrigin = !config.appOrigin && config.production && request.protocol !== "https";
    if (insecureAutomaticOrigin || origin !== allowed) {
      logEvent(request.log, "warn", "security.origin_rejected", { reason: "mismatch" });
      return reply.code(403).send({ error: "Cross-origin state change rejected" });
    }
  });
}
