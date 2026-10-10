import { parentPort, workerData } from "node:worker_threads";
import { ApplicationClient, type ApplicationClientOptions } from "@mint-notes/application-client/node";
import { ApplicationError } from "@mint-notes/application-client";

const port = parentPort!;
const controllers = new Map<string, AbortController>();
let client: ApplicationClient;
try {
  client = await ApplicationClient.open(workerData as ApplicationClientOptions);
  workerData.applicationKey = "";
  port.postMessage({ ready: true });
  port.on("message", async (message: { id: string; tool?: string; args?: Record<string, unknown>; cancel?: boolean; stop?: boolean }) => {
    if (message.cancel) { controllers.get(message.id)?.abort(); return; }
    if (message.stop) {
      for (const controller of controllers.values()) controller.abort();
      await client.close(); port.close(); return;
    }
    const controller = new AbortController();
    controllers.set(message.id, controller);
    try {
      const result = await client.execute(message.tool!, message.args, controller.signal);
      port.postMessage({ id: message.id, result });
    } catch (error) {
      port.postMessage({ id: message.id, error: error instanceof ApplicationError ? error.code : "CLIENT_FAILED" });
    } finally { controllers.delete(message.id); }
  });
} catch {
  workerData.applicationKey = "";
  port.postMessage({ failed: true }); port.close();
}
