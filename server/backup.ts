import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
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

const sha256 = await new Promise<string>((resolveHash, reject) => {
  const hash = createHash("sha256");
  const stream = createReadStream(destination);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("error", reject);
  stream.on("end", () => resolveHash(hash.digest("hex")));
});

console.log(JSON.stringify({ destination, sha256 }, null, 2));
