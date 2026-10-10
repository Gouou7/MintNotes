import { Worker } from "node:worker_threads";
import type { ApplicationClientOptions } from "@mint-notes/application-client/node";

export class ToolFailure extends Error { constructor(readonly code: string) { super(code); } }
/** One worker for one configured connection. Discovery creates no worker. */
export class WorkerController {
  private worker: Worker | null = null;
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  private ready: Promise<void> | null = null;
  private stopped = false;
  constructor(private options: ApplicationClientOptions) {}
  private start(): Promise<void> {
    if (this.stopped) return Promise.reject(new ToolFailure("CLIENT_STOPPED"));
    if (this.ready) return this.ready;
    const worker = this.worker = new Worker(new URL("./client-worker.js", import.meta.url), { workerData: this.options });
    this.ready = new Promise((resolve, reject) => {
      worker.on("message", (message) => {
        if (message.ready) { resolve(); return; }
        if (message.failed) { reject(new ToolFailure("CLIENT_START_FAILED")); return; }
        const waiting = this.pending.get(message.id);
        if (!waiting) return;
        this.pending.delete(message.id);
        if (message.error) waiting.reject(new ToolFailure(message.error)); else waiting.resolve(message.result);
      });
      const failed = () => {
        reject(new ToolFailure("CLIENT_STOPPED"));
        for (const task of this.pending.values()) task.reject(new ToolFailure("CLIENT_STOPPED"));
        this.pending.clear();
        if (this.worker === worker) { this.worker = null; this.ready = null; }
      };
      worker.on("error", failed); worker.on("exit", failed);
    });
    return this.ready;
  }
  async execute(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new ToolFailure("CANCELLED");
    await this.start();
    if (signal?.aborted || !this.worker) throw new ToolFailure("CANCELLED");
    const worker = this.worker;
    const id = crypto.randomUUID();
    const cancel = () => worker.postMessage({ id, cancel: true });
    const timeout = setTimeout(cancel, 120_000);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      return await new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject }); worker.postMessage({ id, tool, args });
      });
    } finally { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); }
  }
  async stop(): Promise<void> {
    this.stopped = true;
    this.options.applicationKey = "";
    const worker = this.worker;
    if (!worker) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { void worker.terminate().then(() => resolve()); }, 3000);
      worker.once("exit", () => { clearTimeout(timer); resolve(); });
      worker.postMessage({ stop: true });
    });
    this.worker = null; this.ready = null;
  }
}
