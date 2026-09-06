import type { ReadingReplacement } from "./reading-source";
const QUOTE_PREFIX = /^((?:[ \t]*>[ \t]?)*)(.*)$/;
const FENCE = /^([ \t]*)(`{3,}|~{3,})([^`]*)$/;

interface QuoteLine {
  prefix: string;
  content: string;
}

interface SourceLine {
  text: string;
  eol: string;
}

function splitLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
    const index = match.index ?? 0;
    lines.push({ text: source.slice(start, index), eol: match[0] });
    start = index + match[0].length;
  }
  lines.push({ text: source.slice(start), eol: "" });
  return lines;
}

function joinLines(lines: readonly SourceLine[]): string {
  return lines.map((line) => line.text + line.eol).join("");
}

function splitQuoteLine(line: string): QuoteLine {
  const match = QUOTE_PREFIX.exec(line);
  return { prefix: match?.[1] ?? "", content: match?.[2] ?? line };
}

function closingFence(content: string, marker: string): boolean {
  const trimmed = content.trim();
  return trimmed.length >= marker.length
    && trimmed[0] === marker[0]
    && [...trimmed].every((character) => character === marker[0]);
}

export function materializeSingleLineDisplayMathForReading(markdown: string, replacements?: ReadingReplacement[]): string {
  const lines = splitLines(markdown);
  const output: SourceLine[] = [];
  let fence: { prefix: string; marker: string } | null = null;

  let offset = 0;
  for (const sourceLine of lines) {
    const from = offset;
    offset += sourceLine.text.length + sourceLine.eol.length;
    const line = splitQuoteLine(sourceLine.text);
    if (fence) {
      output.push(sourceLine);
      if (line.prefix === fence.prefix && closingFence(line.content, fence.marker)) fence = null;
      continue;
    }
    const authoredFence = FENCE.exec(line.content);
    if (authoredFence) {
      output.push(sourceLine);
      fence = { prefix: line.prefix, marker: authoredFence[2] };
      continue;
    }
    const math = /^([ \t]*)\$\$([^\n]+)\$\$[ \t]*$/.exec(line.content);
    if (!math) {
      output.push(sourceLine);
      continue;
    }
    const insertedEol = sourceLine.eol || "\n";
    const openingEnd = from + line.prefix.length + math[1]!.length + 2;
    const bodyEnd = openingEnd + math[2]!.length;
    replacements?.push({ from, to: offset, pieces: [
      { from, to: openingEnd }, { text: insertedEol + line.prefix },
      { from: openingEnd, to: bodyEnd }, { text: insertedEol + line.prefix + math[1] },
      { from: bodyEnd, to: bodyEnd + 2 },
      { from: from + sourceLine.text.length, to: offset },
    ] });
    output.push(
      { text: `${line.prefix}${math[1]}$$`, eol: insertedEol },
      { text: `${line.prefix}${math[2]}`, eol: insertedEol },
      { text: `${line.prefix}${math[1]}$$`, eol: sourceLine.eol },
    );
  }

  return joinLines(output);
}
