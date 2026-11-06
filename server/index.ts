import type { FastifyInstance } from "fastify";
import { createBootLogger } from "./logging.js";

const boot = createBootLogger();
let app: FastifyInstance | undefined;
let shuttingDown = false;

async function shutdown(signal: "SIGINT" | "SIGTERM" | "fatal", exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  if (!app) return;
  boot.stopping(signal);
  try {
    await app.close();
    boot.stopped(signal);
  } catch (error) {
    boot.fatal("shutdown", error);
    process.exitCode = 1;
  }
}

boot.starting();
try {
  const { loadServerConfig } = await import("./config.js");
  boot.step({ phase: "config" });
  const config = loadServerConfig();
  boot.step({ phase: "module_load" });
  const { createApp } = await import("./app.js");
  app = await createApp({ config, bootId: boot.bootId, reportStartup: boot.step });

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("uncaughtException", (error) => {
    boot.fatal("uncaughtException", error);
    void shutdown("fatal", 1);
  });
  process.once("unhandledRejection", (error) => {
    boot.fatal("unhandledRejection", error);
    void shutdown("fatal", 1);
  });

  boot.step({ phase: "http_listen" });
  await app.listen({ host: config.host, port: config.port, listenTextResolver: () => "HTTP socket bound" });
  boot.started(config.port, config.production);
} catch (error) {
  boot.fatal("startup", error);
  await shutdown("fatal", 1);
}
