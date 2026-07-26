import { describe, expect, it, vi } from "vitest";
import { createPwaUpdatePrompt, UPDATE_PROMPT_COOLDOWN_MS } from "./pwaUpdate";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }
  };
}

describe("PWA update prompting", () => {
  it("prompts only once for duplicate lifecycle callbacks", async () => {
    const confirmUpdate = vi.fn(() => false);
    let releaseFingerprint!: (value: string) => void;
    const fingerprint = vi.fn(() => new Promise<string>((resolve) => {
      releaseFingerprint = resolve;
    }));
    const prompt = createPwaUpdatePrompt({
      message: "update",
      applyUpdate: vi.fn(async () => undefined),
      confirmUpdate,
      fingerprint,
      storage: memoryStorage()
    });

    const first = prompt();
    const duplicate = prompt();
    releaseFingerprint("build-a");
    await Promise.all([first, duplicate]);

    expect(fingerprint).toHaveBeenCalledTimes(1);
    expect(confirmUpdate).toHaveBeenCalledTimes(1);
  });

  it("suppresses the same deployed version during the cooldown", async () => {
    const confirmUpdate = vi.fn(() => false);
    const storage = memoryStorage();
    const now = vi.fn(() => 1_000);
    const options = {
      message: "update",
      applyUpdate: vi.fn(async () => undefined),
      confirmUpdate,
      fingerprint: vi.fn(async () => "build-a"),
      storage,
      now
    };

    await createPwaUpdatePrompt(options)();
    now.mockReturnValue(1_000 + UPDATE_PROMPT_COOLDOWN_MS - 1);
    await createPwaUpdatePrompt(options)();

    expect(confirmUpdate).toHaveBeenCalledTimes(1);
  });

  it("prompts immediately when the deployed version changes", async () => {
    const confirmUpdate = vi.fn(() => false);
    const storage = memoryStorage();

    await createPwaUpdatePrompt({
      message: "update",
      applyUpdate: vi.fn(async () => undefined),
      confirmUpdate,
      fingerprint: vi.fn(async () => "build-a"),
      storage,
      now: () => 1_000
    })();
    await createPwaUpdatePrompt({
      message: "update",
      applyUpdate: vi.fn(async () => undefined),
      confirmUpdate,
      fingerprint: vi.fn(async () => "build-b"),
      storage,
      now: () => 1_001
    })();

    expect(confirmUpdate).toHaveBeenCalledTimes(2);
  });

  it("activates the waiting worker after confirmation", async () => {
    const applyUpdate = vi.fn(async () => undefined);
    await createPwaUpdatePrompt({
      message: "update",
      applyUpdate,
      confirmUpdate: () => true,
      fingerprint: async () => "build-a",
      storage: memoryStorage()
    })();

    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });
});
