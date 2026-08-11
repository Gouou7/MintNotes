import type { FastifyInstance } from "fastify";
import { createApp } from "./app.js";
import { loadServerConfig } from "./config.js";
import { logEvent, safeError } from "./logging.js";

let app: FastifyInstance | undefined;
let shuttingDown = false;

function writeStartupFallback(error: unknown): void {
  process.stdout.write(`${JSON.stringify({
    level: "fatal",
    event: "server.fatal",
    source: "startup",
    ...safeError(error),
    message: "server fatal error"
  })}\n`);
}

async function shutdown(signal: "SIGINT" | "SIGTERM" | "fatal", exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  if (!app) return;
  logEvent(app.log, "info", "server.stopping", { signal });
  try {
    await app.close();
    logEvent(app.log, "info", "server.stopped", { signal });
  } catch (error) {
    logEvent(app.log, "fatal", "server.fatal", {
      source: "uncaughtException",
      ...safeError(error)
    });
    process.exitCode = 1;
  }
}

try {
  const config = loadServerConfig();
  app = await createApp({ config });

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("uncaughtException", (error) => {
    logEvent(app!.log, "fatal", "server.fatal", {
      source: "uncaughtException",
      ...safeError(error)
    });
    void shutdown("fatal", 1);
  });
  process.once("unhandledRejection", (error) => {
    logEvent(app!.log, "fatal", "server.fatal", {
      source: "unhandledRejection",
      ...safeError(error)
    });
    void shutdown("fatal", 1);
  });

  await app.listen({ host: config.host, port: config.port });
  logEvent(app.log, "info", "server.started", {
    host: config.host,
    port: config.port,
    mode: config.production ? "production" : "development",
    logLevel: config.logLevel
  });
} catch (error) {
  if (app) {
    logEvent(app.log, "fatal", "server.fatal", { source: "startup", ...safeError(error) });
    await shutdown("fatal", 1);
  } else {
    writeStartupFallback(error);
    process.exitCode = 1;
  }
}
