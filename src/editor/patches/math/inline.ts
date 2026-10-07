import type { FeatureSpec } from "../features/_types.ts";
import { markConsumed, type InlineSpan } from "../inline-parse.ts";
import { literals } from "./syntax.ts";

export const inlineMath: FeatureSpec = {
  name: "mint-math",
  mdItPlugins: [md => md.inline.ruler.before("escape", "mint_math_escape", (state, silent) => {
    const match = /^\\+\$/.exec(state.src.slice(state.pos, state.posMax));
    if (!match) return false;
    if (!silent) { const token = state.push("mint_literal", "", 0); token.content = match[0]; }
    state.pos += match[0].length; return true;
  })],
  inline: {
    // The shared lexer already excludes literal code. Claim a formula
    // before Markdown code/emphasis scanners can interpret its TeX body.
    priority: -0.1, markNames: [],
    scan(text, consumed) {
      const spans: InlineSpan[] = [];
      for (const literal of literals(text)) {
        if (!["math", "display-math", "math-draft"].includes(literal.kind) || consumed.slice(literal.from, literal.to).some(Boolean)) continue;
        markConsumed(consumed, literal.from, literal.to);
        const draft = literal.kind === "math-draft", width = literal.source.startsWith("$$") ? 2 : 1;
        const contentFrom = literal.from + width, contentTo = contentFrom + literal.body.length;
        spans.push({ type: "mint-math", from: literal.from, to: literal.to, openFrom: literal.from, openTo: literal.from,
          closeFrom: literal.to, closeTo: literal.to,
          delimRanges: [
            { from: literal.from, to: contentFrom, forceVisible: draft, revealOnSelection: true },
            ...!draft && contentFrom < contentTo ? [{ from: contentFrom, to: contentTo, softInside: true, revealOnSelection: true }] : [],
            ...!draft ? [{ from: contentTo, to: literal.to, revealOnSelection: true }] : [],
          ],
          widgetDecorations: draft ? [] : [{ pos: literal.from, when: "outside", kind: `mint-${literal.kind}`, revealOnSelection: true,
            attrs: { source: literal.body, full: literal.source }, side: -1 }] });
      }
      return spans;
    },
    extRanges: parent => [
      ...literals(parent.textContent).filter(literal => ["math", "display-math", "math-draft"].includes(literal.kind)).map(literal => [literal.from, literal.to] as [number, number]),
      ...[...parent.textContent.matchAll(/\\+\$/g)].map(match => [match.index, match.index + match[0].length] as [number, number]),
    ],
  },
};
