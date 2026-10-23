/** Transport lifetime is independent of the encrypted object/AAD versions. */
export const SYNC_LIFETIME_MS = 90 * 86_400_000;
export function operationId(now = Date.now()): string {
  return `v2.${now}.${crypto.randomUUID()}`;
}
export function operationTime(value: string): number | null {
  const match = /^v2\.(\d{13})\.([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(value);
  return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null;
}
export function operationExpired(value: string, now = Date.now()): boolean {
  const created = operationTime(value);
  return created === null || created > now + 300_000 || created <= now - SYNC_LIFETIME_MS;
}
