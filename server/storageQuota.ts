import { z } from "zod";
import type { AppDatabase } from "./database.js";
import type { ServerConfig } from "./config.js";
import { storageUsage } from "./storageUsage.js";
import { reclaimHistorySpace } from "./history.js";

export const capacityBytes = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  .refine((value) => value % (1024 * 1024) === 0, "Use whole MiB");
export const quotaSetting = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("inherit"), bytes: z.null().optional() }),
  z.object({ mode: z.literal("limited"), bytes: capacityBytes }),
  z.object({ mode: z.literal("unlimited"), bytes: z.null().optional() })
]);
export type QuotaSetting = z.infer<typeof quotaSetting>;
export class StorageQuotaError extends Error {
  readonly statusCode = 413;
  constructor(message = "User storage quota exceeded", public code = "CONTENT_QUOTA_EXCEEDED") { super(message); }
}
export function userQuotas(db: AppDatabase, userId: string, defaults: Pick<ServerConfig, "userStorageQuotaBytes" | "userHistoryQuotaBytes">) {
  const row = db.prepare("SELECT storage_quota_mode, storage_quota_bytes, history_quota_mode, history_quota_bytes FROM users WHERE id = ?").get(userId) as {
    storage_quota_mode: "inherit" | "limited" | "unlimited"; storage_quota_bytes: number | null;
    history_quota_mode: "inherit" | "limited" | "unlimited"; history_quota_bytes: number | null;
  } | undefined;
  const quotaMode = row?.storage_quota_mode ?? "inherit";
  const historyQuotaMode = row?.history_quota_mode ?? "inherit";
  return { quotaMode, historyQuotaMode,
    quotaBytes: quotaMode === "unlimited" ? null : quotaMode === "limited" ? row!.storage_quota_bytes! : defaults.userStorageQuotaBytes,
    historyQuotaBytes: historyQuotaMode === "unlimited" ? null : historyQuotaMode === "limited" ? row!.history_quota_bytes! : defaults.userHistoryQuotaBytes };
}
export function quotaState(totalBytes: number, quotaBytes: number | null) {
  return quotaBytes === null ? "unlimited" : totalBytes >= quotaBytes ? "full" : totalBytes >= quotaBytes * .95 ? "critical" : totalBytes >= quotaBytes * .8 ? "warning" : "normal";
}
export function assertStorageGrowth(db: AppDatabase, userId: string, growth: number, defaultQuota: number) {
  const { quotaBytes } = userQuotas(db, userId, { userStorageQuotaBytes: defaultQuota, userHistoryQuotaBytes: 0 });
  if (growth > 0 && quotaBytes !== null && storageUsage(db, userId).totalBytes + growth > quotaBytes) throw new StorageQuotaError();
}
/** Caller owns the write transaction: failed admission rolls back history reclamation too. */
export function admitHistoryGrowth(db: AppDatabase, userId: string, growth: number, config: ServerConfig, excludeHistoryId?: string) {
  if (growth <= 0) return;
  const budget = userQuotas(db, userId, config).historyQuotaBytes;
  if (budget !== null && !reclaimHistorySpace(db, userId, growth, budget, excludeHistoryId)) {
    throw new StorageQuotaError("Note history quota exceeded", "HISTORY_QUOTA_EXCEEDED");
  }
  assertStorageGrowth(db, userId, growth, config.userStorageQuotaBytes);
}
