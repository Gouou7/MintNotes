interface MdPosition {
  readonly start?: { readonly offset?: number };
  readonly end?: { readonly offset?: number };
}

interface MdNode {
  readonly type: string;
  readonly position?: MdPosition;
  readonly children?: MdNode[];
  data?: {
    hProperties?: Record<string, unknown>;
  };
}

function authoredBlankRows(source: string, previous: MdNode, current: MdNode): number {
  const from = previous.position?.end?.offset;
  const to = current.position?.start?.offset;
  if (typeof from !== "number" || typeof to !== "number" || from > to) return 0;
  const separator = source.slice(from, to);
  if (/[^\t \r\n]/.test(separator)) return 0;
  const lineEndings = separator.match(/\r\n|\r|\n/g)?.length ?? 0;
  return Math.max(0, lineEndings - 1);
}

function markListSpacing(node: MdNode, source: string): void {
  if (node.type === "list") {
    for (let index = 1; index < (node.children?.length ?? 0); index += 1) {
      const previous = node.children![index - 1]!;
      const current = node.children![index]!;
      const blankRows = authoredBlankRows(source, previous, current);
      if (blankRows === 0) continue;
      current.data ??= {};
      current.data.hProperties = {
        ...(current.data.hProperties ?? {}),
        "data-list-gap-before": String(blankRows),
      };
    }
  }
  for (const child of node.children ?? []) markListSpacing(child, source);
}

/** Preserve authored list-item gaps without making every loose-list item look separated. */
export function remarkReadingListSpacing() {
  return (tree: MdNode, file: { value?: unknown }) => {
    markListSpacing(tree, String(file.value ?? ""));
  };
}
