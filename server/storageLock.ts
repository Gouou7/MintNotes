import { mkdirSync, openSync, readFileSync, writeFileSync, closeSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** Shared by the service and offline maintenance; never infer safety from an idle WAL. */
export function acquireStorageLock(directory: string): () => void {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, ".mint-notes.lock");
  let fd: number;
  try { fd = openSync(path, "wx"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(readFileSync(path, "utf8"));
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("STORAGE_LOCK_INVALID");
    try { process.kill(pid, 0); throw new Error("STORAGE_IN_USE_STOP_SERVICE_FIRST"); }
    catch (probe) { if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe; }
    unlinkSync(path); fd = openSync(path, "wx");
  }
  writeFileSync(fd, String(process.pid)); closeSync(fd);
  return () => { if (readFileSync(path, "utf8") === String(process.pid)) unlinkSync(path); };
}
