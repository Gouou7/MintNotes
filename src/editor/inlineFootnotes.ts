import type { ReadingReplacement, SourcePiece } from "./reading-source";
function escaped(source: string, offset: number): boolean {
  let slashes = 0;
  for (let index = offset - 1; index >= 0 && source[index] === "\\"; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function backtickRun(source: string, offset: number): number {
  let end = offset;
  while (source[end] === "`") end += 1;
  return end - offset;
}

function inlineFootnoteEnd(source: string, openBracket: number): number | null {
  let depth = 1;
  let codeRun = 0;
  for (let index = openBracket + 1; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === "\n" || character === "\r") return null;
    if (character === "`" && !escaped(source, index)) {
      const run = backtickRun(source, index);
      if (codeRun === 0) codeRun = run;
      else if (run === codeRun) codeRun = 0;
      index += run - 1;
      continue;
    }
    if (codeRun > 0 || escaped(source, index)) continue;
    if (character === "[") depth += 1;
    else if (character === "]" && --depth === 0) return index;
  }
  return null;
}

function nextInlineLabel(source: string, sequence: number): string {
  let candidate = `mint-inline-footnote-${sequence}`;
  let suffix = 1;
  while (source.includes(`[^${candidate}]`)) candidate = `mint-inline-footnote-${sequence}-${suffix++}`;
  return candidate;
}

/** Materialize Obsidian `^[text]` notes for the read-only Markdown pipeline. */
export function materializeInlineFootnotesForReading(source: string, replacements?: ReadingReplacement[]): string {
  const appended: SourcePiece[] = [{ text: "\n\n" }];
  const output: string[] = [];
  const definitions: string[] = [];
  let cursor = 0;
  let sequence = 1;
  let fence: { marker: "`" | "~"; length: number } | null = null;
  let codeRun = 0;
  let lineStart = true;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (lineStart) {
      const line = source.slice(index).match(/^( {0,3})(`{3,}|~{3,})/);
      if (line) {
        const marker = line[2]![0] as "`" | "~";
        const length = line[2]!.length;
        if (!fence) fence = { marker, length };
        else if (fence.marker === marker && length >= fence.length) fence = null;
      }
      lineStart = false;
    }
    if (character === "\n") {
      lineStart = true;
      codeRun = 0;
      continue;
    }
    if (fence) continue;
    if (character === "`" && !escaped(source, index)) {
      const run = backtickRun(source, index);
      if (codeRun === 0) codeRun = run;
      else if (run === codeRun) codeRun = 0;
      index += run - 1;
      continue;
    }
    if (
      codeRun > 0
      || character !== "^"
      || source[index + 1] !== "["
      || escaped(source, index)
    ) continue;
    const end = inlineFootnoteEnd(source, index + 1);
    if (end === null || end === index + 2) continue;
    const label = nextInlineLabel(source, sequence++);
    output.push(source.slice(cursor, index), `[^${label}]`);
    definitions.push(`[^${label}]: ${source.slice(index + 2, end)}`);
    replacements?.push({ from: index, to: end + 1, pieces: [{ text: `[^${label}]` }] });
    if (definitions.length > 1) appended.push({ text: "\n" });
    appended.push({ text: `[^${label}]: ` }, { from: index + 2, to: end });
    cursor = end + 1;
    index = end;
  }

  if (definitions.length === 0) return source;
  replacements?.push({ from: source.length, to: source.length, pieces: appended });
  output.push(source.slice(cursor));
  return `${output.join("")}\n\n${definitions.join("\n")}`;
}
