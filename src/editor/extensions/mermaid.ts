import { parseFencedCodeSource } from "../core/fenced-code-source";
import { isLiveSyntaxEditing, type BlockSourcePresentation, type EditorExtension } from "../core/lib";

export interface MermaidExtensionOptions {
  render?: (container: HTMLElement, source: string) => void | (() => void);
}

function mermaidPresentation(
  render: NonNullable<MermaidExtensionOptions["render"]>,
): BlockSourcePresentation<{ language: "mermaid" }> {
  return {
    id: "mint-mermaid-block",
    nodeTypes: ["code_block"],
    sourceClassName: "live-mermaid-source",
    widgetClassName: "live-mermaid-widget",
    match(source, context) {
      if (isLiveSyntaxEditing(context.attributes.liveSyntaxState)) return null;
      const fenced = parseFencedCodeSource(source);
      if (!fenced || fenced.lang.toLowerCase() !== "mermaid") return null;
      return {
        source,
        renderSource: fenced.body,
        key: source,
        data: { language: "mermaid" },
      };
    },
    render: (container, match) => render(container, match.renderSource),
  };
}

export function createMermaidExtension(
  options: MermaidExtensionOptions = {},
): EditorExtension {
  return {
    id: "mint-mermaid",
    presentations: {
      block: options.render ? [mermaidPresentation(options.render)] : [],
    },
  };
}
