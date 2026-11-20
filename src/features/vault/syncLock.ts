/** Browser-owned locks are released on process exit and never delay local saves. */
export async function withVaultSyncLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(`webmd-vault-sync:${userId}`, operation);
  }
  return operation();
}
