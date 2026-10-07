import type { InlineSpan } from "../inline-parse.ts";
import { InputRule } from "prosemirror-inputrules";
import { canJoin, findWrapping } from "prosemirror-transform";
import type { FeatureSpec } from "../features/_types.ts";

/** Keep authored quote escapes as source, so disabling automatic escaping does not turn them into quotes. */
export const blockquoteInput: FeatureSpec = {
  name: "mint-blockquote-input",
  inputRules: schema => {
    // Native DOM updates can batch the space with following characters. Keep
    // their text and use the same wrapping/join semantics as the upstream rule.
    return [new InputRule(/^> (.*)$/, (state, match, start, end) => {
      const transaction = state.tr.insertText(match[1], start, end);
      const range = transaction.doc.resolve(start).blockRange();
      const wrapping = range && findWrapping(range, schema.nodes.blockquote);
      if (!wrapping) return null;
      transaction.wrap(range!, wrapping);
      const before = transaction.doc.resolve(start - 1).nodeBefore;
      if (before?.type === schema.nodes.blockquote && canJoin(transaction.doc, start - 1)) transaction.join(start - 1);
      return transaction;
    })];
  },
  mdItPlugins: [md => {
    md.inline.ruler.before("escape", "mint_quote_escape", (state, silent) => {
      const match = /^\\+>/.exec(state.src.slice(state.pos, state.posMax));
      if (!match) return false;
      if (!silent) { const token = state.push("mint_quote_escape", "", 0); token.content = match[0]; }
      state.pos += match[0].length; return true;
    });
  }],
  parserTokens: { mint_quote_escape: (state, token) => state.addText(token.content) },
  inline: {
    priority: 0.05, markNames: [],
    scan(text, consumed) {
      const spans: InlineSpan[] = [];
      for (const match of text.matchAll(/\\+>/g)) {
        const from = match.index, to = from + match[0].length;
        if (consumed.slice(from, to).some(Boolean)) continue;
        // This only decorates escape characters. Claiming them would prevent
        // later link/image scanners from recognizing an escaped URL delimiter.
        const delimRanges: NonNullable<InlineSpan["delimRanges"]> = [];
        for (let i = from; i < to - 1; i += 2) delimRanges.push({ from: i, to: i + 1, softInside: true });
        spans.push({ type: "mint-quote-escapes", from, to, openFrom: from, openTo: from, closeFrom: to, closeTo: to, delimRanges });
      }
      return spans;
    },
    extRanges: parent => [...parent.textContent.matchAll(/\\+>/g)].map(match => [match.index, match.index + match[0].length])
  }
};
