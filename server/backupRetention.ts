import { readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileDigest, verifyBackup } from "./backupStorage.js";

const namePattern = /^mint-notes-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.sqlite$/;
interface Manifest { version: 1; producer: "mint-notes-backup"; createdAt: string; sha256: string; }
export function markBackup(path: string, createdAt: string, sha256: string) {
  writeFileSync(`${path}.backup.json`, JSON.stringify({ version: 1, producer: "mint-notes-backup", createdAt, sha256 } satisfies Manifest) + "\n", { flag: "wx" });
}
function week(date: Date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7);
  return value.toISOString().slice(0, 10);
}
export function backupRetention(directory: string, options: { apply?: boolean; adopt?: boolean } = {}) {
  const root = resolve(directory);
  const managed: Array<{ path: string; createdAt: string; sha256: string }> = [];
  const unmanaged: string[] = [];
  for (const name of readdirSync(root)) {
    const match = namePattern.exec(name);
    if (!match) continue;
    const path = resolve(root, name);
    if (dirname(path) !== root) throw new Error("BACKUP_PATH_OUTSIDE_DIRECTORY");
    let manifest: Manifest | null = null;
    try { manifest = JSON.parse(readFileSync(`${path}.backup.json`, "utf8")) as Manifest; } catch { /* Legacy files require explicit adoption. */ }
    if (!manifest) {
      unmanaged.push(path);
      if (!options.adopt) continue;
      const timestamp = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
      if (!Number.isFinite(Date.parse(timestamp))) continue;
      const sha256 = verifyBackup(path);
      if (options.apply) markBackup(path, timestamp, sha256);
      manifest = { version: 1, producer: "mint-notes-backup", createdAt: timestamp, sha256 };
    }
    if (manifest.version !== 1 || manifest.producer !== "mint-notes-backup" || !Number.isFinite(Date.parse(manifest.createdAt)) || manifest.sha256 !== fileDigest(path)) continue;
    managed.push({ path, createdAt: manifest.createdAt, sha256: manifest.sha256 });
  }
  managed.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.path.localeCompare(a.path));
  const keep = new Set<string>();
  for (const [limit, bucket] of [[7, (s: string) => s.slice(0, 10)], [4, (s: string) => week(new Date(s))], [12, (s: string) => s.slice(0, 7)]] as const) {
    const buckets = new Set<string>();
    for (const item of managed) {
      const key = bucket(item.createdAt);
      if (buckets.has(key)) continue;
      if (buckets.size >= limit) break;
      buckets.add(key); keep.add(item.path);
    }
  }
  const remove = managed.filter((r) => !keep.has(r.path)).map((r) => r.path);
  if (options.apply) for (const path of remove) {
    // Recheck the manifest and digest immediately before removing only our own files.
    const manifest = JSON.parse(readFileSync(`${path}.backup.json`, "utf8")) as Manifest;
    if (manifest.sha256 !== fileDigest(path)) throw new Error("BACKUP_CHANGED_DURING_RETENTION");
    unlinkSync(path); unlinkSync(`${path}.backup.json`);
  }
  return { kept: [...keep], remove, unmanaged, applied: Boolean(options.apply) };
}
