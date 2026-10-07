import type { FeatureSpec } from "../features/_types.ts";
import { mathAt, mathBlockSource } from "./math-syntax.ts";
import { mathBehavior } from "./math-behavior.ts";
import { mathBlockView } from "./math-view.ts";

export const blockMath: FeatureSpec = {
  name: "mint_math_block",
  nodes: { mint_math_block: {
    group: "block", content: "text*", code: true, marks: "", defining: true,
    toDOM: () => ["pre", { class: "mint_math_block" }, ["code", 0]],
  } },
  mdItPlugins: [md => md.block.ruler.before("reference", "mint_math_block", (state, start, end, silent) => {
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const opening = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    if (!/^\$\$(?!\$)/.test(opening)) return false;
    const source = state.getLines(start, end, state.blkIndent, false);
    const from = /^[ \t]*/.exec(source)![0].length;
    const math = mathAt(source, from);
    if (!math || math.kind !== "display-math" || source.slice(math.to).split("\n")[0].trim() || !mathBlockSource(source.slice(0, math.to))) return false;
    if (silent) return true;
    const next = start + source.slice(0, math.to).split("\n").length;
    const token = state.push("mint_math_block", "", 0);
    token.block = true; token.content = state.getLines(start, next, state.blkIndent, false);
    token.map = [start, next]; state.line = next;
    return true;
  }, { alt: ["paragraph", "blockquote", "list"] })],
  parserTokens: { mint_math_block: (state, token, schema) => state.push(schema.nodes.mint_math_block.create(null,
    token.content ? schema.text(token.content) : undefined)) },
  blockHandlers: { mint_math_block: (state, node) => {
    // One separator line also keeps a formula after an empty list marker
    // inside its item. A blank line would end that empty item on reparse.
    if (/(?:^|\n)[ >]*(?:- |\d+\. +)$/.test(state.out)) state.flushClose(true);
    state.write(node.textContent.replace(/\n/g, "\n" + state.delim));
    state.advance(node.content.size); state.closeBlock(node);
  } },
  plugins: (_schema, context = {}) => [mathBehavior(context), mathBlockView(context)],
};
