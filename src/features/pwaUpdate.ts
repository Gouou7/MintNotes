const UPDATE_PROMPT_RECORD_KEY = "webmd-pwa-update-prompt";
export const UPDATE_PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface UpdatePromptRecord {
  fingerprint: string;
  promptedAt: number;
}

interface UpdatePromptOptions {
  message: string | (() => string);
  applyUpdate: () => Promise<void>;
  confirmUpdate?: (message: string) => boolean;
  fingerprint?: () => Promise<string | null>;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  now?: () => number;
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readPromptRecord(storage: Pick<Storage, "getItem">): UpdatePromptRecord | null {
  try {
    const parsed = JSON.parse(storage.getItem(UPDATE_PROMPT_RECORD_KEY) ?? "null") as Partial<UpdatePromptRecord> | null;
    if (
      parsed
      && typeof parsed.fingerprint === "string"
      && typeof parsed.promptedAt === "number"
      && Number.isFinite(parsed.promptedAt)
    ) {
      return { fingerprint: parsed.fingerprint, promptedAt: parsed.promptedAt };
    }
  } catch {
    // A malformed or unavailable preference must not block an application update.
  }
  return null;
}

function writePromptRecord(
  storage: Pick<Storage, "setItem">,
  record: UpdatePromptRecord
): void {
  try {
    storage.setItem(UPDATE_PROMPT_RECORD_KEY, JSON.stringify(record));
  } catch {
    // Storage can be unavailable in restricted browsing modes.
  }
}

export async function deployedServiceWorkerFingerprint(): Promise<string | null> {
  try {
    const response = await fetch("/sw.js", {
      cache: "no-store",
      credentials: "same-origin"
    });
    if (!response.ok) return null;
    const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

export function createPwaUpdatePrompt({
  message,
  applyUpdate,
  confirmUpdate = window.confirm.bind(window),
  fingerprint = deployedServiceWorkerFingerprint,
  storage = browserStorage(),
  now = Date.now
}: UpdatePromptOptions): () => Promise<void> {
  let handling = false;
  let promptedWithoutRecord = false;

  return async () => {
    if (handling) return;
    handling = true;
    try {
      const currentFingerprint = await fingerprint();
      if (currentFingerprint) {
        const prior = storage ? readPromptRecord(storage) : null;
        if (
          prior?.fingerprint === currentFingerprint
          && now() - prior.promptedAt < UPDATE_PROMPT_COOLDOWN_MS
        ) return;
        if (storage) {
          writePromptRecord(storage, {
            fingerprint: currentFingerprint,
            promptedAt: now()
          });
        } else if (promptedWithoutRecord) {
          return;
        } else {
          promptedWithoutRecord = true;
        }
      } else if (promptedWithoutRecord) {
        return;
      } else {
        promptedWithoutRecord = true;
      }

      if (confirmUpdate(typeof message === "function" ? message() : message)) await applyUpdate();
    } finally {
      handling = false;
    }
  };
}
