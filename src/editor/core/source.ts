export type SourceOffset = number;

export const SOURCE_FROM_ATTR = "sourceFrom";
export const SOURCE_TO_ATTR = "sourceTo";
export const SOURCE_TEXT_ATTR = "sourceText";
export const SOURCE_FINGERPRINT_ATTR = "sourceFingerprint";
/** Presentation-only minimum block height captured before entering editing state. */
export const SOURCE_LAYOUT_HEIGHT_ATTR = "sourceLayoutHeight";

export interface SourceRange {
  readonly from: SourceOffset;
  readonly to: SourceOffset;
}

export interface SourceSelection {
  readonly anchor: SourceOffset;
  readonly head: SourceOffset;
}

export interface SourceEdit extends SourceRange {
  readonly insert: string;
}

export interface SourceTransaction {
  readonly edits: readonly SourceEdit[];
  readonly selection: SourceSelection;
  readonly origin: "input" | "paste" | "drop" | "delete" | "command" | "external";
  /** Rebuild the derived view when this edit changes Markdown block structure. */
  readonly reparseDerivedDocument?: boolean;
}

export interface AppliedSourceTransaction {
  readonly source: CanonicalSource;
  readonly selection: SourceSelection;
}

function assertOffset(offset: number, length: number, label: string): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > length) {
    throw new RangeError(`${label} must be an integer in [0, ${length}]`);
  }
}

function validateEdits(length: number, edits: readonly SourceEdit[]): SourceEdit[] {
  const ordered = [...edits].sort((left, right) => left.from - right.from || left.to - right.to);
  let previousTo = 0;
  for (const [index, edit] of ordered.entries()) {
    assertOffset(edit.from, length, `edits[${index}].from`);
    assertOffset(edit.to, length, `edits[${index}].to`);
    if (edit.to < edit.from) throw new RangeError(`edits[${index}] has a reversed range`);
    if (index > 0 && edit.from < previousTo) {
      throw new RangeError("Source transaction edits must not overlap");
    }
    previousTo = edit.to;
  }
  return ordered;
}

export class CanonicalSource {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  get length(): number {
    return this.value.length;
  }

  apply(transaction: SourceTransaction): AppliedSourceTransaction {
    const edits = validateEdits(this.length, transaction.edits);
    let next = this.value;
    for (const edit of [...edits].reverse()) {
      next = next.slice(0, edit.from) + edit.insert + next.slice(edit.to);
    }
    assertOffset(transaction.selection.anchor, next.length, "selection.anchor");
    assertOffset(transaction.selection.head, next.length, "selection.head");
    return {
      source: new CanonicalSource(next),
      selection: transaction.selection,
    };
  }
}

export function replaceSourceRange(
  source: string,
  range: SourceRange,
  insert: string,
  origin: SourceTransaction["origin"] = "command",
): AppliedSourceTransaction {
  const head = range.from + insert.length;
  return new CanonicalSource(source).apply({
    edits: [{ ...range, insert }],
    selection: { anchor: head, head },
    origin,
  });
}
