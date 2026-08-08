export const DEFAULT_FONT_SIZE = 14;
export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 24;

const LEGACY_FONT_SIZES: Record<string, number> = {
  small: 13,
  standard: DEFAULT_FONT_SIZE,
  large: 16
};

export function normalizeFontSize(value: unknown): number {
  if (typeof value === "string" && value in LEGACY_FONT_SIZES) return LEGACY_FONT_SIZES[value];
  if (typeof value !== "number" || !Number.isInteger(value)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value));
}
