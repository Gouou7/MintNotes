import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadRecoveryKey } from "./recoveryKey";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("recovery key download", () => {
  it("keeps the Blob URL alive through the click task", () => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recovery-key");
    let download = "";
    let href = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      download = this.download;
      href = this.href;
    });
    downloadRecoveryKey("alice", "secret-code");
    expect(download).toBe("mint-notes-recovery-key-alice.txt");
    expect(href).toBe("blob:recovery-key");
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:recovery-key");
  });
});
