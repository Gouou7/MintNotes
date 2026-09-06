import { parseFencedCodeSource } from "./core/fenced-code-source";
export function readingPosition(source: string, from: number, to: number) {
  const point = (offset: number) => {
    const before = source.slice(0, offset);
    const endings = [...before.matchAll(/\r\n|\r|\n/g)];
    const last = endings.at(-1);
    return { offset, line: endings.length + 1, column: offset - (last ? last.index + last[0].length : 0) + 1 };
  };
  return { start: point(from), end: point(to) };
}

export type SourcePiece = { from: number; to: number } | { text: string };
export type ReadingReplacement = { from: number; to: number; pieces: SourcePiece[] };

/** Provenance is carried by the transform that creates each displayed character. */
export class ReadingSource {
  constructor(readonly text: string, readonly offsets: readonly (number | null)[], readonly ends: readonly (number | null)[] = offsets) {}

  static authored(text: string, offset = 0): ReadingSource {
    return new ReadingSource(text, Array.from({ length: text.length + 1 }, (_, i) => offset + i));
  }

  replace(replacements: readonly ReadingReplacement[]): ReadingSource {
    let text = "";
    const offsets: (number | null)[] = [];
    const ends: (number | null)[] = [];
    const append = (piece: SourcePiece) => {
      const value = "text" in piece ? piece.text : this.text.slice(piece.from, piece.to);
      const mapping = "text" in piece ? Array(value.length + 1).fill(null) : this.offsets.slice(piece.from, piece.to + 1);
      // Every character owns its starting boundary. The final boundary is appended below.
      text += value;
      offsets.push(...mapping.slice(0, -1));
      const ending = "text" in piece ? Array(value.length).fill(null) : this.ends.slice(piece.from + 1, piece.to + 1);
      ends.push(...ending);
      return mapping.at(-1) ?? null;
    };
    let cursor = 0;
    let end: number | null = 0;
    for (const replacement of replacements) {
      end = append({ from: cursor, to: replacement.from });
      for (const piece of replacement.pieces) end = append(piece);
      cursor = replacement.to;
    }
    if (cursor < this.text.length) end = append({ from: cursor, to: this.text.length });
    offsets.push(end);
    return new ReadingSource(text, offsets, [offsets[0] ?? null, ...ends]);
  }
}

interface HtmlNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

