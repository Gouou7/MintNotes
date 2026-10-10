import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { WorkerController, ToolFailure } from "./worker-controller.js";
import { tools } from "./tools.js";

export default definePluginEntry({
  id: "mint-notes", name: "Mint Notes", description: "Read and write an encrypted Mint Notes vault with an independent application key",
  register(api) {
    let controller: WorkerController | null = null;
    let stateDir: string | null = null;
    let stopped = false;
    let runtimeConfig: Record<string, unknown> | null = null;
    const runtime = () => {
      if (api.registrationMode !== "full" || stopped || !stateDir) throw new ToolFailure("CLIENT_NOT_STARTED");
      if (controller) return controller;
      const config = runtimeConfig ?? {};
      if (typeof config.baseUrl !== "string" || typeof config.applicationKey !== "string") throw new ToolFailure("CONFIG_INVALID");
      controller = new WorkerController({ baseUrl: config.baseUrl, applicationKey: config.applicationKey, stateDir, offlineReads: config.offlineReads !== false });
      return controller;
    };
    for (const tool of tools) {
      api.registerTool({ ...tool, label: tool.name,
        async execute(_callId, parameters, signal) {
          try {
            const result = await runtime().execute(tool.name, parameters as Record<string, unknown>, signal);
            if (tool.name === "mint_notes_read_attachment") {
              const { data, ...details } = result as { data: ArrayBuffer; mime: string; [key: string]: unknown };
              return { content: [{ type: "text", text: JSON.stringify(details) }, { type: "image", data: Buffer.from(data).toString("base64"), mimeType: details.mime }], details };
            }
            return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
          } catch (error) {
            const code = error instanceof ToolFailure ? error.code : "CLIENT_FAILED";
            return { content: [{ type: "text", text: JSON.stringify({ error: code }) }], details: { error: code }, isError: true };
          }
        }
      }, { optional: true });
    }
    if (api.registrationMode === "full") api.registerService({
      id: "mint-notes-client", reload: { configPrefixes: ["plugins.entries.mint-notes"] },
      start(ctx) { stateDir = ctx.stateDir; runtimeConfig = ctx.config.plugins?.entries?.["mint-notes"]?.config ?? null; stopped = false; },
      async stop() { stopped = true; await controller?.stop(); controller = null; stateDir = null; runtimeConfig = null; }
    });
  }
});
