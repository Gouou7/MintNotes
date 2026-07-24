import { describe, expect, it } from "vitest";
import { toastDuration } from "./Toast";

describe("toastDuration", () => {
  it("automatically dismisses routine notices", () => {
    expect(toastDuration("info")).toBe(4000);
    expect(toastDuration("warning")).toBe(7000);
  });

  it("keeps critical notices until they are dismissed", () => {
    expect(toastDuration("critical")).toBeNull();
  });
});
