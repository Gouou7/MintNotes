import { restoreParserSource } from "./core/parser-source-protection";

interface MarkdownNode {
  value?: string;
  url?: string;
  title?: string | null;
  label?: string;
  identifier?: string;
  children?: MarkdownNode[];
}

/** Restore authored text before any reading transform or source mapping runs. */
export function remarkReadingListMarkers({ source, restoration }: {
  source: string;
  restoration: ReadonlyMap<string, string>;
}) {
  return (tree: MarkdownNode, file: { value: unknown }) => {
    const restore = (node: MarkdownNode): void => {
      for (const field of ["value", "url", "title", "label", "identifier"] as const) {
        if (typeof node[field] === "string") node[field] = restoreParserSource(node[field], restoration);
      }
      node.children?.forEach(restore);
    };
    restore(tree);
    file.value = source;
  };
}
