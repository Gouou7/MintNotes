import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { startMaintenanceJobs, type MaintenanceOperations } from "./maintenance";

describe("maintenance logging", () => {
  it("records successful and failed maintenance runs", () => {
    const records: Array<{ level: string; fields: Record<string, unknown>; message: string }> = [];
    const logger = Object.fromEntries(
      ["trace", "debug", "info", "warn", "error", "fatal", "silent"].map((level) => [
        level,
        (fields: Record<string, unknown>, message: string) => records.push({ level, fields, message })
      ])
    ) as unknown as FastifyBaseLogger;
    const operations: MaintenanceOperations = {
      purgeTrash: vi.fn(() => 2),
      cleanupHistory: vi.fn(() => {
        throw new Error("controlled maintenance failure");
      }),
      cleanupEndpoints: vi.fn(() => 0),
      cleanupAttachments: vi.fn(() => 3)
    };
    const controller = startMaintenanceJobs(
      {} as never,
      { publish: vi.fn() } as never,
      logger,
      operations
    );

    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: "info",
        fields: expect.objectContaining({ event: "maintenance.completed", job: "trash", affected: 2 })
      }),
      expect.objectContaining({
        level: "error",
        fields: expect.objectContaining({
          event: "maintenance.failed",
          job: "history",
          errorType: "Error",
          errorMessage: "controlled maintenance failure"
        })
      }),
      expect.objectContaining({
        level: "debug",
        fields: expect.objectContaining({ event: "maintenance.completed", job: "endpoints", affected: 0 })
      })
    ]));
    controller.stop();
  });
});
