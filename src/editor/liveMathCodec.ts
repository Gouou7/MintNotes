const MATH_LANGUAGE = "mint-math";
const QUOTE_PREFIX = /^((?:[ \t]*>[ \t]?)*)(.*)$/;
const FENCE = /^([ \t]*)(`{3,}|~{3,})([^`]*)$/;

interface QuoteLine {
  prefix: string;
  content: string;
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

function safeMathFence(lines: string[], start: number, end: number): string {
  let longest = 2;
  for (let index = start; index < end; index += 1) {
    const content = splitQuoteLine(lines[index]).content;
    for (const run of content.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  }
  return "`".repeat(longest + 1);
}

export function materializeMathBlocksForLive(markdown: string): string {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let fence: { prefix: string; marker: string } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = splitQuoteLine(lines[index]);
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

    const opening = /^([ \t]*)\$\$[ \t]*$/.exec(line.content);
    if (!opening) {
      output.push(lines[index]);
      continue;
    }

    let closing = index + 1;
    while (closing < lines.length) {
      const candidate = splitQuoteLine(lines[closing]);
      if (candidate.prefix === line.prefix && /^([ \t]*)\$\$[ \t]*$/.test(candidate.content)) break;
      closing += 1;
    }
    if (closing >= lines.length) {
      output.push(lines[index]);
      continue;
    }

    const indentation = opening[1];
    const marker = safeMathFence(lines, index + 1, closing);
    output.push(`${line.prefix}${indentation}${marker}${MATH_LANGUAGE}`);
    for (let inner = index + 1; inner < closing; inner += 1) {
      const candidate = splitQuoteLine(lines[inner]);
      output.push(candidate.prefix === line.prefix
        ? `${line.prefix}${candidate.content}`
        : lines[inner]);
    }
    output.push(`${line.prefix}${indentation}${marker}`);
    index = closing;
  }

  return output.join(eol);
}

export function canonicalizeMathBlocksFromLive(markdown: string): string {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = splitQuoteLine(lines[index]);
    const opening = new RegExp(`^([ \\t]*)(\`{3,}|~{3,})${MATH_LANGUAGE}[ \\t]*$`, "i").exec(line.content);
    if (!opening) {
      output.push(lines[index]);
      continue;
    }

    let closing = index + 1;
    while (closing < lines.length) {
      const candidate = splitQuoteLine(lines[closing]);
      if (candidate.prefix === line.prefix && closingFence(candidate.content, opening[2])) break;
      closing += 1;
    }
    if (closing >= lines.length) {
      output.push(lines[index]);
      continue;
    }

    const indentation = opening[1];
    output.push(`${line.prefix}${indentation}$$`);
    for (let inner = index + 1; inner < closing; inner += 1) {
      const candidate = splitQuoteLine(lines[inner]);
      output.push(candidate.prefix === line.prefix
        ? `${line.prefix}${candidate.content}`
        : lines[inner]);
    }
    output.push(`${line.prefix}${indentation}$$`);
    index = closing;
  }

  return output.join(eol);
}

export function materializeSingleLineDisplayMathForReading(markdown: string): string {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let fence: { prefix: string; marker: string } | null = null;

  for (const sourceLine of lines) {
    const line = splitQuoteLine(sourceLine);
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
    output.push(`${line.prefix}${math[1]}$$`, `${line.prefix}${math[2]}`, `${line.prefix}${math[1]}$$`);
  }

  return output.join(eol);
}
