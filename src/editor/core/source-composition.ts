import {
  CanonicalSource,
  type SourceSelection,
  type SourceTransaction,
} from "./source";

/**
 * One IME session owns one replacement in the original Markdown.
 *
 * The browser may remove BR placeholders or rewrite the surrounding rendered
 * block while composing. Those projection repairs do not enlarge the authored
 * replacement. compositionend's text is committed at the original range;
 * native transactions are only a fallback when they stay inside that range.
 */
export class SourceComposition {
  readonly baseSource: string;
  readonly baseSelection: SourceSelection;
  private readonly from: number;
  private readonly to: number;
  private nativeText: string;
  private nativeSelection: SourceSelection;
  private nativeValid = true;
  private confirmedText: string | null = null;

  constructor(source: string, selection: SourceSelection) {
    new CanonicalSource(source).apply({ edits: [], selection, origin: "input" });
    this.baseSource = source;
    this.baseSelection = { ...selection };
    this.from = Math.min(selection.anchor, selection.head);
    this.to = Math.max(selection.anchor, selection.head);
    this.nativeText = source.slice(this.from, this.to);
    this.nativeSelection = { ...selection };
  }

  private result(): { text: string; selection: SourceSelection } {
    if (this.confirmedText !== null) {
      // Empty event data can mean cancellation or deletion. Accept a deletion
      // only when an exact native edit removed the originally selected text.
      if (this.confirmedText || (this.nativeValid && !this.nativeText)) {
        const head = this.from + this.confirmedText.length;
        return { text: this.confirmedText, selection: { anchor: head, head } };
      }
      return { text: this.baseSource.slice(this.from, this.to), selection: this.baseSelection };
    }
    return this.nativeValid
      ? { text: this.nativeText, selection: this.nativeSelection }
      : { text: this.baseSource.slice(this.from, this.to), selection: this.baseSelection };
  }

  get source(): string {
    return this.baseSource.slice(0, this.from) + this.nativeText + this.baseSource.slice(this.to);
  }

  get selection(): SourceSelection {
    return this.result().selection;
  }

  get ended(): boolean {
    return this.confirmedText !== null;
  }

  confirm(text: string): void {
    this.confirmedText = text;
  }

  rejectNative(): void {
    this.nativeValid = false;
  }

  apply(transaction: SourceTransaction): void {
    if (!this.nativeValid) return;
    if (transaction.edits.some((edit) => edit.from < this.from || edit.to > this.from + this.nativeText.length)) {
      this.rejectNative();
      return;
    }
    const applied = new CanonicalSource(this.source).apply(transaction);
    const delta = transaction.edits.reduce((sum, edit) => sum + edit.insert.length - (edit.to - edit.from), 0);
    this.nativeText = applied.source.value.slice(this.from, this.from + this.nativeText.length + delta);
    this.nativeSelection = applied.selection;
  }

  setSelection(selection: SourceSelection): void {
    if (!this.nativeValid) return;
    new CanonicalSource(this.source).apply({ edits: [], selection, origin: "input" });
    this.nativeSelection = selection;
  }

  transaction(reparseDerivedDocument = false): SourceTransaction {
    const { text, selection } = this.result();
    return {
      edits: text === this.baseSource.slice(this.from, this.to)
        ? [] : [{ from: this.from, to: this.to, insert: text }],
      selection,
      origin: "input",
      ...(reparseDerivedDocument ? { reparseDerivedDocument: true } : {}),
    };
  }
}
