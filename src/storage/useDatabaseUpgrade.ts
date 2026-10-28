import { useEffect, useState } from "react";
import { localDb } from "./database";

export function useDatabaseUpgrade() {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const waiting = () => setBlocked(true);
    const ready = () => setBlocked(false);
    localDb.on("blocked", waiting); localDb.on("ready", ready);
    return () => { localDb.on("blocked").unsubscribe(waiting); localDb.on("ready").unsubscribe(ready); };
  }, []);
  return blocked;
}
