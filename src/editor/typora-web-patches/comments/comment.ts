import { literalFeature, literals } from "./syntax.ts";
import { rawBlockFeature, blockPreviewPlugin } from "./blocks.ts";
import type { FeatureSpec } from "../features/_types.ts";
const block = rawBlockFeature("mint_comment_block", /%%/);
const commentBlock: FeatureSpec = { ...block,
  mdItPlugins: [md => md.block.ruler.before("paragraph", "mint_comment_block", (state, start, end, silent) => {
    const offset = state.bMarks[start] + state.tShift[start];
    const source = state.src.slice(offset);
    const comment = literals(source).find(literal => literal.kind === "comment" && literal.source.includes("\n\n"));
    if (!comment || comment.from > state.eMarks[start] - offset || state.sCount[start] - state.blkIndent >= 4) return false;
    if (silent) return true;
    let next = start + 1;
    while (next < end && state.bMarks[next] - offset < comment.to) next++;
    while (next < end && !state.isEmpty(next)) next++;
    const token = state.push("mint_comment_block", "", 0); token.block = true;
    token.content = state.getLines(start, next, state.blkIndent, false); token.map = [start, next]; state.line = next; return true;
  }, { alt: ["paragraph", "blockquote", "list"] })],
  plugins: (_schema, context = {}) => [blockPreviewPlugin("mint_comment_block", (host, source) => {
    let shown = source;
    for (const range of literals(source).filter(literal => literal.kind === "comment").reverse()) shown = shown.slice(0, range.from) + shown.slice(range.to);
    if (context.renderMarkdown) return context.renderMarkdown(host, shown); host.textContent = shown;
  }, context)]
};
export const comment: FeatureSpec = { ...literalFeature("mint-comment", ["comment"]), nodes: commentBlock.nodes, mdItPlugins: commentBlock.mdItPlugins, parserTokens: commentBlock.parserTokens, blockHandlers: commentBlock.blockHandlers, plugins: commentBlock.plugins };
