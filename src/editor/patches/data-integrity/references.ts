import referenceRule from "markdown-it/lib/rules_block/reference.mjs";
import type { FeatureSpec } from "../features/_types.ts";
/** Keep every consumed definition, including duplicate labels and unused URLs. */
export const referenceDefinitions: FeatureSpec = {
  name: "mint-reference-definitions",
  nodes: { mint_reference_definition: { group: "block", content: "text*", code: true, marks: "", toDOM: () => ["pre", { class: "mint-reference-definition" }, ["code", 0]] } },
  mdItPlugins: [md => md.block.ruler.at("reference", (state, start, end, silent) => {
    const consumed = referenceRule(state, start, end, silent);
    if (consumed && !silent) {
      const token = state.push("mint_reference_definition", "", 0); token.block = true;
      token.content = state.getLines(start, state.line, state.blkIndent, false).replace(/\n$/, ""); token.map = [start, state.line];
    }
    return consumed;
  })],
  parserTokens: { mint_reference_definition: (state, token, schema) => state.push(schema.nodes.mint_reference_definition.create(null, token.content ? schema.text(token.content) : undefined)) },
  blockHandlers: { mint_reference_definition: (state, node) => { state.write(node.textContent.replace(/\n/g, "\n" + state.delim)); state.advance(node.content.size); state.closeBlock(node); } },
};
