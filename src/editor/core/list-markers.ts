import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { protectParserSource, restoreParserSource } from "./parser-source-protection";

/** Find an unfinished marker after any combination of quote and list prefixes. */
export function incompleteListMarkerOffsets(line: string): readonly number[] {
  let cursor = 0;
  while (cursor < line.length) {
    while (line[cursor] === " " || line[cursor] === "\t") cursor++;
    if (line[cursor] === ">") {
      cursor++;
      continue;
    }
    const remaining = line.slice(cursor);
    // Spaced thematic breaks also resemble a chain of empty list prefixes.
    if (/^(?:\*(?:[\t ]*\*){2,}|-(?:[\t ]*-){2,})[\t ]*$/.test(remaining)) return [];
    const marker = /^(?:[*+-]|\d{1,9}[.)])/.exec(remaining);
    if (!marker) return [];
    cursor += marker[0].length;
    if (cursor === line.length) return [cursor - 1];
    if (line[cursor] !== " " && line[cursor] !== "\t") return [];
  }
  return [];
}

/** An empty list item requires an authored space or Tab after its marker. */
export function strictListMarkers(md: MarkdownIt): void {
  const sources = new WeakMap<object, { source: string; restoration: ReadonlyMap<string, string> }>();
  md.core.ruler.before("block", "mint_list_marker_separator", (state) => {
    if (state.inlineMode) return;
    const protectedSource = protectParserSource(state.src, [incompleteListMarkerOffsets]);
    sources.set(state, { source: state.src, restoration: protectedSource.restoration });
    state.src = protectedSource.parserSource;
  });
  md.core.ruler.after("block", "mint_restore_list_markers", (state) => {
    const protectedSource = sources.get(state);
    if (!protectedSource) return;
    const restore = (token: Token): void => {
      token.content = restoreParserSource(token.content, protectedSource.restoration);
      token.attrs = token.attrs?.map(([name, value]) => [
        name, typeof value === "string" ? restoreParserSource(value, protectedSource.restoration) : value,
      ]) ?? null;
      token.children?.forEach(restore);
    };
    state.tokens.forEach(restore);
    // Reference destinations are parsed during the block phase, before inlines.
    if (state.env.references) {
      const references: Record<string, { href: string; title: string }> = state.env.references;
      state.env.references = Object.fromEntries(Object.entries(references).map(([label, reference]) => [
        restoreParserSource(label, protectedSource.restoration),
        {
          ...reference,
          href: restoreParserSource(reference.href, protectedSource.restoration),
          title: restoreParserSource(reference.title, protectedSource.restoration),
        },
      ]));
    }
    state.src = protectedSource.source;
    sources.delete(state);
  });
}
