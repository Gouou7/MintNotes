import type MarkdownIt from "markdown-it";
import type { FeatureSpec } from "../features/_types.ts";
import { markConsumed, type InlineSpan } from "../inline-parse.ts";

export interface Literal { from: number; to: number; source: string; body: string; target?: string; kind: string }
export function escaped(text: string, position: number): boolean {
  let count = 0; while (position > 0 && text[--position] === "\\") count++; return count % 2 === 1;
}
export function literals(text: string): Literal[] {
  const result: Literal[] = [];
  const pattern = /`+|%%|!?\[\[|\[\^|\^\[|\[!|\$/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const from = match.index, start = match[0];
    if (escaped(text, from)) continue;
    if (start[0] === "`") {
      const end = text.indexOf(start, from + start.length);
      if (end >= 0) pattern.lastIndex = end + start.length;
      continue;
    }
    let to = -1, body = "", kind = "", target: string | undefined;
    if (start === "%%") {
      for (let end = from + 2; end < text.length - 1; end++) if (text.startsWith("%%", end) && !escaped(text, end)) { to = end + 2; break; }
      if (to > 0) { kind = "comment"; body = text.slice(from + 2, to - 2); }
    } else if (start === "[[" || start === "![[") {
      const end = text.indexOf("]]", from + start.length);
      if (end >= 0 && !text.slice(from, end).includes("\n")) {
        const inner = text.slice(from + start.length, end), parts = inner.split("|");
        target = parts.shift()?.trim(); body = parts.join("|").trim() || target || "";
        if (target) { kind = start[0] === "!" ? "wiki-embed" : "wikilink"; to = end + 2; }
      }
    } else if (start === "[^" || start === "^[") {
      let depth = 1;
      for (let end = from + 2; end < text.length; end++) {
        if (escaped(text, end)) continue;
        if (text[end] === "[") depth++;
        if (text[end] === "]" && --depth === 0) { to = end + 1; break; }
      }
      if (to > 0) { body = text.slice(from + 2, to - 1); kind = start === "[^" ? "footnote-ref" : "inline-footnote"; target = body; }
    } else if (start === "[!") {
      const header = /^\[![a-z0-9_-]+\][+-]?[^\n]*/i.exec(text.slice(from));
      if (header) { kind = "callout-marker"; body = header[0]; to = from + header[0].length; }
    } else if (start === "$" && text[from - 1] !== "$" && !/\s/.test(text[from + 1] ?? " ")) {
      const width = text[from + 1] === "$" ? 2 : 1;
      for (let end = from + width; end < text.length; end++) {
        if (text[end] === "\n" && width === 1) break;
        if (text.startsWith("$".repeat(width), end) && !escaped(text, end) && end > from + width && !/\s/.test(text[end - 1])) {
          body = text.slice(from + width, end); kind = width === 2 ? "display-math" : "math"; to = end + width; break;
        }
      }
    }
    if (to > from) { result.push({ from, to, source: text.slice(from, to), body, target, kind }); pattern.lastIndex = to; }
  }
  return result;
}

/** Keep Mint syntax intact before Markdown's link/emphasis tokenizers. */
export function opaqueMintSyntax(md: MarkdownIt): void {
  const textRule = md.inline.ruler.getRules("")[0];
  md.inline.ruler.before("text", "mint_literal", (state, silent) => {
    const literal = literals(state.src.slice(state.pos, state.posMax))[0];
    if (!literal || literal.from !== 0) return false;
    if (!silent) { const token = state.push("mint_literal", "", 0); token.content = literal.source; }
    state.pos += literal.to; return true;
  });
  md.inline.ruler.at("text", (state, silent) => {
    const next = literals(state.src.slice(state.pos, state.posMax))[0];
    const end = state.posMax;
    if (next && next.from > 0) state.posMax = state.pos + next.from;
    try { return textRule(state, silent); } finally { state.posMax = end; }
  });
}
export const mintSyntax: FeatureSpec = {
  name: "mint-syntax", mdItPlugins: [opaqueMintSyntax],
  parserTokens: { mint_literal: (state, token) => state.addText(token.content) }
};

export function literalFeature(name: string, kinds: readonly string[]): FeatureSpec {
  return { name, inline: {
    priority: 0.1, markNames: [],
    scan(text, consumed) {
      const output: InlineSpan[] = [];
      for (const literal of literals(text)) {
        if (!kinds.includes(literal.kind) || consumed.slice(literal.from, literal.to).some(Boolean)) continue;
        markConsumed(consumed, literal.from, literal.to);
        const hidden = literal.kind !== "callout-marker";
        output.push({ type: name, from: literal.from, to: literal.to, openFrom: literal.from, openTo: literal.from, closeFrom: literal.to, closeTo: literal.to,
          delimRanges: hidden ? [{ from: literal.from, to: literal.to, softInside: true }] : [],
          widgetDecorations: hidden && literal.kind !== "comment" ? [{ pos: literal.from, when: "outside", kind: `mint-${literal.kind}`, attrs: { source: literal.body, target: literal.target ?? "", full: literal.source }, side: -1 }] : [] });
      }
      return output;
    },
    extRanges: parent => literals(parent.textContent).filter(literal => kinds.includes(literal.kind)).map(literal => [literal.from, literal.to])
  } };
}
