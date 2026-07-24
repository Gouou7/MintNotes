import { describe, expect, it } from "vitest";
import { formatNoteTime } from "./noteTime";

describe("note time formatting", () => {
  it("formats a local timestamp without seconds", () => {
    const date = new Date(2026, 0, 2, 18, 0, 45);
    expect(formatNoteTime(date.toISOString())).toBe("2026-01-02 18:00");
  });

  it("uses a safe placeholder for invalid timestamps", () => {
    expect(formatNoteTime("not-a-date")).toBe("—");
  });
});
