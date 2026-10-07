import { blockPreviewPlugin } from "./blocks.ts";
import { CodeBlockView } from "../features/fenced-code.ts";
import { Plugin } from "prosemirror-state";
import type { FeatureSpec } from "../features/_types.ts";
export const mermaid: FeatureSpec = { name: "mint-mermaid", plugins: (_schema, context = {}) => {
  const isMermaid = (node: import("prosemirror-model").Node) => String(node.attrs.lang).trim().toLowerCase().split(/\s/)[0] === "mermaid";
  const plugin = blockPreviewPlugin("code_block", (host, source) => context.renderMermaid?.(host, source), context, isMermaid);
  const factory = plugin.props.nodeViews!.code_block;
  return [new Plugin({ props: {
    ...plugin.props,
    nodeViews: { code_block: (node, view, getPos, decorations, inner) => {
      if (isMermaid(node)) {
        const preview = factory(node, view, getPos, decorations, inner), update = preview.update;
        preview.update = (...args) => isMermaid(args[0]) && (update?.(...args) ?? false); return preview;
      }
      const ordinary = new CodeBlockView(node, view, getPos, decorations, context), update = ordinary.update.bind(ordinary);
      ordinary.update = (next, decorations) => !isMermaid(next) && update(next, decorations); return ordinary;
    } }
  } })];
} };
