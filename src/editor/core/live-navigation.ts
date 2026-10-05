import type { EditorView } from "prosemirror-view";
import type { SourceSelection, SourceTransaction } from "./source";
import { adjacentGrapheme, graphemeBoundaries } from "./source-text";
import type { SourcePositionMap } from "./source-position-map";
import { parseFencedCodeSource } from "./fenced-code-source";
import { hasVisualLineInDirection, sourceColumnOffset, sourceLineAt, verticalSourceOffset } from "./source-navigation";
import { selectedTableCells, tableNavigation } from "./table-navigation";

interface SourceLine { from: number; to: number }

export type LiveNavigationAction = {
  kind: "selection";
  selection: SourceSelection;
  direction: -1 | 1;
  visualLine?: SourceLine;
  goalX?: number;
  extend?: boolean;
} | { kind: "transaction"; transaction: SourceTransaction }
  | { kind: "source-selection"; selection: SourceSelection };

/** Navigation chooses source positions first; presentation only makes them visible. */
export class LiveNavigation {
  private goal: { source: string; head: number; column: number; x?: number; native?: boolean; table: boolean } | null = null;

  reset(): void { this.goal = null; }

  resolve(view: EditorView, source: string, selection: SourceSelection, event: KeyboardEvent, positions: SourcePositionMap): LiveNavigationAction | null {
    if (view.composing || event.isComposing || event.keyCode === 229) return null;
    // Pressing a modifier alone does not move the caret or start a new goal.
    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return null;
    const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    if (!vertical) this.reset();
    const cells = selectedTableCells(view.state);
    const cell = cells.find((cell) => cell.from <= selection.head && selection.head <= cell.to);
    const currentLine = cell ?? sourceLineAt(source, selection.head);
    if (vertical && !event.metaKey && !event.ctrlKey && !event.altKey && (selection.anchor === selection.head || event.shiftKey)) {
      if (this.goal?.source !== source || !this.goal.native && this.goal.head !== selection.head || this.goal.table !== !!cell) {
        let x: number | undefined;
        try {
          const caret = view.coordsAtPos(view.state.selection.head);
          if (caret.bottom > caret.top) x = caret.left;
        } catch { /* Layout-free callers use the authored column. */ }
        this.goal = { source, head: selection.head, column: selection.head - currentLine.from, x, table: !!cell };
      }
    }
    const table = tableNavigation(view, source, selection, event, vertical ? this.goal?.column : undefined);
    if (table && "edits" in table) return { kind: "transaction", transaction: table };
    if (table && !vertical && !horizontal) return { kind: "selection", selection: table, direction: event.shiftKey ? -1 : 1 };
    if (!vertical && !horizontal || event.metaKey || event.ctrlKey || event.altKey) { this.reset(); return null; }
    if (selection.anchor !== selection.head && !event.shiftKey) { this.reset(); return null; }
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const moveTo = (head: number): SourceSelection => ({ anchor: event.shiftKey ? selection.anchor : head, head });
    if (cells.length) {
      // Cells are the one explicit navigation domain: source separators are
      // hidden structure, while wrapped cell text still uses native motion.
      if (!table) { if (this.goal) this.goal.native = true; return null; }
      if (this.goal) { this.goal.head = table.head; this.goal.native = false; }
      const targetCell = cells.find((cell) => cell.from <= table.head && table.head <= cell.to);
      return { kind: "selection", selection: table, direction, ...(vertical ? { visualLine: targetCell ?? sourceLineAt(source, table.head), goalX: this.goal?.x, extend: event.shiftKey } : {}) };
    }
    if (horizontal) {
      const head = adjacentGrapheme(source, selection.head, direction);
      if (head === selection.head) return null;
      return positions.hasExactSourceBoundary(head)
        ? { kind: "selection", selection: moveTo(head), direction }
        : { kind: "source-selection", selection: moveTo(head) };
    }

    const { $head } = view.state.selection;
    const fence = $head.parent.type.name === "code_block" ? parseFencedCodeSource($head.parent.textContent) : null;
    const nativeEnd = fence?.closingFrom != null && $head.parentOffset < fence.closingFrom
      ? $head.start() + fence.bodyTo : $head.end();
    if (hasVisualLineInDirection(view, direction, nativeEnd)) { if (this.goal) this.goal.native = true; return null; }
    const next = verticalSourceOffset(source, selection.head, direction);
    if (next === null) return null;
    const targetLine = sourceLineAt(source, next);
    let head = sourceColumnOffset(source, targetLine.from, targetLine.to, this.goal!.column);
    if (direction > 0 && fence?.closingFrom != null && head >= Number($head.parent.attrs.sourceFrom) + fence.closingFrom) {
      head = targetLine.to;
    }
    if (!positions.hasExactSourceBoundary(head)) {
      const position = positions.sourceToDocument(head, direction < 0 ? "left" : "right");
      const $target = view.state.doc.resolve(position);
      let inTable = false;
      for (let depth = $target.depth; depth > 0; depth--) {
        const node = $target.node(depth);
        if (node.type.name === "table" && node.attrs.sourceFrom <= head && head <= node.attrs.sourceTo) inTable = true;
      }
      // Entering a table skips its declared structural markers. Every other
      // missing source boundary requires a source surface, never a guess.
      if (!inTable || !positions.hasExactDocumentBoundary(position)) return { kind: "source-selection", selection: moveTo(head) };
      head = positions.documentToSource(position, direction < 0 ? "left" : "right");
    }
    this.goal!.head = head;
    this.goal!.native = false;
    return { kind: "selection", selection: moveTo(head), direction, visualLine: targetLine, goalX: this.goal!.x, extend: event.shiftKey };
  }

