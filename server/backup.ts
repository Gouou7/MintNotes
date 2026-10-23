import Database from "better-sqlite3";
import { verifyBackup } from "./backupStorage.js";
import { backupRetention, markBackup } from "./backupRetention.js";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const dataDirectory = resolve(process.env.NODE_ENV === "production" ? "/data" : "./data");
const source = join(dataDirectory, "notes.sqlite");
const backupDirectory = resolve(process.env.BACKUP_DIR ?? join(dataDirectory, "backups"));

if (!existsSync(source)) {
  throw new Error(`SQLite database does not exist: ${source}`);
}

mkdirSync(backupDirectory, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = join(backupDirectory, `mint-notes-${timestamp}.sqlite`);
const database = new Database(source, { readonly: true, fileMustExist: true });

try {
  await database.backup(destination);
} finally {
  database.close();
}

const sha256 = verifyBackup(destination);
markBackup(destination, new Date().toISOString(), sha256);
const retention = backupRetention(backupDirectory, { apply: true });
console.log(JSON.stringify({ destination, sha256, retention }, null, 2));
