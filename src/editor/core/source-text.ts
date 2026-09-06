import type { SourceEdit, SourceSelection } from "./source";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Offsets remain UTF-16; navigation and deletion use user-perceived characters. */
export function adjacentGrapheme(source: string, offset: number, direction: -1 | 1): number {
  const at = Math.max(0, Math.min(offset, source.length));
  let previous = 0;
  for (const segment of graphemes.segment(source)) {
    const end = segment.index + segment.segment.length;
    if (direction < 0 && end >= at) return segment.index < at ? segment.index : previous;
    if (direction > 0 && end > at) return end;
    previous = segment.index;
  }
  return direction < 0 ? previous : source.length;
}

/** One native textarea input is one replacement, including an entire IME commit. */
export function changedSourceRange(before: string, after: string): SourceEdit {
  let from = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from++;
  let to = before.length;
  let end = after.length;
  while (to > from && end > from && before[to - 1] === after[end - 1]) { to--; end--; }
  return { from, to, insert: after.slice(from, end) };
}

export function textareaSelection(textarea: HTMLTextAreaElement): SourceSelection {
  const from = textarea.selectionStart;
  const to = textarea.selectionEnd;
  return textarea.selectionDirection === "backward"
    ? { anchor: to, head: from }
    : { anchor: from, head: to };
}

export function selectTextarea(textarea: HTMLTextAreaElement, selection: SourceSelection): void {
  textarea.setSelectionRange(Math.min(selection.anchor, selection.head), Math.max(selection.anchor, selection.head),
    selection.anchor > selection.head ? "backward" : "forward");
}

/** Textarea values normalize CR/CRLF to LF. That is a display projection, never a save. */
export class TextareaSourceMap {
  readonly text: string;
  readonly boundaries: number[] = [0];
  constructor(source: string) {
    let text = "";
    for (let i = 0; i < source.length; i++) {
      const character = source[i]!;
      text += character === "\r" ? "\n" : character;
      if (character === "\r" && source[i + 1] === "\n") i++;
      this.boundaries.push(i + 1);
    }
    this.text = text;
  }
  sourceOffset(display: number): number { return this.boundaries[Math.min(display, this.text.length)]!; }
  displayOffset(source: number): number {
    const index = this.boundaries.findIndex((offset) => offset >= source);
    return index < 0 ? this.text.length : index;
  }
}
