import { describe, expect, it, vi } from "vitest";
import { isValidDevicePin } from "./deviceUnlock";

vi.mock("./client", () => ({ cryptoClient: {} }));

describe("device PIN validation", () => {
  it("accepts any four or more characters", () => {
    expect(isValidDevicePin("1234")).toBe(true);
    expect(isValidDevicePin("a!好?")).toBe(true);
    expect(isValidDevicePin("🔒🔑🗝️密")).toBe(true);
  });

  it("rejects PINs shorter than four characters", () => {
    expect(isValidDevicePin("abc")).toBe(false);
    expect(isValidDevicePin("")).toBe(false);
  });
});
