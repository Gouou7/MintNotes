import type { FastifyBaseLogger } from "fastify";
import type { AppDatabase } from "./database.js";
import { cleanupAllHistory } from "./history.js";
import { SyncEventHub } from "./syncEvents.js";
import { purgeExpiredTrash } from "./trash.js";
import { cleanupInactiveEndpoints } from "./account/endpoints.js";
import { cleanupOrphanAttachmentChunks } from "./attachments/cleanup.js";
import { logEvent, safeError } from "./logging.js";

export interface MaintenanceController {
  stop: () => void;
}

export interface MaintenanceOperations {
  purgeTrash: typeof purgeExpiredTrash;
  cleanupHistory: typeof cleanupAllHistory;
  cleanupEndpoints: typeof cleanupInactiveEndpoints;
  cleanupAttachments: typeof cleanupOrphanAttachmentChunks;
}

const DEFAULT_OPERATIONS: MaintenanceOperations = {
  purgeTrash: purgeExpiredTrash,
  cleanupHistory: cleanupAllHistory,
  cleanupEndpoints: cleanupInactiveEndpoints,
  cleanupAttachments: cleanupOrphanAttachmentChunks
};

export function startMaintenanceJobs(
  db: AppDatabase,
  syncEvents: SyncEventHub,
  logger: FastifyBaseLogger,
  operations: MaintenanceOperations = DEFAULT_OPERATIONS
): MaintenanceController {
  const runTrashCleanup = () => {
    try {
      const purged = operations.purgeTrash(db, new Date().toISOString(), (changes) => {
        const latestByUser = new Map<string, number>();
        for (const change of changes) {
          latestByUser.set(change.userId, Math.max(latestByUser.get(change.userId) ?? 0, change.cursor));
        }
        for (const [userId, cursor] of latestByUser) syncEvents.publish(userId, cursor);
      });
      logEvent(logger, purged ? "info" : "debug", "maintenance.completed", {
        job: "trash",
        affected: purged
      });
    } catch (error) {
      logEvent(logger, "error", "maintenance.failed", { job: "trash", ...safeError(error) });
    }
  };

  const runHistoryCleanup = () => {
    try {
      const deleted = operations.cleanupHistory(db);
      logEvent(logger, deleted ? "info" : "debug", "maintenance.completed", {
        job: "history",
        affected: deleted
      });
    } catch (error) {
      logEvent(logger, "error", "maintenance.failed", { job: "history", ...safeError(error) });
    }
  };

  const runEndpointCleanup = () => {
    try {
      const deleted = operations.cleanupEndpoints(db);
      logEvent(logger, deleted ? "info" : "debug", "maintenance.completed", {
        job: "endpoints",
        affected: deleted
      });
    } catch (error) {
      logEvent(logger, "error", "maintenance.failed", { job: "endpoints", ...safeError(error) });
    }
  };

  const runAttachmentCleanup = () => {
    try {
      const deleted = operations.cleanupAttachments(db);
      logEvent(logger, deleted ? "info" : "debug", "maintenance.completed", {
        job: "attachments",
        affected: deleted
      });
    } catch (error) {
      logEvent(logger, "error", "maintenance.failed", { job: "attachments", ...safeError(error) });
    }
  };

  runTrashCleanup();
  runHistoryCleanup();
  runEndpointCleanup();
  runAttachmentCleanup();

  const trashCleanupTimer = setInterval(runTrashCleanup, 60 * 60 * 1000);
  const historyCleanupTimer = setInterval(runHistoryCleanup, 60 * 60 * 1000);
  const endpointCleanupTimer = setInterval(runEndpointCleanup, 60 * 60 * 1000);
  const attachmentCleanupTimer = setInterval(runAttachmentCleanup, 60 * 60 * 1000);
  trashCleanupTimer.unref();
  historyCleanupTimer.unref();
  endpointCleanupTimer.unref();
  attachmentCleanupTimer.unref();

  return {
    stop: () => {
      clearInterval(trashCleanupTimer);
      clearInterval(historyCleanupTimer);
      clearInterval(endpointCleanupTimer);
      clearInterval(attachmentCleanupTimer);
    }
  };
}
