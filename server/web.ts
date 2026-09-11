import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const REVALIDATE = "public, max-age=0, must-revalidate";
const IMMUTABLE = "public, max-age=31536000, immutable";

export function staticCacheControl(filePath: string): string {
  return filePath.includes("/assets/") || filePath.includes("\\assets\\")
    ? IMMUTABLE
    : REVALIDATE;
}

function setStaticHeaders(reply: FastifyReply, filePath: string): void {
  reply.header("Cache-Control", staticCacheControl(filePath));
}

export async function registerWebRoutes(app: FastifyInstance, webRoot = resolve("dist")): Promise<void> {
  if (!existsSync(webRoot)) return;
  await app.register(fastifyStatic, {
    root: webRoot,
    wildcard: false,
    setHeaders: setStaticHeaders
  });
  app.get("/*", async (_request, reply) => reply.sendFile("index.html"));
}
