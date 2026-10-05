import type { SourceRange, SourceSelection, SourceTransaction } from "./source";

/** An absent or empty plain-text payload must never act as a selection deletion. */
export function transferPlainText(transfer: DataTransfer | null): string | null {
  if (!transfer) return null;
  if (transfer.types && !Array.from(transfer.types).includes("text/plain")) return null;
  return transfer.getData?.("text/plain") || null;
}

export function pasteSourceTransaction(selection: SourceSelection, text: string): SourceTransaction {
  const from = Math.min(selection.anchor, selection.head);
  const to = Math.max(selection.anchor, selection.head);
  const head = from + text.length;
  return { edits: [{ from, to, insert: text }], selection: { anchor: head, head },
    origin: "paste", reparseDerivedDocument: true };
}

/** Move both ranges in one source transaction, with all coordinates in the original source. */
export function dropSourceTransaction(offset: number, text: string, move?: SourceRange): SourceTransaction | null {
  if (move && offset >= move.from && offset <= move.to) return null;
  const from = move && offset > move.to ? offset - (move.to - move.from) : offset;
  return {
    edits: [...(move ? [{ ...move, insert: "" }] : []), { from: offset, to: offset, insert: text }],
    selection: { anchor: from, head: from + text.length },
    origin: "drop", reparseDerivedDocument: true,
  };
}
