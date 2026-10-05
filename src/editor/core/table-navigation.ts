import type { EditorState } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import type { SourceSelection, SourceTransaction } from "./source";
import { adjacentGrapheme } from "./source-text";
import { tableRowCommand } from "./features/table";
import { hasVisualLineInDirection, sourceColumnOffset, verticalSourceOffset } from "./source-navigation";

export function selectedTableCells(state: EditorState): { from: number; to: number; row: number; column: number }[] {
  const cells: { from: number; to: number; row: number; column: number }[] = [];
  const $head = state.selection.$head;
  for (let depth = $head.depth; depth > 0; depth--) {
    const table = $head.node(depth);
    if (table.type.name !== "table") continue;
    table.forEach((row, _p, rowIndex) => row.forEach((cell, _c, column) => {
      if (Number.isInteger(cell.attrs.sourceFrom) && Number.isInteger(cell.attrs.sourceTo)) {
        cells.push({ from: cell.attrs.sourceFrom, to: cell.attrs.sourceTo, row: rowIndex, column });
      }
    }));
    break;
  }
  return cells;
}

/** Clipboard ranges may cross a table while neither endpoint is in a cell,
 * or before the browser has delivered selectionchange to the modeled caret. */
export function tableCutRequiresSource(doc: PMNode, selection: SourceSelection): boolean {
  const from = Math.min(selection.anchor, selection.head);
  const to = Math.max(selection.anchor, selection.head);
  if (from === to) return false;
  let requiresSource = false;
  doc.descendants((node) => {
    if (requiresSource) return false;
    if (node.type.name !== "table") return true;
    if (!(from < node.attrs.sourceTo && node.attrs.sourceFrom < to)) return false;
    let withinCell = false;
    node.descendants((cell) => {
      if (cell.type.name === "table_cell" && cell.attrs.sourceFrom <= from && to <= cell.attrs.sourceTo) withinCell = true;
    });
    requiresSource = !withinCell;
    return false;
  });
  return requiresSource;
}

export function tableNavigation(
  view: EditorView, source: string, selection: SourceSelection, event: KeyboardEvent, verticalColumn?: number,
): SourceSelection | SourceTransaction | null {
  const { state } = view;
  const command = tableRowCommand(state, event);
  if (command) return command;
  const cells = selectedTableCells(state);
  const index = cells.findIndex((cell) => cell.from <= selection.head && selection.head <= cell.to);
  if (index < 0) return null;
  const cell = cells[index]!;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const direction = ["ArrowLeft", "ArrowUp", "Backspace"].includes(event.key) || event.key === "Tab" && event.shiftKey ? -1 : 1;
  const collapsed = selection.anchor === selection.head;
  if (["ArrowUp", "ArrowDown"].includes(event.key)) {
    if (!collapsed && !event.shiftKey) return null;
    if (hasVisualLineInDirection(view, direction)) return null;
  }
  const moveTo = (offset: number): SourceSelection => ({ anchor: event.shiftKey && event.key !== "Tab" ? selection.anchor : offset, head: offset });
  if (["Backspace", "Delete"].includes(event.key)) {
    if (collapsed && selection.head === (direction < 0 ? cell.from : cell.to)) return selection;
    return null;
  }
  if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
    if (!collapsed && !event.shiftKey) return null;
    if (direction < 0 ? selection.head > cell.from : selection.head < cell.to) {
      return moveTo(adjacentGrapheme(source, selection.head, direction));
    }
  } else if (!["Tab", "Enter", "ArrowUp", "ArrowDown"].includes(event.key)) return null;

  let target: (typeof cells)[number] | undefined = cells[index + direction];
  if (["Enter", "ArrowUp", "ArrowDown"].includes(event.key)) {
    target = cells.find((candidate) => candidate.row === cell.row + direction && candidate.column === cell.column);
  }
  if (target) {
    const column = ["ArrowUp", "ArrowDown"].includes(event.key) ? verticalColumn ?? selection.head - cell.from : 0;
    return moveTo(direction < 0 && event.key === "ArrowLeft" ? target.to : sourceColumnOffset(source, target.from, target.to, column));
  }
  // Find an authored text boundary outside the table. Do not create content to navigate.
  let tableFrom = cells[0]!.from;
  let tableTo = cells.at(-1)!.to;
  const $head = state.selection.$head;
  for (let depth = $head.depth; depth > 0; depth--) {
    const node = $head.node(depth);
    if (node.type.name === "table") { tableFrom = node.attrs.sourceFrom; tableTo = node.attrs.sourceTo; break; }
  }
  if (direction < 0 && tableFrom === 0 || direction > 0 && tableTo === source.length) return selection;
  const offset = verticalSourceOffset(source, direction < 0 ? tableFrom : tableTo, direction);
  if (offset === null) return selection;
  return moveTo(offset);
}
