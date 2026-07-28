import { createRouteApplication, type RouteApplicationOptions } from "./routes.js";

export type ServerDependencies = RouteApplicationOptions;

export function createApp(dependencies: ServerDependencies = {}) {
  return createRouteApplication(dependencies);
}
