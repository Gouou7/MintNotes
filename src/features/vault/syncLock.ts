/** Browser-owned locks are released on process exit and never delay local saves. */
export async function withVaultSyncLock(userId: string, operation: () => Promise<void>): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    await navigator.locks.request(`webmd-vault-sync:${userId}`, operation);
  } else {
    await operation();
  }
}
