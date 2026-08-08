import type { FastifyBaseLogger } from "fastify";
import type { AppDatabase } from "./database.js";
import { cleanupAllHistory } from "./history.js";
import { SyncEventHub } from "./syncEvents.js";
import { purgeExpiredTrash } from "./trash.js";
import { cleanupInactiveEndpoints } from "./account/endpoints.js";

export interface MaintenanceController {
  stop: () => void;
}

export function startMaintenanceJobs(
  db: AppDatabase,
  syncEvents: SyncEventHub,
  logger: FastifyBaseLogger
): MaintenanceController {
  purgeExpiredTrash(db);
  cleanupAllHistory(db);
  cleanupInactiveEndpoints(db);
  const trashCleanupTimer = setInterval(() => {
    try {
      const purged = purgeExpiredTrash(db, new Date().toISOString(), (changes) => {
        const latestByUser = new Map<string, number>();
        for (const change of changes) {
          latestByUser.set(change.userId, Math.max(latestByUser.get(change.userId) ?? 0, change.cursor));
        }
        for (const [userId, cursor] of latestByUser) syncEvents.publish(userId, cursor);
      });
      if (purged) logger.info({ purged }, "expired trash purged");
    } catch (error) {
      logger.error(error, "trash retention cleanup failed");
    }
  }, 60 * 60 * 1000);
  trashCleanupTimer.unref();

  const historyCleanupTimer = setInterval(() => {
    try {
      const deleted = cleanupAllHistory(db);
      if (deleted) logger.info({ deleted }, "expired note history cleaned");
    } catch (error) {
      logger.error(error, "note history cleanup failed");
    }
  }, 60 * 60 * 1000);
  historyCleanupTimer.unref();

  const endpointCleanupTimer = setInterval(() => {
    try {
      const deleted = cleanupInactiveEndpoints(db);
      if (deleted) logger.info({ deleted }, "inactive login devices cleaned");
    } catch (error) {
      logger.error(error, "inactive login device cleanup failed");
    }
  }, 60 * 60 * 1000);
  endpointCleanupTimer.unref();

  return {
    stop: () => {
      clearInterval(trashCleanupTimer);
      clearInterval(historyCleanupTimer);
      clearInterval(endpointCleanupTimer);
    }
  };
}
