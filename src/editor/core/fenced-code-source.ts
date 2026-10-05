import type { Node as PMNode } from "prosemirror-model";

export type FencedCodeSource = {
  marker: string;
  lang: string;
  body: string;
  bodyFrom: number;
  bodyTo: number;
  openingFrom: number;
  openingTo: number;
  closingFrom: number | null;
  closingTo: number | null;
};

export function displayCodeLanguage(lang: string): string {
  const normalized = lang.trim().toLowerCase();
  const names: Record<string, string> = {
    bash: "Shell",
    sh: "Shell",
    shell: "Shell",
    zsh: "Shell",
    js: "JavaScript",
    javascript: "JavaScript",
    ts: "TypeScript",
    typescript: "TypeScript",
    py: "Python",
    python: "Python",
    html: "HTML",
    css: "CSS",
    json: "JSON",
    yaml: "YAML",
    yml: "YAML",
    md: "Markdown",
    markdown: "Markdown",
  };
  return names[normalized] ?? lang.trim();
}

const OPENING_FENCE_RE = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/;

function closingFenceLength(line: string, marker: string): number | null {
  const match = /^ {0,3}(`+|~+)[\t ]*$/.exec(line);
  if (!match || match[1]![0] !== marker[0] || match[1]!.length < marker.length) {
    return null;
  }
  return match[1]!.length;
}

export function parseFencedCodeSource(source: string): FencedCodeSource | null {
  const endings = [...source.matchAll(/\r\n|\r|\n/g)];
  if (!endings.length) return null;
  const openingBreak = endings[0]!.index;
  const opening = OPENING_FENCE_RE.exec(source.slice(0, openingBreak));
  if (!opening) return null;

  const marker = opening[1]!;
  const lastBreak = endings.at(-1)!.index;
  const closingFrom = lastBreak + endings.at(-1)![0].length;
  const closingLine = source.slice(closingFrom);
  const hasClosingFence = closingFenceLength(closingLine, marker) !== null;
  const bodyFrom = openingBreak + endings[0]![0].length;
  // In an empty fenced block (`opening\nclosing`), the same line break ends
  // the opening line and precedes the closing line. Keep the body as a valid
  // zero-width source range at the start of the closing fence.
  const bodyTo = hasClosingFence ? Math.max(bodyFrom, lastBreak) : source.length;

  return {
    marker,
    lang: (opening[2] ?? "").trim(),
    body: source.slice(bodyFrom, bodyTo),
    bodyFrom,
    bodyTo,
    openingFrom: 0,
    openingTo: openingBreak,
    closingFrom: hasClosingFence ? closingFrom : null,
    closingTo: hasClosingFence ? source.length : null,
  };
}

// Only fence-shaped lines affect how Markdown is split into blocks. Keeping
// this signature independent of ordinary body text lets Live mode reparse on
// structural edits (adding/removing a close fence) without reparsing on every
// code character.
export function fencedCodeStructureSignature(source: string): string {
  const openingBreak = source.search(/\r\n|\r|\n/);
  const opening = openingBreak >= 0
    ? OPENING_FENCE_RE.exec(source.slice(0, openingBreak))
    : null;
  if (!opening) return "invalid";

  const marker = opening[1]!;
  const closingMarkers = source
    .slice(openingBreak)
    .split(/\r\n|\r|\n/)
    .map((line) => closingFenceLength(line, marker))
    .filter((length): length is number => length !== null);
  return `${marker[0]}:${marker.length}:${closingMarkers.join(",")}`;
}

export function fencedCodeBody(node: PMNode): string {
  return parseFencedCodeSource(node.textContent)?.body ?? node.textContent;
}
