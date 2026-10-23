import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { backupRetention } from "./backupRetention.js";
import { verifyBackup, migrationBackup } from "./backupStorage.js";
import { acquireStorageLock } from "./storageLock.js";

const args = process.argv.slice(2);
const command = args[0];
const value = (flag: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const directory = resolve(value("--data-dir") ?? (process.env.NODE_ENV === "production" ? "/data" : "./data"));
const apply = args.includes("--apply");
if (command === "backup-retention") {
  console.log(JSON.stringify(backupRetention(resolve(value("--backup-dir") ?? process.env.BACKUP_DIR ?? join(directory, "backups")), { apply, adopt: args.includes("--adopt") }), null, 2));
} else if (["compact", "rotate-epoch", "restore"].includes(command)) {
  if (!apply) {
    console.log(JSON.stringify({ command, directory, source: value("--source"), apply: false, requires: "Stop the service, verify a backup, then pass --apply" }));
  } else {
    const release = acquireStorageLock(directory);
    let database: Database.Database | null = null;
    try {
      const path = join(directory, "notes.sqlite");
      if (command === "restore") {
        const input = value("--source");
        if (!input) throw new Error("RESTORE_SOURCE_REQUIRED");
        const source = resolve(input);
        if (source === path) throw new Error("RESTORE_SOURCE_MUST_BE_BACKUP");
        const sha256 = verifyBackup(source);
        const staging = join(directory, `.restore-${randomUUID()}.sqlite`);
        const original = new Database(source, { readonly: true, fileMustExist: true });
        try { await original.backup(staging); } finally { original.close(); }
        database = new Database(staging);
        const version = Number(database.pragma("user_version", { simple: true }));
        if (version !== 2 && version !== 3) throw new Error("RESTORE_SCHEMA_UNSUPPORTED");
        if (version === 3) {
          database.prepare("UPDATE sync_state SET epoch = lower(hex(randomblob(16))), lease_secret = lower(hex(randomblob(32)))").run();
        } // v2 restores are migrated on next startup, which initializes a new epoch.
        database.close(); database = null;
        verifyBackup(staging);
        let displaced: string | null = null;
        if (existsSync(path)) {
          database = new Database(path, { fileMustExist: true });
          migrationBackup(database, join(directory, "backups", `pre-restore-${Date.now()}.sqlite`));
          database.pragma("wal_checkpoint(TRUNCATE)"); database.close(); database = null;
          displaced = join(directory, `.before-restore-${randomUUID()}.sqlite`);
          renameSync(path, displaced);
        }
        try { renameSync(staging, path); }
        catch (error) { if (displaced && !existsSync(path)) renameSync(displaced, path); throw error; }
        console.log(JSON.stringify({ restored: true, sha256, epochRotated: true }));
      } else {
        database = new Database(path, { fileMustExist: true });
        migrationBackup(database, join(directory, "backups", `pre-${command}-${Date.now()}.sqlite`));
        if (command === "compact") {
          database.pragma("wal_checkpoint(TRUNCATE)"); database.exec("VACUUM");
          if (database.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("COMPACT_INTEGRITY_FAILED");
        } else database.prepare("UPDATE sync_state SET epoch = lower(hex(randomblob(16))), lease_secret = lower(hex(randomblob(32)))").run();
        console.log(JSON.stringify({ command, complete: true }));
      }
    } finally { database?.close(); release(); }
  }
} else throw new Error("Use compact, rotate-epoch, restore or backup-retention");
