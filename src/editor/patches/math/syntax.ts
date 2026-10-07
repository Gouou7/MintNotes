import { escaped } from "./escapes.ts";

export interface MathSource {
  from: number;
  to: number;
  source: string;
  body: string;
  kind: "math" | "display-math";
  contentFrom: number;
  contentTo: number;
  complete: boolean;
}

/** Exact dollar runs avoid treating a half of $$ as an inline delimiter. */
function delimiterWidth(text: string, from: number): number {
  let end = from;
  while (text[end] === "$") end++;
  return end - from;
}

export function mathAt(text: string, from: number, allowIncomplete = false): MathSource | null {
  if (text[from] !== "$" || text[from - 1] === "$" || escaped(text, from)) return null;
  const width = delimiterWidth(text, from);
  if (width !== 1 && width !== 2) return null;
  const contentFrom = from + width;
  if (width === 1 && /\s/.test(text[contentFrom] ?? " ")) return null;
  for (let end = contentFrom; end < text.length; end++) {
    if (width === 1 && text[end] === "\n") break;
    if (text[end] !== "$" || escaped(text, end)) continue;
    const closingWidth = delimiterWidth(text, end);
    if (closingWidth === width && (width === 2 || end > contentFrom && !/\s/.test(text[end - 1]))) {
      const to = end + width;
      return { from, to, source: text.slice(from, to), body: text.slice(contentFrom, end),
        kind: width === 2 ? "display-math" : "math", contentFrom, contentTo: end, complete: true };
    }
    end += closingWidth - 1;
  }
  if (!allowIncomplete) return null;
  const newline = text.indexOf("\n", contentFrom);
  const to = width === 1 && newline >= 0 ? newline : text.length;
  return { from, to, source: text.slice(from, to), body: text.slice(contentFrom, to),
    kind: width === 2 ? "display-math" : "math", contentFrom, contentTo: to, complete: false };
}

/** A display formula is a block only when it occupies the whole source. */
export function mathBlockSource(source: string, allowIncomplete = false): MathSource | null {
  const from = /^[ \t]*/.exec(source)![0].length;
  const math = mathAt(source, from, allowIncomplete);
  // A later code example must not accidentally close an unfinished formula.
  return math?.kind === "display-math" && !source.slice(math.to).trim() && !/\n[ \t]*(?:`{3,}|~{3,})/.test(math.body) ? math : null;
}

export function mathBodySelection(source: string): { start: number; end: number } {
  const math = mathBlockSource(source, true);
  if (!math) return { start: 0, end: source.length };
  let start = math.contentFrom, end = math.contentTo;
  // Fence-only lines are syntax, while all spaces inside TeX remain intact.
  if (/^[ \t]*\n/.test(source.slice(start))) start += source.slice(start).indexOf("\n") + 1;
  if (math.complete && /^[ \t]*$/.test(source.slice(source.lastIndexOf("\n", end - 1) + 1, end))) {
    end = Math.max(start, source.lastIndexOf("\n", end - 1));
  }
  return { start, end: Math.max(start, end) };
}
