import type { SyncIntent } from "../syncCoordinator";

interface SyncExecutionDependencies {
  isActive: () => boolean;
  countPending: () => Promise<number>;
  prepare?: () => Promise<boolean>;
  push: () => Promise<void>;
  pull: () => Promise<{ failedObjectIds: Set<string>; complete: boolean }>;
}

/** Every wake-up drains durable writes, including failed uploads after editing stops. */
export async function executeVaultSync(dependencies: SyncExecutionDependencies, intent: SyncIntent) {
  let pull = { failedObjectIds: new Set<string>(), complete: false };
  if (!dependencies.isActive()) return { ...pull, pending: 0 };
  if (dependencies.prepare && !await dependencies.prepare()) throw new Error("SYNC_RECONCILIATION_INCOMPLETE");
  if ((intent.push || intent.pull) && await dependencies.countPending()) await dependencies.push();
  if (dependencies.isActive() && intent.pull) {
    pull = await dependencies.pull();
  }
  return { ...pull, pending: dependencies.isActive() ? await dependencies.countPending() : 0 };
}
