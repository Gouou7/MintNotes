import type { FastifyInstance, InjectOptions } from "fastify";

const sessions = new WeakMap<FastifyInstance, Map<string, string>>();

export async function browserInject(app: FastifyInstance, input: InjectOptions | string) {
  const options = typeof input === "string" ? { url: input } : input;
  const ids = sessions.get(app) ?? new Map<string, string>();
  sessions.set(app, ids);
  const headers = { "x-webmd-browser": "1", ...options.headers };
  const cookie = String(options.headers?.cookie ?? "");
  const token = cookie.match(/(?:^|;\s*)(?:__Host-)?webmd_session=([^;]+)/)?.[1];
  const context = token && ids.get(token);
  const response = await app.inject({
    ...options, headers: context ? { "x-webmd-session": context, ...headers } : headers
  });
  const cookies = response.headers["set-cookie"];
  const issued = (Array.isArray(cookies) ? cookies : [cookies ?? ""]).join("; ");
  const next = issued.match(/(?:^|;\s*)(?:__Host-)?webmd_session=([^;]+)/)?.[1];
  if (next && response.statusCode < 400) {
    const { sessionId } = response.json<{ sessionId?: string }>();
    if (sessionId) ids.set(next, sessionId);
  }
  return response;
}
