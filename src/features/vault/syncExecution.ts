import type { SyncIntent } from "../syncCoordinator";

interface SyncExecutionDependencies {
  isActive: () => boolean;
  countPending: () => Promise<number>;
  push: () => Promise<void>;
  pull: () => Promise<Set<string>>;
}

/** Every wake-up drains durable writes, including failed uploads after editing stops. */
export async function executeVaultSync(dependencies: SyncExecutionDependencies, intent: SyncIntent) {
  const failedObjectIds = new Set<string>();
  if (!dependencies.isActive()) return { failedObjectIds, pending: 0 };
  if ((intent.push || intent.pull) && await dependencies.countPending()) await dependencies.push();
  if (dependencies.isActive() && intent.pull) {
    for (const id of await dependencies.pull()) failedObjectIds.add(id);
  }
  return { failedObjectIds, pending: dependencies.isActive() ? await dependencies.countPending() : 0 };
}