  /** Measure after the target's markers have expanded, on its nearest visual row. */
  align(view: EditorView, source: string, action: Extract<LiveNavigationAction, { kind: "selection" }>, positions: SourcePositionMap): SourceSelection {
    const { visualLine: line, goalX: x } = action;
    if (!line || x === undefined) return action.selection;
    const { $head } = view.state.selection;
    const candidates: Array<{ source: number; top: number; bottom: number; x: number }> = [];
    for (const relative of graphemeBoundaries(source.slice(line.from, line.to))) {
      const offset = line.from + relative;
      if (positions.hasExactSourceBoundary(offset)) {
        try {
          const position = $head.parent.isTextblock
            ? positions.sourceToDocumentWithin(offset, $head.start(), $head.end())
            : positions.sourceToDocument(offset, "right");
          if (position === null) continue;
          const rect = view.coordsAtPos(position, 1);
          if (rect.bottom > rect.top) candidates.push({ source: offset, top: rect.top, bottom: rect.bottom, x: rect.left });
        } catch { /* An unmapped presentation cannot contribute a caret. */ }
      }
    }
    if (!candidates.length) return action.selection;
    let row = candidates.reduce((row, c) => action.direction < 0 ? Math.max(row, c.top) : Math.min(row, c.top), candidates[0]!.top);
    // A boundary before a decorated span can be painted on the preceding row.
    // The first actual glyph provides the stable entry row, independently of syntax.
    if (action.direction > 0 && candidates.length > 1 && candidates[0]!.source === line.from) {
      try {
        const position = positions.sourceToDocumentWithin(candidates[1]!.source, $head.start(), $head.end());
        if (position !== null) row = view.coordsAtPos(position, -1).top;
      } catch { /* Retain measured row. */ }
    }
    const rowCandidates = candidates.filter((c) => c.top <= row + 1 && c.bottom > row);
    if (!rowCandidates.length) return action.selection;
    const target = rowCandidates
      .reduce((best, candidate) => {
        const distance = Math.abs(candidate.x - x) - Math.abs(best.x - x);
        return distance < 0 || distance === 0 && Math.abs(candidate.source - action.selection.head) < Math.abs(best.source - action.selection.head) ? candidate : best;
      });
    const selection = { anchor: action.extend ? action.selection.anchor : target.source, head: target.source };
    if (this.goal) this.goal.head = selection.head;
    return selection;
  }
}
