import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceUnlockCredential, VerifiedDeviceSession } from "../../storage/database";
import type { AuthEndpoint, User } from "../../types";
import { ApiError, api } from "../../api";
import { cryptoClient } from "../../crypto/client";
import {
  forgetDeviceUnlock,
  getDeviceUnlock,
  getRememberedOfflineDevice,
  hasDevicePin,
  markEndpointRevocationPending,
  restoreDeviceUnlock,
  updateVerifiedDeviceSession
} from "../../crypto/deviceUnlock";
import { deleteLocalUserData } from "../../storage/database";
import { useSessionController } from "./useSessionController";

vi.mock("../../api", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  },
  api: vi.fn()
}));
vi.mock("../../crypto/client", () => ({
  cryptoClient: { lock: vi.fn() }
}));
vi.mock("../../crypto/deviceUnlock", () => ({
  broadcastAccountLogout: vi.fn(),
  clearCurrentBrowserSessionGrant: vi.fn(),
  clearPendingEndpointRevocation: vi.fn(),
  forgetDeviceUnlock: vi.fn().mockResolvedValue(undefined),
  flushPendingEndpointRevocations: vi.fn().mockResolvedValue(undefined),
  getDeviceUnlock: vi.fn(),
  getRememberedOfflineDevice: vi.fn(),
  grantCurrentBrowserSession: vi.fn(),
  hasCurrentBrowserSessionGrant: vi.fn().mockReturnValue(true),
  hasDevicePin: vi.fn(),
  listenForBrowserSessionGrantRequests: vi.fn().mockReturnValue(() => undefined),
  markEndpointRevocationPending: vi.fn().mockResolvedValue(undefined),
  rememberDeviceUnlock: vi.fn(),
  requestBrowserSessionGrant: vi.fn().mockResolvedValue(false),
  restoreDeviceUnlock: vi.fn(),
  updateVerifiedDeviceSession: vi.fn()
}));
vi.mock("../../storage/database", async () => {
  const actual = await vi.importActual<typeof import("../../storage/database")>("../../storage/database");
  return {
    ...actual,
    deleteLocalUserData: vi.fn(),
    localDb: {
      deviceCredentials: { toArray: vi.fn().mockResolvedValue([]) }
    }
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const user: User = { id: "user-id", username: "user", displayName: "User", role: "user" };
const endpoint: AuthEndpoint = { id: "endpoint-id", remembered: true };
const verifiedSession: VerifiedDeviceSession = {
  version: 1,
  user,
  endpoint,
  verifiedAt: "2026-07-29T00:00:00.000Z"
};
const directCredential: DeviceUnlockCredential = {
  userId: user.id,
  endpointId: endpoint.id,
  mode: "remembered",
  deviceKey: {} as CryptoKey,
  version: 3,
  protection: "device",
  ciphertext: "ciphertext",
  nonce: "nonce",
  verifiedSession,
  failedPinAttempts: 0,
  autoLockMinutes: 0,
  updatedAt: verifiedSession.verifiedAt
};
const pinCredential: DeviceUnlockCredential = {
  ...directCredential,
  protection: "pin",
  pinKdfVersion: 1,
  pinSalt: "salt",
  pinCiphertext: "pin-ciphertext",
  pinNonce: "pin-nonce"
};

type Controller = ReturnType<typeof useSessionController>;
const roots: Root[] = [];
let latest: Controller | null = null;

function Harness() {
  latest = useSessionController();
  return null;
}

async function renderController(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<Harness />));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return () => latest!;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  latest = null;
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.mocked(cryptoClient.lock).mockResolvedValue({ locked: true });
});

