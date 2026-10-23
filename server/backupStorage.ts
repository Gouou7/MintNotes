import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { openSync, closeSync, readSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AppDatabase } from "./database.js";

export function fileDigest(path: string): string {
  const fd = openSync(path, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(1024 * 1024);
  try { for (;;) { const size = readSync(fd, buffer); if (!size) break; hash.update(buffer.subarray(0, size)); } }
  finally { closeSync(fd); }
  return hash.digest("hex");
}
export function verifyBackup(path: string): string {
  const copy = new Database(path, { readonly: true, fileMustExist: true });
  try {
    if (copy.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("BACKUP_INTEGRITY_FAILED");
  } finally { copy.close(); }
  return fileDigest(path);
}
/** SQLite creates a consistent online snapshot, including committed WAL pages. */
export function migrationBackup(db: AppDatabase, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  db.prepare("VACUUM INTO ?").run(destination);
  const sha256 = verifyBackup(destination);
  writeFileSync(`${destination}.sha256`, `${sha256}\n`, { flag: "wx" });
}
