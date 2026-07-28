import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadRecoveryKey } from "./recoveryKey";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadRecoveryKey", () => {
  it("downloads a plaintext recovery-key file and revokes its Blob URL", () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recovery-key");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    let download = "";
    let href = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      download = this.download;
      href = this.href;
    });

    downloadRecoveryKey("audit-user", "recovery-secret");

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(download).toBe("mint-notes-recovery-key-audit-user.txt");
    expect(href).toBe("blob:recovery-key");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:recovery-key");
  });
});