function decodedBoundaries(raw: string, value: string, quoteDepth = 0): { starts: number[]; ends: number[] } | null {
  if (raw === value) {
    const identity = Array.from({ length: raw.length + 1 }, (_, i) => i);
    return { starts: identity, ends: identity };
  }
  const offsets: number[] = [];
  const ends: number[] = [0];
  let decoded = "";
  for (let i = 0; i < raw.length;) {
    if (i > 0 && /[\r\n]/.test(raw[i - 1]!) && quoteDepth) {
      for (let depth = 0; depth < quoteDepth; depth++) {
        const prefix = /^[\t ]*>[\t ]?/.exec(raw.slice(i));
        if (!prefix) break;
        i += prefix[0].length;
      }
      if (i === raw.length) break;
    }
    const escape = /^\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/.exec(raw.slice(i));
    const entity = /^&(?:#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/.exec(raw.slice(i));
    let result = raw[i]!;
    let length = 1;
    if (escape) { result = escape[1]!; length = escape[0].length; }
    else if (entity) {
      const decoder = document.createElement("textarea");
      decoder.innerHTML = entity[0];
      result = decoder.value;
      length = entity[0].length;
    } else if (raw.startsWith("\r\n", i)) { result = "\n"; length = 2; }
    for (let j = 0; j < result.length; j++) { offsets.push(i); ends.push(i + length); }
    decoded += result;
    i += length;
  }
  offsets.push(raw.length);
  return decoded === value ? { starts: offsets, ends } : null;
}

export function rehypeReadingSource({ projection }: { projection: ReadingSource }) {
  return (tree: HtmlNode) => {
    const visit = (node: HtmlNode, parent?: HtmlNode, quoteDepth = 0) => {
      if (!node.children) return;
      if (node.tagName === "blockquote") quoteDepth++;
      const nodeFrom = node.position?.start.offset;
      const nodeTo = node.position?.end.offset;
      if (nodeFrom !== undefined && nodeTo !== undefined && node.type === "element") {
        node.properties = { ...node.properties,
          "data-source-from": projection.offsets[nodeFrom], "data-source-to": projection.ends[nodeTo],
        };
      }
      const classes = Array.isArray(node.properties?.className) ? node.properties.className : [];
      if (classes.some((name) => ["language-mermaid", "math-inline", "math-display"].includes(String(name)))) return;
      node.children = node.children.map((child) => {
        let suffix = "";
        if (child.type !== "text" || !child.value) { visit(child, node, quoteDepth); return child; }
        let from = child.position?.start.offset;
        let to = child.position?.end.offset;
        if (node.tagName === "code") {
          from = nodeFrom ?? parent?.position?.start.offset;
          to = nodeTo ?? parent?.position?.end.offset;
          if (from !== undefined && to !== undefined) {
            const raw = projection.text.slice(from, to);
            const fence = parseFencedCodeSource(raw);
            if (fence) {
              to = from + fence.bodyTo;
              from += fence.bodyFrom;
              // markdown-to-HAST appends a display-only code newline.
              if (child.value === fence.body + "\n") { child.value = fence.body; suffix = "\n"; }
            } else {
              const ticks = /^`+/.exec(raw)?.[0];
              if (ticks && raw.endsWith(ticks)) { from += ticks.length; to -= ticks.length; }
            }
          }
        }
        if (from === undefined || to === undefined) return child;
        const raw = projection.text.slice(from, to);
        let boundaries = decodedBoundaries(raw, child.value, quoteDepth);
        if (!boundaries) {
          // No proven text map: expose this leaf's authored source, never guess.
          child.value = raw;
          const identity = Array.from({ length: raw.length + 1 }, (_, i) => i);
          boundaries = { starts: identity, ends: identity };
        }
        if (suffix) { child.value += suffix; boundaries.starts.push(raw.length); boundaries.ends.push(raw.length); }
        const positions = boundaries.starts.map((offset) => projection.offsets[from! + offset]);
        const ends = boundaries.ends.map((offset) => projection.ends[from! + offset]);
        if ([...positions, ...ends].some((offset) => offset === null || offset === undefined)) return child;
        return { type: "element", tagName: "span", properties: {
          "data-source-offsets": positions.join(","), "data-source-ends": ends.join(","),
        }, children: [child] };
      });
    };
    visit(tree);
  };
}

export function readingSelection(root: HTMLElement): { anchor: number; head: number } | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed) return null;
  const point = (node: Node | null, offset: number, end: boolean): number | null => {
    if (!node || !root.contains(node)) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const mapped = element?.closest<HTMLElement>("[data-source-offsets]");
    if (!mapped) {
      const atomic = element?.closest<HTMLElement>("[data-source-atomic][data-source-from][data-source-to]");
      if (atomic) {
        const value = Number(end ? atomic.dataset.sourceTo : atomic.dataset.sourceFrom);
        return Number.isFinite(value) ? value : null;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const child = node.childNodes[end ? offset - 1 : offset];
        if (child) {
          let leaf = child;
          while (end ? leaf.lastChild : leaf.firstChild) leaf = (end ? leaf.lastChild : leaf.firstChild)!;
          return point(leaf, end ? leaf.textContent?.length ?? 0 : 0, end);
        }
      }
      return null;
    }
    let index = node.nodeType === Node.TEXT_NODE ? offset : [...node.childNodes].slice(0, offset)
      .reduce((length, child) => length + (child.textContent?.length ?? 0), 0);
    for (let current: Node = node; current !== mapped;) {
      for (let previous = current.previousSibling; previous; previous = previous.previousSibling) index += previous.textContent?.length ?? 0;
      if (!current.parentNode) return null;
      current = current.parentNode;
    }
    const value = (end ? mapped.dataset.sourceEnds : mapped.dataset.sourceOffsets)?.split(",")[index];
    return value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
  };
  const range = selection.getRangeAt(0);
  const forward = range.startContainer === selection.anchorNode && range.startOffset === selection.anchorOffset;
  const from = point(range.startContainer, range.startOffset, false);
  const to = point(range.endContainer, range.endOffset, true);
  return from === null || to === null ? null : forward ? { anchor: from, head: to } : { anchor: to, head: from };
}