describe("offline remembered-session restoration", () => {
  it("automatically opens a remembered direct credential without contacting the server", async () => {
    vi.mocked(getRememberedOfflineDevice).mockResolvedValue({ credential: directCredential, session: verifiedSession });
    vi.mocked(hasDevicePin).mockReturnValue(false);
    vi.mocked(restoreDeviceUnlock).mockResolvedValue(true);

    const controller = await renderController(false);

    expect(controller().restoringDevice).toBe(false);
    expect(controller().user).toEqual(user);
    expect(controller().serverSessionVerified).toBe(false);
    expect(api).not.toHaveBeenCalled();
  });

  it("routes a remembered PIN credential to the offline lock screen", async () => {
    vi.mocked(getRememberedOfflineDevice).mockResolvedValue({ credential: pinCredential, session: verifiedSession });
    vi.mocked(hasDevicePin).mockReturnValue(true);

    const controller = await renderController(false);

    expect(controller().user).toBeNull();
    expect(controller().session).toEqual({ user, endpoint });
    expect(controller().credential).toEqual(pinCredential);
    expect(restoreDeviceUnlock).not.toHaveBeenCalled();
  });

  it("reports that offline access is unavailable without an eligible remembered credential", async () => {
    vi.mocked(getRememberedOfflineDevice).mockResolvedValue(null);

    const controller = await renderController(false);

    expect(controller().offlineUnavailable).toBe(true);
    expect(controller().session).toBeNull();
  });

  it("uses a local remembered credential after a transport failure", async () => {
    vi.mocked(api).mockRejectedValueOnce(new TypeError("offline"));
    vi.mocked(getRememberedOfflineDevice).mockResolvedValue({ credential: directCredential, session: verifiedSession });
    vi.mocked(hasDevicePin).mockReturnValue(false);
    vi.mocked(restoreDeviceUnlock).mockResolvedValue(true);

    const controller = await renderController(true);

    expect(controller().user).toEqual(user);
    expect(controller().serverSessionVerified).toBe(false);
  });

  it("never falls back to local trust after an authoritative 401", async () => {
    vi.mocked(api).mockRejectedValueOnce(new ApiError("invalid", 401));

    const controller = await renderController(true);

    expect(controller().user).toBeNull();
    expect(getRememberedOfflineDevice).not.toHaveBeenCalled();
  });

  it("revalidates before promoting a locally unlocked vault to server-authorized mode", async () => {
    vi.mocked(getRememberedOfflineDevice).mockResolvedValue({ credential: directCredential, session: verifiedSession });
    vi.mocked(hasDevicePin).mockReturnValue(false);
    vi.mocked(restoreDeviceUnlock).mockResolvedValue(true);
    vi.mocked(api).mockResolvedValueOnce({ user, endpoint });
    vi.mocked(getDeviceUnlock).mockResolvedValue(directCredential);
    vi.mocked(updateVerifiedDeviceSession).mockResolvedValue(directCredential);
    const controller = await renderController(false);

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await act(async () => window.dispatchEvent(new Event("online")));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(api).toHaveBeenCalledWith("/api/auth/me");
    await vi.waitFor(() => expect(controller().serverSessionVerified).toBe(true));
    expect(controller().user).toEqual(user);
  });

  it("deduplicates concurrent reconnect verification attempts", async () => {
    vi.mocked(getRememberedOfflineDevice).mockResolvedValue({ credential: directCredential, session: verifiedSession });
    vi.mocked(hasDevicePin).mockReturnValue(false);
    vi.mocked(restoreDeviceUnlock).mockResolvedValue(true);
    let resolveVerification!: (value: { user: User; endpoint: AuthEndpoint }) => void;
    vi.mocked(api).mockImplementationOnce(() => new Promise((resolve) => {
      resolveVerification = resolve as typeof resolveVerification;
    }));
    vi.mocked(getDeviceUnlock).mockResolvedValue(directCredential);
    vi.mocked(updateVerifiedDeviceSession).mockResolvedValue(directCredential);
    await renderController(false);

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
    });

    expect(api).toHaveBeenCalledTimes(1);
    await act(async () => resolveVerification({ user, endpoint }));
  });

  it("clears local trust but preserves encrypted account data after reconnect receives 401", async () => {
    vi.mocked(getRememberedOfflineDevice).mockResolvedValue({ credential: directCredential, session: verifiedSession });
    vi.mocked(hasDevicePin).mockReturnValue(false);
    vi.mocked(restoreDeviceUnlock).mockResolvedValue(true);
    vi.mocked(api).mockRejectedValueOnce(new ApiError("invalid", 401));
    const controller = await renderController(false);

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await act(async () => window.dispatchEvent(new Event("online")));
    await vi.waitFor(() => expect(controller().session).toBeNull());

    expect(forgetDeviceUnlock).toHaveBeenCalledWith(user.id);
    expect(deleteLocalUserData).not.toHaveBeenCalled();
  });

  it("retains an endpoint revocation request when locked logout cannot reach the server", async () => {
    vi.mocked(getRememberedOfflineDevice).mockResolvedValue({ credential: pinCredential, session: verifiedSession });
    vi.mocked(hasDevicePin).mockReturnValue(true);
    vi.mocked(api).mockRejectedValueOnce(new TypeError("offline"));
    const controller = await renderController(false);

    await act(async () => controller().logoutLockedSession());

    expect(deleteLocalUserData).toHaveBeenCalledWith(user.id);
    expect(markEndpointRevocationPending).toHaveBeenCalledWith(user.id, endpoint.id);
  });
});
