export type ParserSourceProtector = (line: string) => readonly number[];

/** Same-size parser-only substitutions preserve every authored UTF-16 offset. */
export function protectParserSource(source: string, protectors: readonly ParserSourceProtector[]): {
  parserSource: string;
  restoration: ReadonlyMap<string, string>;
} {
  const characters = source.split("");
  const sentinels = new Map<string, string>();
  const restoration = new Map<string, string>();
  const decodedSpellings = source.replace(/&#(?:([0-9]+)|x([0-9a-f]+));|&percnt;/gi, (entity, decimal: string | undefined, hex: string | undefined) => {
    const code = decimal ? Number(decimal) : hex ? Number.parseInt(hex, 16) : 0x25;
    return code >= 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : entity;
  });
  const occupied = new Set(decodedSpellings);
  const encodedSource = decodedSpellings.toLowerCase();
  let nextSentinel = 0xE001;
  const sentinelFor = (character: string): string | null => {
    const existing = sentinels.get(character);
    if (existing) return existing;
    while (nextSentinel <= 0xF8FF) {
      const candidate = String.fromCharCode(nextSentinel++);
      // Parsers can decode numeric entities and percent-encode link targets.
      // Reserve those authored spellings too, so restoration cannot change them.
      if (occupied.has(candidate) || encodedSource.includes(encodeURIComponent(candidate).toLowerCase())) continue;
      sentinels.set(character, candidate);
      restoration.set(candidate, character);
      return candidate;
    }
    return null;
  };
  let changed = false;
  for (const line of source.matchAll(/[^\r\n]+/g)) {
    for (const protect of protectors) {
      for (const offset of protect(line[0])) {
        const character = line[0][offset];
        if (character === undefined) continue;
        const sentinel = sentinelFor(character);
        if (!sentinel) continue;
        characters[line.index + offset] = sentinel;
        changed = true;
      }
    }
  }
  return { parserSource: changed ? characters.join("") : source, restoration };
}

export function restoreParserSource(text: string, restoration: ReadonlyMap<string, string>): string {
  let restored = text;
  for (const [sentinel, character] of restoration) {
    restored = restored.replaceAll(sentinel, character)
      .replace(new RegExp(encodeURIComponent(sentinel), "gi"), character);
  }
  return restored;
}
