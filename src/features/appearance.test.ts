import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_WRAP_CODE_BLOCKS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  normalizeFontSize,
  normalizeWrapCodeBlocks
} from "./appearance";

describe("normalizeFontSize", () => {
  it("keeps supported pixel sizes and clamps out-of-range values", () => {
    expect(normalizeFontSize(18)).toBe(18);
    expect(normalizeFontSize(MIN_FONT_SIZE - 1)).toBe(MIN_FONT_SIZE);
    expect(normalizeFontSize(MAX_FONT_SIZE + 1)).toBe(MAX_FONT_SIZE);
  });

  it("migrates legacy size names to their previous pixel values", () => {
    expect(normalizeFontSize("small")).toBe(13);
    expect(normalizeFontSize("standard")).toBe(DEFAULT_FONT_SIZE);
    expect(normalizeFontSize("large")).toBe(16);
  });

  it("falls back to the default for malformed values", () => {
    expect(normalizeFontSize(14.5)).toBe(DEFAULT_FONT_SIZE);
    expect(normalizeFontSize("18")).toBe(DEFAULT_FONT_SIZE);
    expect(normalizeFontSize(null)).toBe(DEFAULT_FONT_SIZE);
  });
});

describe("normalizeWrapCodeBlocks", () => {
  it("defaults to wrapping unless the stored preference is explicitly disabled", () => {
    expect(normalizeWrapCodeBlocks(undefined)).toBe(DEFAULT_WRAP_CODE_BLOCKS);
    expect(normalizeWrapCodeBlocks(true)).toBe(true);
    expect(normalizeWrapCodeBlocks(false)).toBe(false);
    expect(normalizeWrapCodeBlocks("false")).toBe(DEFAULT_WRAP_CODE_BLOCKS);
  });
});
