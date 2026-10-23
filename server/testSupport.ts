import { createApp as createProductionApp, type ServerDependencies } from "./app.js";
import { issueSyncLease } from "./sync/protocol.js";
import { hashToken } from "./security.js";

/** Upgrade legacy fixture calls to v2; protocol enforcement has dedicated raw tests. */
export async function createApp(options: ServerDependencies = {}) {
  const app = await createProductionApp(options);
  const inject = app.inject.bind(app);
  app.inject = ((input: any, callback?: any) => {
    if (typeof input === "string" || callback) return inject(input, callback);
    const headers = { "x-webmd-protocol": "2", ...input.headers } as Record<string, string>;
    const db = options.db;
    if (db && !headers["x-webmd-sync-lease"]) {
      const cookie = /(?:^|;\s*)(?:__Host-)?webmd_session=([^;]+)/.exec(headers.cookie ?? headers.Cookie ?? "");
      const bearer = /^Bearer ([0-9a-f-]{36})\./.exec(headers.authorization ?? headers.Authorization ?? "");
      const row = cookie ? db.prepare("SELECT user_id FROM sessions WHERE token_hash = ?").get(hashToken(cookie[1]))
        : bearer ? db.prepare("SELECT user_id FROM application_connections WHERE connection_id = ?").get(bearer[1]) : undefined;
      if (row) headers["x-webmd-sync-lease"] = issueSyncLease(db, (row as { user_id: string }).user_id);
    }
    return inject({ ...input, headers });
  }) as typeof app.inject;
  return app;
}
