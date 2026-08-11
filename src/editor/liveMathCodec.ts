const MATH_LANGUAGE = "mint-math";
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

function safeMathFence(lines: readonly SourceLine[], start: number, end: number): string {
  let longest = 2;
  for (let index = start; index < end; index += 1) {
    const content = splitQuoteLine(lines[index].text).content;
    for (const run of content.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  }
  return "`".repeat(longest + 1);
}

export function materializeMathBlocksForLive(markdown: string): string {
  const lines = splitLines(markdown);
  const output: SourceLine[] = [];
  let fence: { prefix: string; marker: string } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = splitQuoteLine(lines[index].text);
    if (fence) {
      output.push(lines[index]);
      if (line.prefix === fence.prefix && closingFence(line.content, fence.marker)) fence = null;
      continue;
    }

    const authoredFence = FENCE.exec(line.content);
    if (authoredFence) {
      output.push(lines[index]);
      fence = { prefix: line.prefix, marker: authoredFence[2] };
      continue;
    }

    const opening = /^([ \t]*)\$\$([ \t]*)$/.exec(line.content);
    if (!opening) {
      output.push(lines[index]);
      continue;
    }

    let closing = index + 1;
    let closingMath: RegExpExecArray | null = null;
    while (closing < lines.length) {
      const candidate = splitQuoteLine(lines[closing].text);
      const match = /^([ \t]*)\$\$([ \t]*)$/.exec(candidate.content);
      if (candidate.prefix === line.prefix && match) {
        closingMath = match;
        break;
      }
      closing += 1;
    }
    if (closing >= lines.length || !closingMath) {
      output.push(lines[index]);
      continue;
    }

    const indentation = opening[1];
    const marker = safeMathFence(lines, index + 1, closing);
    output.push({
      ...lines[index],
      text: `${line.prefix}${indentation}${marker}${MATH_LANGUAGE}${opening[2]}`,
    });
    for (let inner = index + 1; inner < closing; inner += 1) {
      const candidate = splitQuoteLine(lines[inner].text);
      output.push(candidate.prefix === line.prefix
        ? { ...lines[inner], text: `${line.prefix}${candidate.content}` }
        : lines[inner]);
    }
    output.push({
      ...lines[closing],
      text: `${line.prefix}${closingMath[1]}${marker}${closingMath[2]}`,
    });
    index = closing;
  }

  return joinLines(output);
}

export function canonicalizeMathBlocksFromLive(markdown: string): string {
  const lines = splitLines(markdown);
  const output: SourceLine[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = splitQuoteLine(lines[index].text);
    const opening = new RegExp(`^([ \\t]*)(\`{3,}|~{3,})${MATH_LANGUAGE}([ \\t]*)$`, "i").exec(line.content);
    if (!opening) {
      output.push(lines[index]);
      continue;
    }

    let closing = index + 1;
    let closingLive: RegExpExecArray | null = null;
    while (closing < lines.length) {
      const candidate = splitQuoteLine(lines[closing].text);
      const match = /^([ \t]*)(`{3,}|~{3,})([ \t]*)$/.exec(candidate.content);
      if (
        candidate.prefix === line.prefix
        && match
        && closingFence(candidate.content, opening[2])
      ) {
        closingLive = match;
        break;
      }
      closing += 1;
    }
    if (closing >= lines.length || !closingLive) {
      output.push(lines[index]);
      continue;
    }

    const indentation = opening[1];
    output.push({ ...lines[index], text: `${line.prefix}${indentation}$$${opening[3]}` });
    for (let inner = index + 1; inner < closing; inner += 1) {
      const candidate = splitQuoteLine(lines[inner].text);
      output.push(candidate.prefix === line.prefix
        ? { ...lines[inner], text: `${line.prefix}${candidate.content}` }
        : lines[inner]);
    }
    output.push({
      ...lines[closing],
      text: `${line.prefix}${closingLive[1]}$$${closingLive[3]}`,
    });
    index = closing;
  }

  return joinLines(output);
}

export function materializeSingleLineDisplayMathForReading(markdown: string): string {
  const lines = splitLines(markdown);
  const output: SourceLine[] = [];
  let fence: { prefix: string; marker: string } | null = null;

  for (const sourceLine of lines) {
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
    output.push(
      { text: `${line.prefix}${math[1]}$$`, eol: insertedEol },
      { text: `${line.prefix}${math[2]}`, eol: insertedEol },
      { text: `${line.prefix}${math[1]}$$`, eol: sourceLine.eol },
    );
  }

  return joinLines(output);
}
