import {
  CanonicalSource,
  type SourceEdit,
  type SourceSelection,
  type SourceTransaction,
} from "./source";

type CompositionSegment =
  | { readonly kind: "base"; readonly from: number; readonly to: number }
  | { readonly kind: "insert"; readonly text: string };

function segmentLength(segment: CompositionSegment): number {
  return segment.kind === "base" ? segment.to - segment.from : segment.text.length;
}

function splitSegmentsAt(segments: CompositionSegment[], offset: number): number {
  let position = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const end = position + segmentLength(segment);
    if (offset === position) return index;
    if (offset === end) return index + 1;
    if (offset < end) {
      const localOffset = offset - position;
      const replacement: CompositionSegment[] = segment.kind === "base"
        ? [
            { kind: "base", from: segment.from, to: segment.from + localOffset },
            { kind: "base", from: segment.from + localOffset, to: segment.to },
          ]
        : [
            { kind: "insert", text: segment.text.slice(0, localOffset) },
            { kind: "insert", text: segment.text.slice(localOffset) },
          ];
      segments.splice(index, 1, ...replacement);
      return index + 1;
    }
    position = end;
  }
  if (offset === position) return segments.length;
  throw new RangeError(`Composition offset ${offset} is outside the current source`);
}

function compactSegments(segments: CompositionSegment[]): CompositionSegment[] {
  const compacted: CompositionSegment[] = [];
  for (const segment of segments) {
    if (segmentLength(segment) === 0) continue;
    const previous = compacted.at(-1);
    if (previous?.kind === "base" && segment.kind === "base" && previous.to === segment.from) {
      compacted[compacted.length - 1] = { kind: "base", from: previous.from, to: segment.to };
    } else if (previous?.kind === "insert" && segment.kind === "insert") {
      compacted[compacted.length - 1] = { kind: "insert", text: previous.text + segment.text };
    } else {
      compacted.push(segment);
    }
  }
  return compacted;
}

/**
 * Buffers exact source edits emitted by one native IME composition.
 *
 * Base segments retain their original source coordinates while inserted
 * segments retain the browser-confirmed text. This lets the final composition
 * become one atomic SourceTransaction without diffing DOM text or serializing
 * the derived ProseMirror document.
 */
export class SourceComposition {
  readonly baseSource: string;
  readonly baseSelection: SourceSelection;
  private segments: CompositionSegment[];
  private currentSource: string;
  private currentSelection: SourceSelection;

  constructor(source: string, selection: SourceSelection) {
    this.baseSource = source;
    this.baseSelection = selection;
    this.currentSource = source;
    this.currentSelection = selection;
    this.segments = source.length > 0
      ? [{ kind: "base", from: 0, to: source.length }]
      : [];
  }

  get source(): string {
    return this.currentSource;
  }

  get selection(): SourceSelection {
    return this.currentSelection;
  }

  apply(transaction: SourceTransaction): void {
    const applied = new CanonicalSource(this.currentSource).apply(transaction);
    const ordered = [...transaction.edits]
      .sort((left, right) => left.from - right.from || left.to - right.to);
    for (const edit of ordered.reverse()) {
      const fromIndex = splitSegmentsAt(this.segments, edit.from);
      const toIndex = splitSegmentsAt(this.segments, edit.to);
      this.segments.splice(
        fromIndex,
        toIndex - fromIndex,
        ...(edit.insert ? [{ kind: "insert" as const, text: edit.insert }] : []),
      );
    }
    this.segments = compactSegments(this.segments);
    this.currentSource = applied.source.value;
    this.currentSelection = applied.selection;
  }

  setSelection(selection: SourceSelection): void {
    new CanonicalSource(this.currentSource).apply({
      edits: [],
      selection,
      origin: "input",
    });
    this.currentSelection = selection;
  }

  transaction(reparseDerivedDocument = false): SourceTransaction {
    const edits: SourceEdit[] = [];
    let baseOffset = 0;
    let inserted = "";
    for (const segment of this.segments) {
      if (segment.kind === "insert") {
        inserted += segment.text;
        continue;
      }
      if (segment.from < baseOffset) {
        throw new Error("Composition source segments moved out of canonical order");
      }
      if (segment.from > baseOffset || inserted) {
        edits.push({ from: baseOffset, to: segment.from, insert: inserted });
        inserted = "";
      }
      baseOffset = segment.to;
    }
    if (baseOffset < this.baseSource.length || inserted) {
      edits.push({ from: baseOffset, to: this.baseSource.length, insert: inserted });
    }
    return {
      edits,
      selection: this.currentSelection,
      origin: "input",
      ...(reparseDerivedDocument ? { reparseDerivedDocument: true } : {}),
    };
  }
}
