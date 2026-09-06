import type { Node as PMNode } from "prosemirror-model";
import { SOURCE_FROM_ATTR, SOURCE_TO_ATTR } from "./source";

export interface TableCellRange { from: number; to: number }

/** Exact cell boundaries; pipes escaped by an odd number of backslashes are content. */
export function tableLineCells(line: string, offset = 0): TableCellRange[] {
  const pipes: number[] = [];
  let backslashes = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|" && backslashes % 2 === 0) pipes.push(i);
    backslashes = line[i] === "\\" ? backslashes + 1 : 0;
  }
  const boundaries = [-1, ...pipes, line.length];
  const cells: TableCellRange[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    let from = boundaries[i]! + 1;
    let to = boundaries[i + 1]!;
    if ((i === 0 || i === boundaries.length - 2) && !line.slice(from, to).trim() && pipes.length) continue;
    while (from < to && /[\t ]/.test(line[from]!)) from++;
    while (to > from && /[\t ]/.test(line[to - 1]!)) to--;
    cells.push({ from: offset + from, to: offset + to });
  }
  return cells;
}

/** A table is editable only when every rendered cell owns a unique authored range. */
export function projectTableSource(table: PMNode, source: string, from: number): PMNode | null {
  const lines = [...source.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)].filter((m) => m[0].length);
  if (lines.length !== table.childCount + 1) return null;
  const rows: PMNode[] = [];
  let valid = true;
  table.forEach((row, _pos, rowIndex) => {
    const line = lines[rowIndex === 0 ? 0 : rowIndex + 1]!;
    const authoredLine = line[1]!;
    const prefix = /^(?:[\t ]*>[\t ]?)+/.exec(authoredLine)?.[0] ?? "";
    const ranges = tableLineCells(authoredLine.slice(prefix.length), from + line.index + prefix.length);
    if (ranges.length !== row.childCount) { valid = false; return; }
    const cells: PMNode[] = [];
    row.forEach((cell, _offset, index) => {
      const range = ranges[index]!;
      const text = source.slice(range.from - from, range.to - from);
      cells.push(cell.type.createChecked({ ...cell.attrs,
        [SOURCE_FROM_ATTR]: range.from, [SOURCE_TO_ATTR]: range.to,
      }, text ? cell.type.schema.text(text) : undefined));
    });
    rows.push(row.copy(table.type.schema.nodes.table_row.create(null, cells).content));
  });
  return valid ? table.type.createChecked(table.attrs, rows) : null;
}
