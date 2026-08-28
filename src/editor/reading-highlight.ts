interface MdPosition {
  readonly start?: { readonly offset?: number };
  readonly end?: { readonly offset?: number };
}

interface MdNode {
  type: string;
  value?: string;
  position?: MdPosition;
  children?: MdNode[];
  data?: {
    hName?: string;
  };
}

interface Delimiter {
  childIndex: number;
  offset: number;
  length: number;
  canOpen: boolean;
  canClose: boolean;
}

interface HighlightRange {
  open: Delimiter;
  close: Delimiter;
}

const SKIPPED_CONTAINERS = new Set(["code", "inlineCode", "html"]);

function nodeText(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(nodeText).join("");
}

function authoredText(node: MdNode, source: string): boolean {
  const from = node.position?.start?.offset;
  const to = node.position?.end?.offset;
  if (typeof from !== "number" || typeof to !== "number") return true;
  return source.slice(from, to) === node.value;
}

function characterBefore(children: MdNode[], childIndex: number, offset: number): string {
  const value = children[childIndex]?.value ?? "";
  if (offset > 0) return value[offset - 1] ?? " ";
  for (let index = childIndex - 1; index >= 0; index -= 1) {
    const text = nodeText(children[index]!);
    if (text) return text[text.length - 1] ?? " ";
  }
  return " ";
}

function characterAfter(children: MdNode[], childIndex: number, offset: number): string {
  const value = children[childIndex]?.value ?? "";
  if (offset < value.length) return value[offset] ?? " ";
  for (let index = childIndex + 1; index < children.length; index += 1) {
    const text = nodeText(children[index]!);
    if (text) return text[0] ?? " ";
  }
  return " ";
}

function delimiters(children: MdNode[], source: string): Delimiter[] {
  const found: Delimiter[] = [];
  children.forEach((child, childIndex) => {
    if (child.type !== "text" || typeof child.value !== "string" || !authoredText(child, source)) return;
    for (let offset = 0; offset < child.value.length;) {
      if (child.value[offset] !== "=") {
        offset += 1;
        continue;
      }
      let end = offset + 1;
      while (child.value[end] === "=") end += 1;
      const length = end - offset;
      if (length >= 2) {
        found.push({
          childIndex,
          offset,
          length,
          canOpen: !/\s/.test(characterAfter(children, childIndex, end)),
          canClose: !/\s/.test(characterBefore(children, childIndex, offset)),
        });
      }
      offset = end;
    }
  });
  return found;
}

function textBetween(children: MdNode[], open: Delimiter, close: Delimiter): string {
  if (open.childIndex === close.childIndex) {
    return (children[open.childIndex]?.value ?? "").slice(open.offset + 2, close.offset + close.length - 2);
  }
  const parts = [
    (children[open.childIndex]?.value ?? "").slice(open.offset + 2),
    ...children.slice(open.childIndex + 1, close.childIndex).map(nodeText),
    (children[close.childIndex]?.value ?? "").slice(0, close.offset + close.length - 2),
  ];
  return parts.join("");
}

function findHighlight(children: MdNode[], source: string): HighlightRange | null {
  const runs = delimiters(children, source);
  for (let openIndex = 0; openIndex < runs.length; openIndex += 1) {
    const open = runs[openIndex]!;
    if (!open.canOpen) continue;
    for (let closeIndex = openIndex + 1; closeIndex < runs.length; closeIndex += 1) {
      const close = runs[closeIndex]!;
      if (!close.canClose) continue;
      const inner = textBetween(children, open, close);
      if (!inner || /\s/.test(inner[0]!) || /\s/.test(inner[inner.length - 1]!) || inner.includes("=")) continue;
      return { open, close };
    }
  }
  return null;
}

function textNode(value: string): MdNode[] {
  return value ? [{ type: "text", value }] : [];
}

function wrapHighlight(children: MdNode[], range: HighlightRange): MdNode[] {
  const { open, close } = range;
  const openValue = children[open.childIndex]?.value ?? "";
  const closeValue = children[close.childIndex]?.value ?? "";
  const before = [
    ...children.slice(0, open.childIndex),
    ...textNode(openValue.slice(0, open.offset)),
  ];
  const inside = open.childIndex === close.childIndex
    ? textNode(openValue.slice(open.offset + 2, close.offset + close.length - 2))
    : [
        ...textNode(openValue.slice(open.offset + 2)),
        ...children.slice(open.childIndex + 1, close.childIndex),
        ...textNode(closeValue.slice(0, close.offset + close.length - 2)),
      ];
  const after = [
    ...textNode(closeValue.slice(close.offset + close.length)),
    ...children.slice(close.childIndex + 1),
  ];
  return [
    ...before,
    { type: "highlight", children: inside, data: { hName: "mark" } },
    ...after,
  ];
}

function transformHighlights(node: MdNode, source: string): void {
  if (!node.children || SKIPPED_CONTAINERS.has(node.type) || node.type === "highlight") return;
  for (const child of node.children) transformHighlights(child, source);
  let range = findHighlight(node.children, source);
  while (range) {
    node.children = wrapHighlight(node.children, range);
    range = findHighlight(node.children, source);
  }
}

/** Render Typora-style ==highlight== markers without changing canonical Markdown. */
export function remarkReadingHighlight() {
  return (tree: MdNode, file: { value?: unknown }) => {
    transformHighlights(tree, String(file.value ?? ""));
  };
}
