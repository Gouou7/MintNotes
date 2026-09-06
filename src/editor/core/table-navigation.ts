import type { EditorState } from "prosemirror-state";
import type { SourceSelection, SourceTransaction } from "./source";
import { adjacentGrapheme } from "./source-text";
import { tableRowCommand } from "./features/table";

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

export function tableNavigation(
  state: EditorState, source: string, selection: SourceSelection, event: KeyboardEvent,
): SourceSelection | SourceTransaction | null {
  const command = tableRowCommand(state, event);
  if (command) return command;
  const cells = selectedTableCells(state);
  const index = cells.findIndex((cell) => cell.from <= selection.head && selection.head <= cell.to);
  if (index < 0) return null;
  const cell = cells[index]!;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const direction = ["ArrowLeft", "ArrowUp", "Backspace"].includes(event.key) || event.key === "Tab" && event.shiftKey ? -1 : 1;
  const collapsed = selection.anchor === selection.head;
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
    const column = ["ArrowUp", "ArrowDown"].includes(event.key) ? selection.head - cell.from : 0;
    return moveTo(direction < 0 && event.key === "ArrowLeft" ? target.to : Math.min(target.to, target.from + column));
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
  const offset = direction < 0 ? Math.max(0, tableFrom - 1) : Math.min(source.length, tableTo + 1);
  return moveTo(offset);
}
