import type { SourceEdit, SourceRange, SourceSelection } from "./source";

function mapOffset(offset: number, edits: readonly SourceEdit[], affinity: -1 | 1): number {
  let delta = 0;
  for (const edit of edits) {
    if (offset < edit.from || offset === edit.from && affinity < 0) break;
    if (offset < edit.to) return edit.from + delta + (affinity > 0 ? edit.insert.length : 0);
    delta += edit.insert.length - (edit.to - edit.from);
  }
  return offset + delta;
}

/** A pending insertion follows authored edits, never a stale DOM or numeric offset. */
export class SourceBookmark {
  private target: SourceRange | null;

  constructor(selection: SourceSelection) {
    this.target = { from: Math.min(selection.anchor, selection.head), to: Math.max(selection.anchor, selection.head) };
  }

  get range(): SourceRange | null { return this.target; }
  invalidate(): void { this.target = null; }

  map(sourceEdits: readonly SourceEdit[]): void {
    if (!this.target) return;
    const edits = [...sourceEdits].sort((a, b) => a.from - b.from || a.to - b.to);
    const { from, to } = this.target;
    const changedSelection = edits.some((edit) => edit.from < to && edit.to > from
      || edit.from === edit.to && edit.from > from && edit.from < to);
    const nextFrom = mapOffset(from, edits, 1);
    // A replacement that changed while the attachment was being prepared is
    // no longer owned by the insertion. Preserve it and insert at the mapped point.
    this.target = { from: nextFrom, to: from === to || changedSelection ? nextFrom : mapOffset(to, edits, -1) };
  }
}

/** Inverse coordinates refer to the edited source; retain disjoint edits for undo mapping. */
export function inverseSourceEdits(source: string, sourceEdits: readonly SourceEdit[]): SourceEdit[] {
  let delta = 0;
  return [...sourceEdits].sort((a, b) => a.from - b.from || a.to - b.to).map((edit) => {
    const from = edit.from + delta;
    delta += edit.insert.length - (edit.to - edit.from);
    return { from, to: from + edit.insert.length, insert: source.slice(edit.from, edit.to) };
  });
}
