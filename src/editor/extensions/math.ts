import type {
  BlockSourcePresentation,
  EditorExtension,
  InlineSourcePresentation,
} from "../core/lib";
import { parseFencedCodeSource } from "../core/fenced-code-source";

export interface MathExtensionOptions {
  renderInline?: (container: HTMLElement, source: string) => void | (() => void);
  renderBlock?: (container: HTMLElement, source: string) => void | (() => void);
}

function inlineMathPresentation(
  render: NonNullable<MathExtensionOptions["renderInline"]>,
): InlineSourcePresentation<{ kind: "inline-math" }> {
  return {
    id: "mint-math-inline",
    sourceClassName: "live-inline-math-source",
    widgetClassName: "live-inline-math-widget",
    find(source) {
      const matches = [];
      for (let from = 0; from < source.length; from += 1) {
        if (
          source[from] !== "$"
          || source[from + 1] === "$"
          || (from > 0 && source[from - 1] === "\\")
          || /\s/.test(source[from + 1] ?? "")
        ) continue;
        for (let to = from + 1; to < source.length; to += 1) {
          if (
            source[to] !== "$"
            || source[to - 1] === "\\"
            || source[to + 1] === "$"
            || /\s/.test(source[to - 1] ?? "")
          ) continue;
          const authored = source.slice(from, to + 1);
          const body = source.slice(from + 1, to);
          matches.push({
            from,
            to: to + 1,
            source: authored,
            renderSource: body,
            key: authored,
            data: { kind: "inline-math" as const },
          });
          from = to;
          break;
        }
      }
      return matches;
    },
    render: (container, match) => render(container, match.renderSource),
  };
}

function blockMathPresentation(
  render: NonNullable<MathExtensionOptions["renderBlock"]>,
): BlockSourcePresentation<{ kind: "paragraph" | "fenced" }> {
  return {
    id: "mint-math-block",
    nodeTypes: ["paragraph", "code_block"],
    sourceClassName: "live-math-block-source",
    widgetClassName: "live-math-block-widget",
    match(source, context) {
      if (context.nodeType === "paragraph") {
        const matched = /^\$\$([^\n]+)\$\$$/.exec(source);
        if (!matched) return null;
        return {
          source,
          renderSource: matched[1]!,
          key: source,
          data: { kind: "paragraph" },
        };
      }
      if (context.attributes.sourceEditing === true) return null;
      const fenced = parseFencedCodeSource(source);
      if (!fenced || fenced.lang.toLowerCase() !== "mint-math") return null;
      return {
        source,
        renderSource: fenced.body,
        key: source,
        data: { kind: "fenced" },
      };
    },
    render: (container, match) => render(container, match.renderSource),
  };
}

export function createMathExtension(
  options: MathExtensionOptions = {},
): EditorExtension {
  return {
    id: "mint-math",
    presentations: {
      inline: options.renderInline ? [inlineMathPresentation(options.renderInline)] : [],
      block: options.renderBlock ? [blockMathPresentation(options.renderBlock)] : [],
    },
  };
}
