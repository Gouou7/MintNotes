import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppDatabase } from "../database.js";
import { SYNC_LIFETIME_MS, syncState } from "./lifecycle.js";

export function issueSyncLease(db: AppDatabase, userId: string): string {
  const state = syncState(db, userId);
  const row = db.prepare("SELECT lease_secret FROM sync_state WHERE user_id = ?").get(userId) as { lease_secret: string };
  const data = Buffer.from(JSON.stringify([state.epoch, Date.now()])).toString("base64url");
  return `${data}.${createHmac("sha256", row.lease_secret).update(userId).update(data).digest("base64url")}`;
}
export function validSyncLease(db: AppDatabase, userId: string, lease: unknown): boolean {
  if (typeof lease !== "string" || lease.length > 500) return false;
  try {
    const [data, signature] = lease.split(".");
    const [epoch, issued] = JSON.parse(Buffer.from(data, "base64url").toString());
    const row = db.prepare("SELECT epoch, lease_secret FROM sync_state WHERE user_id = ?").get(userId) as { epoch: string; lease_secret: string } | undefined;
    if (!row || row.epoch !== epoch || !Number.isSafeInteger(issued) || issued > Date.now() + 300_000 || issued <= Date.now() - SYNC_LIFETIME_MS) return false;
    const expected = createHmac("sha256", row.lease_secret).update(userId).update(data).digest();
    const actual = Buffer.from(signature, "base64url");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}
export function registerProtocolGate(app: FastifyInstance) {
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (path.startsWith("/api/apps/v1/")) return reply.code(426).send({ error: "Client upgrade required", code: "PROTOCOL_UPGRADE_REQUIRED", protocolVersion: 2 });
    if (/^\/api\/(?:sync(?:\/|$)|objects(?:\/|$)|attachments(?:\/|$)|notes\/)/.test(path)
      && request.headers["x-webmd-protocol"] !== "2"
      && !(path === "/api/sync/events" && new URL(request.url, "http://localhost").searchParams.get("protocol") === "2")) {
      return reply.code(426).send({ error: "Client upgrade required", code: "PROTOCOL_UPGRADE_REQUIRED", protocolVersion: 2 });
    }
  });
}
