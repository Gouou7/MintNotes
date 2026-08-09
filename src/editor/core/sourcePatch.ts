function commonPrefix(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffix(left: string, right: string, prefix = 0): number {
  const limit = Math.min(left.length, right.length) - prefix;
  let index = 0;
  while (index < limit && left[left.length - 1 - index] === right[right.length - 1 - index]) index += 1;
  return index;
}

/** Map an offset between semantically equivalent Markdown spellings using nearby unchanged source anchors. */
export function mapEquivalentOffset(from: string, to: string, offset: number, bias: "left" | "right" = "left"): number {
  const clamped = Math.max(0, Math.min(offset, from.length));
  if (from === to) return Math.min(clamped, to.length);
  const exactPrefix = commonPrefix(from, to);
  if (clamped <= exactPrefix) return clamped;
  const exactSuffix = commonSuffix(from, to, exactPrefix);
  if (clamped >= from.length - exactSuffix) return to.length - (from.length - clamped);

  for (const length of [64, 32, 16, 8, 4, 2, 1]) {
    const leftStart = Math.max(0, clamped - length);
    const left = from.slice(leftStart, clamped);
    if (left.length === length) {
      const found = to.lastIndexOf(left);
      if (found >= 0 && to.indexOf(left, found + 1) < 0) return found + left.length;
    }
    const right = from.slice(clamped, clamped + length);
    if (right.length === length) {
      const found = to.indexOf(right);
      if (found >= 0 && to.indexOf(right, found + 1) < 0) return found;
    }
  }

  const ratio = from.length === 0 ? 0 : clamped / from.length;
  const approximate = Math.round(ratio * to.length);
  return bias === "right" ? Math.min(to.length, approximate + Math.max(0, to.length - from.length)) : approximate;
}

/** Apply only the rendered transaction's changed range to the authored canonical source. */
export function preserveAuthoredSource(
  canonical: string,
  beforeRendered: string,
  afterRendered: string
): string {
  if (beforeRendered === afterRendered) return canonical;
  if (canonical === beforeRendered) return afterRendered;
  const prefix = commonPrefix(beforeRendered, afterRendered);
  const suffix = commonSuffix(beforeRendered, afterRendered, prefix);
  const beforeEnd = beforeRendered.length - suffix;
  const afterEnd = afterRendered.length - suffix;
  const canonicalStart = mapEquivalentOffset(beforeRendered, canonical, prefix, "left");
  const canonicalEnd = mapEquivalentOffset(beforeRendered, canonical, beforeEnd, "right");
  return canonical.slice(0, canonicalStart)
    + afterRendered.slice(prefix, afterEnd)
    + canonical.slice(Math.max(canonicalStart, canonicalEnd));
}
