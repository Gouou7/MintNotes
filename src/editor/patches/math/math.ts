import { literalFeature } from "./syntax.ts";
import { rawBlockFeature, blockPreviewPlugin } from "./blocks.ts";
import type { FeatureSpec } from "../features/_types.ts";
export const inlineMath = literalFeature("mint-math", ["math", "display-math"]);
export const blockMath: FeatureSpec = { ...rawBlockFeature("mint_math_block", /^\$\$(?:[\s\S]*\$\$\s*$|\s*$)/, "$$"),
  plugins: (_schema, context = {}) => [blockPreviewPlugin("mint_math_block", (host, source) => context.renderMath?.(host, source.replace(/^\$\$\s*/, "").replace(/\s*\$\$$/, ""), true), context)]
};
