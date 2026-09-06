import type { Node as PMNode, Schema } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import type { FeatureSpec, FeaturePluginContext } from "./_types";
import { SOURCE_FROM_ATTR, SOURCE_TEXT_ATTR, SOURCE_TO_ATTR } from "../source";
import { SOURCE_TRANSACTION_META } from "../source-transaction";
import type { EditorControlIcon } from "../extension";
import type { SourceTransaction } from "../source";

// GFM cells own exact authored ranges. Toolbar actions submit source transactions.

export function parseAlignFromStyle(style: string | null): string | null {
  if (!style) return null;
  // Browsers / happy-dom may canonicalize with a space after `:` and a
  // trailing semicolon — match either form.
  const m = /text-align:\s*(left|center|right)/.exec(style);
  return m ? m[1]! : null;
}

function alignDelim(align: string | null, width: number): string {
  // Min divider width is 3 (per GFM); we expand to match content width
  // so the source is human-readable on save.
  const w = Math.max(3, width);
  if (align === "left") return ":" + "-".repeat(w - 1);
  if (align === "right") return "-".repeat(w - 1) + ":";
  if (align === "center") return ":" + "-".repeat(w - 2) + ":";
  return "-".repeat(w);
}

// ---------------- toolbar plugin ----------------
//
// Floating toolbar shown when the cursor is inside a table. Carries:
//   * resize trigger (田字格 icon) → opens a popup with a hover-grid
//     and numeric R × C inputs to resize the table.
//   * 3 align buttons → set `align` on every cell in the cursor's
//     current column.
//   * trash → remove exactly the authored table range.
//
// The toolbar lives at `document.body` (position: fixed, viewport
// coords). Position is recomputed every PM transaction from the table
// element's bounding rect.

type TableInfo = {
  pos: number; // pos *of* the table node (so view.nodeDOM works).
  node: PMNode;
  rowIdx: number;
  cellIdx: number;
};

type AuthoredTable = {
  source: string;
  from: number;
  to: number;
};

function authoredTable(info: TableInfo): AuthoredTable | null {
  const source = info.node.attrs[SOURCE_TEXT_ATTR];
  const from = Number(info.node.attrs[SOURCE_FROM_ATTR]);
  const to = Number(info.node.attrs[SOURCE_TO_ATTR]);
  return typeof source === "string"
    && Number.isInteger(from)
    && Number.isInteger(to)
    && from >= 0
    && to === from + source.length
    ? { source, from, to }
    : null;
}

type AuthoredTableLine = { cells: string[]; prefix: string; suffix: string; leftPipe: boolean; rightPipe: boolean };

function splitAuthoredTableLine(line: string): AuthoredTableLine {
  const prefix = /^(?:(?:[\t ]*>[\t ]?)+|[\t ]*)/.exec(line)![0];
  const body = line.slice(prefix.length);
  const cells: string[] = [];
  let cursor = 0;
  let slashes = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "|" && slashes % 2 === 0) { cells.push(body.slice(cursor, i)); cursor = i + 1; }
    slashes = body[i] === "\\" ? slashes + 1 : 0;
  }
  cells.push(body.slice(cursor));
  const leftPipe = body.startsWith("|");
  const rightPipe = cells.length > 1 && !cells.at(-1)!.trim();
  const suffix = rightPipe ? cells.pop()! : "";
  if (leftPipe) cells.shift();
  return { cells, prefix, suffix, leftPipe, rightPipe };
}

function joinAuthoredTableLine(line: AuthoredTableLine): string {
  return line.prefix + (line.leftPipe ? "|" : "") + line.cells.join("|") + (line.rightPipe ? "|" : "") + line.suffix;
}

function tableSourceLines(source: string): { text: string; eol: string }[] {
  return [...source.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)].filter((match) => match[0].length)
    .map((match) => ({ text: match[1]!, eol: match[2]! }));
}

/** Rows counts visible rows (including the header), never the delimiter line. */
export function resizeAuthoredTableSource(source: string, rows: number, cols: number): string {
  if (rows < 1 || cols < 1) return source;
  const lines = tableSourceLines(source);
  const parsed = lines.map((line) => splitAuthoredTableLine(line.text));
  const template = parsed[0];
  if (!template) return source;
  const eol = lines.find((line) => line.eol)?.eol ?? "\n";
  const result: string[] = [];
  for (let row = 0; row <= rows; row++) {
    const existing = parsed[row];
    const cells = existing ? existing.cells.slice(0, cols) : [];
    while (cells.length < cols) cells.push(row === 1 ? " --- " : " ");
    const line = { ...(existing ?? template), cells };
    result.push(joinAuthoredTableLine(line) + (row < rows ? lines[row]?.eol || eol : ""));
  }
  return result.join("");
}

export function alignAuthoredTableSource(
  source: string,
  column: number,
  align: "left" | "center" | "right" | null,
): string {
  const lines = tableSourceLines(source);
  if (lines.length < 2) return source;
  const divider = splitAuthoredTableLine(lines[1]!.text);
  const cell = divider.cells[column];
  if (cell === undefined) return source;
  const leading = /^\s*/.exec(cell)?.[0] ?? "";
  const trailing = /\s*$/.exec(cell)?.[0] ?? "";
  const width = Math.max(3, cell.trim().replaceAll(":", "").length);
  const dashes = "-".repeat(width);
  const marker = align === "left"
    ? `:${dashes}`
    : align === "right"
      ? `${dashes}:`
      : align === "center"
        ? `:${dashes}:`
        : dashes;
  divider.cells[column] = `${leading}${marker}${trailing}`;
  lines[1]!.text = joinAuthoredTableLine(divider);
  return lines.map((line) => line.text + line.eol).join("");
}

function bindTableSourceTransaction(
  tr: import("prosemirror-state").Transaction,
  table: AuthoredTable,
  replacement: string,
): void {
  const header = splitAuthoredTableLine(replacement.split(/\r\n|\r|\n/)[0] ?? "");
  const head = table.from + header.prefix.length + (header.leftPipe ? 1 : 0) + (/^[\t ]*/.exec(header.cells[0] ?? "")?.[0].length ?? 0);
  tr.setMeta(SOURCE_TRANSACTION_META, {
    edits: [{ from: table.from, to: table.to, insert: replacement }],
    selection: { anchor: head, head },
    origin: "command",
    reparseDerivedDocument: true,
  });
}

function findTableAtSelection(state: import("prosemirror-state").EditorState): TableInfo | null {
  const $from = state.selection.$from;
  let cellDepth = -1;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === "table_cell") {
      cellDepth = d;
      break;
    }
  }
  if (cellDepth === -1) return null;
  const tableDepth = cellDepth - 2;
  return {
    pos: $from.before(tableDepth),
    node: $from.node(tableDepth),
    rowIdx: $from.index(tableDepth),
    cellIdx: $from.index(cellDepth - 1),
  };
}

/** Explicit row commands retain all existing cells, delimiters and line endings. */
export function tableRowCommand(state: import("prosemirror-state").EditorState, event: KeyboardEvent): SourceTransaction | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const insert = event.key === "Enter" && !event.shiftKey;
  const remove = event.key === "Backspace" && event.shiftKey;
  if (!insert && !remove) return null;
  const info = findTableAtSelection(state);
  const table = info && authoredTable(info);
  if (!info || !table) return null;
  const lines = tableSourceLines(table.source);
  const current = info.rowIdx === 0 ? 0 : info.rowIdx + 1;
  const eol = lines.find((line) => line.eol)?.eol ?? "\n";
  if (insert) {
    const at = info.rowIdx === 0 ? 2 : current + 1;
    const template = splitAuthoredTableLine(lines[current]!.text);
    const text = joinAuthoredTableLine({ ...template, cells: template.cells.map(() => " ") });
    if (at === lines.length) lines[at - 1]!.eol = eol;
    lines.splice(at, 0, { text, eol: at < lines.length ? eol : "" });
  } else if (info.rowIdx > 0) {
    lines.splice(current, 1);
    if (current === lines.length) lines.at(-1)!.eol = "";
  }
  const replacement = lines.map((line) => line.text + line.eol).join("");
  const tr = state.tr;
  bindTableSourceTransaction(tr, table, replacement);
  return tr.getMeta(SOURCE_TRANSACTION_META) as SourceTransaction;
}

function applyAlignToColumn(
  view: EditorView,
  info: TableInfo,
  align: "left" | "center" | "right" | null,
): void {
  const tr = view.state.tr;
  const table = authoredTable(info);
  if (!table) return;
  bindTableSourceTransaction(
    tr,
    table,
    alignAuthoredTableSource(table.source, info.cellIdx, align),
  );
  view.dispatch(tr);
  view.focus();
}

function deleteTable(view: EditorView, info: TableInfo): void {
  const tr = view.state.tr;
  const table = authoredTable(info);
  if (!table) return;
  bindTableSourceTransaction(tr, table, "");
  view.dispatch(tr);
  view.focus();
}

function resizeTable(
  view: EditorView,
  info: TableInfo,
  rows: number,
  cols: number,
): void {
  if (rows < 1 || cols < 1) return;
  const tr = view.state.tr;
  const table = authoredTable(info);
  if (!table) return;
  bindTableSourceTransaction(tr, table, resizeAuthoredTableSource(table.source, rows, cols));
  view.dispatch(tr);
  view.focus();
}

function buildToolbar(view: EditorView, getInfo: () => TableInfo | null, renderIcon?: FeaturePluginContext["renderControlIcon"]): {
  root: HTMLElement;
  popup: HTMLElement;
  destroy(): void;
} {
  const root = document.createElement("div");
  root.className = "table-toolbar";
  const iconCleanup: Array<() => void> = [];
  const mountIcon = (target: HTMLElement, name: EditorControlIcon) => {
    const icon = renderIcon!(name);
    target.append(icon.element);
    iconCleanup.push(icon.destroy);
  };

  const grid = document.createElement("button");
  grid.type = "button";
  grid.className = "table-tb-btn";
  grid.title = "Resize";
  if (renderIcon) mountIcon(grid, "table-size");
  else grid.textContent = "Resize";

  const sep = document.createElement("span");
  sep.className = "table-tb-sep";

  const mkAlign = (a: "left" | "center" | "right") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "table-tb-btn";
    b.title = `Align ${a}`;
    b.dataset.align = a;
    if (renderIcon) mountIcon(b, `align-${a}`);
    else b.textContent = a;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      const info = getInfo();
      if (info) applyAlignToColumn(view, info, a);
    });
    return b;
  };
  const alignL = mkAlign("left");
  const alignC = mkAlign("center");
  const alignR = mkAlign("right");

  const spacer = document.createElement("span");
  spacer.className = "table-tb-spacer";

  const trash = document.createElement("button");
  trash.type = "button";
  trash.className = "table-tb-btn table-tb-trash";
  trash.title = "Delete table";
  if (renderIcon) mountIcon(trash, "table-delete");
  else trash.textContent = "Delete";
  trash.addEventListener("mousedown", (e) => e.preventDefault());
  trash.addEventListener("click", () => {
    const info = getInfo();
    if (info) deleteTable(view, info);
  });

  root.append(grid, sep, alignL, alignC, alignR, spacer, trash);

  // Resize popup — built once, toggled on grid click. Hover the grid
  // to highlight up to (R, C); the numeric inputs reflect the hover
  // and can be edited directly. Click the grid (or press Enter on the
  // inputs) to commit.
  //
  // Snapshot the current TableInfo when the popup opens: while the
  // popup is up, the user may interact with the popup (focusing
  // inputs, clicking grid cells) which can cause `getInfo()` to flip
  // to null mid-action. The snapshot keeps the target table stable.
  let popupSnapshot: TableInfo | null = null;
  const popup = document.createElement("div");
  popup.className = "table-resize-popup";
  popup.style.display = "none";
  // Block focus loss when clicking the popup background — preserves
  // editor selection so the snapshot stays valid. Inputs are exempt;
  // they need to receive focus to be typed in.
  popup.addEventListener("mousedown", (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName !== "INPUT") e.preventDefault();
  });

  const gridEl = document.createElement("div");
  gridEl.className = "table-resize-grid";
  const MAX_R = 10;
  const MAX_C = 10;
  const cells: HTMLElement[][] = [];
  for (let r = 0; r < MAX_R; r++) {
    const row: HTMLElement[] = [];
    for (let c = 0; c < MAX_C; c++) {
      const cell = document.createElement("div");
      cell.className = "table-resize-cell";
      cell.dataset.r = String(r + 1);
      cell.dataset.c = String(c + 1);
      gridEl.appendChild(cell);
      row.push(cell);
    }
    cells.push(row);
  }

  const inputs = document.createElement("div");
  inputs.className = "table-resize-inputs";
  const rIn = document.createElement("input");
  rIn.type = "number";
  rIn.min = "1";
  rIn.max = "20";
  const xLabel = document.createElement("span");
  xLabel.textContent = "×";
  const cIn = document.createElement("input");
  cIn.type = "number";
  cIn.min = "1";
  cIn.max = "20";
  inputs.append(rIn, xLabel, cIn);

  const setHighlight = (R: number, C: number) => {
    for (let r = 0; r < MAX_R; r++)
      for (let c = 0; c < MAX_C; c++) {
        cells[r]![c]!.classList.toggle("hover", r < R && c < C);
      }
    rIn.value = String(R);
    cIn.value = String(C);
  };
  gridEl.addEventListener("mousemove", (e) => {
    const t = (e.target as HTMLElement).closest(".table-resize-cell") as HTMLElement | null;
    if (!t) return;
    setHighlight(Number(t.dataset.r), Number(t.dataset.c));
  });
  gridEl.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest(".table-resize-cell") as HTMLElement | null;
    if (!t) return;
    const target = popupSnapshot ?? getInfo();
    if (!target) return;
    resizeTable(view, target, Number(t.dataset.r), Number(t.dataset.c));
    popup.style.display = "none";
    popupSnapshot = null;
  });
  const commitInputs = () => {
    const target = popupSnapshot ?? getInfo();
    if (!target) return;
    const R = Math.max(1, Math.min(20, Number(rIn.value) || 1));
    const C = Math.max(1, Math.min(20, Number(cIn.value) || 1));
    resizeTable(view, target, R, C);
    popup.style.display = "none";
    popupSnapshot = null;
  };
  rIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitInputs();
    }
  });
  cIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitInputs();
    }
  });

  popup.append(gridEl, inputs);

  grid.addEventListener("mousedown", (e) => e.preventDefault());
  grid.addEventListener("click", () => {
    const liveInfo = getInfo();
    if (!liveInfo) return;
    if (popup.style.display === "block") {
      popup.style.display = "none";
      popupSnapshot = null;
      return;
    }
    popupSnapshot = liveInfo;
    // Initialize highlight to current dims.
    let R = 0, C = 0;
    liveInfo.node.forEach((row) => {
      R++;
      C = Math.max(C, row.childCount);
    });
    setHighlight(Math.min(R, MAX_R), Math.min(C, MAX_C));
    // Anchor below the trigger button.
    const r = grid.getBoundingClientRect();
    popup.style.top = `${r.bottom + 4}px`;
    popup.style.left = `${r.left}px`;
    popup.style.display = "block";
  });

  return { root, popup, destroy: () => iconCleanup.splice(0).forEach((cleanup) => cleanup()) };
}

function tableToolbarPlugin(renderIcon?: FeaturePluginContext["renderControlIcon"]): Plugin {
  return new Plugin({
    view(view) {
      let info: TableInfo | null = null;
      // Lazy: toolbar DOM is only built and appended when this view is
      // both focused and on a table. Unfocused views (every case-card
      // in the harness with a table seed) never create toolbar DOM.
      let toolbar: ReturnType<typeof buildToolbar> | null = null;

      const ensureMounted = () => {
        if (!toolbar) {
          toolbar = buildToolbar(view, () => info, renderIcon);
        }
        if (!toolbar.root.isConnected) {
          document.body.appendChild(toolbar.root);
          document.body.appendChild(toolbar.popup);
        }
        return toolbar;
      };
      const unmount = () => {
        if (toolbar?.root.isConnected) {
          toolbar.root.remove();
          toolbar.popup.remove();
        }
      };

      const update = () => {
        info = findTableAtSelection(view.state);
        if (!info || !view.hasFocus()) {
          unmount();
          return;
        }
        const dom = view.nodeDOM(info.pos) as HTMLElement | null;
        if (!dom) {
          unmount();
          return;
        }
        const tb = ensureMounted();
        const rect = dom.getBoundingClientRect();
        tb.root.style.display = "flex";
        tb.root.style.top = `${rect.top - 32}px`;
        tb.root.style.left = `${rect.left}px`;
        // Reflect current column's align in the button states.
        const cell = info.node.child(info.rowIdx).child(info.cellIdx);
        const cur = cell.attrs.align as string | null;
        tb.root.querySelectorAll<HTMLElement>("[data-align]").forEach((b) => {
          b.classList.toggle("active", b.dataset.align === cur);
        });
      };

      const onScroll = () => update();
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onScroll);
      view.dom.addEventListener("focusin", update);
      view.dom.addEventListener("focusout", update);

      return {
        update() {
          update();
        },
        destroy() {
          toolbar?.destroy();
          window.removeEventListener("scroll", onScroll, true);
          window.removeEventListener("resize", onScroll);
          view.dom.removeEventListener("focusin", update);
          view.dom.removeEventListener("focusout", update);
          unmount();
        },
      };
    },
  });
}

function tabCellNav(dir: 1 | -1) {
  return (state: import("prosemirror-state").EditorState,
    dispatch?: (tr: import("prosemirror-state").Transaction) => void): boolean => {
    const $from = state.selection.$from;
    let cellDepth = -1;
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type.name === "table_cell") {
        cellDepth = d;
        break;
      }
    }
    if (cellDepth === -1) return false;
    const rowDepth = cellDepth - 1;
    const tableDepth = cellDepth - 2;
    const cellIdx = $from.index(rowDepth);
    const rowIdx = $from.index(tableDepth);
    const tableNode = $from.node(tableDepth);
    const row = $from.node(rowDepth);

    let nextRow = rowIdx;
    let nextCell = cellIdx + dir;
    if (nextCell < 0) {
      nextRow = rowIdx - 1;
      if (nextRow < 0) return true; // first cell — consume, no-op
      nextCell = tableNode.child(nextRow).childCount - 1;
    } else if (nextCell >= row.childCount) {
      nextRow = rowIdx + 1;
      if (nextRow >= tableNode.childCount) return true; // last cell — consume, no-op
      nextCell = 0;
    }
    if (dispatch) {
      const tableStart = $from.before(tableDepth);
      let pos = tableStart + 1; // inside table
      for (let r = 0; r < nextRow; r++) pos += tableNode.child(r).nodeSize;
      pos += 1; // inside row
      const targetRow = tableNode.child(nextRow);
      for (let c = 0; c < nextCell; c++) pos += targetRow.child(c).nodeSize;
      pos += 1; // inside cell
      dispatch(
        state.tr.setSelection(TextSelection.create(state.doc, pos)),
      );
    }
    return true;
  };
}

function renderCellInline(cell: PMNode): string {
  // Minimal cell-content serializer — covers method-B marks (delim chars
  // already live in textContent) and avoids the circular import with
  // serializer.ts. Inline atom nodes inside cells (image, etc.) are
  // skipped for the pilot; phase 2 can route them through the full
  // serializer if/when atoms in tables become a real use case.
  let out = "";
  cell.content.forEach((child) => {
    if (child.isText) out += child.text ?? "";
  });
  return out;
}

export const table: FeatureSpec = {
  name: "table",

  nodes: {
    table: {
      group: "block",
      content: "table_row+",
      defining: true,
      isolating: true,
      parseDOM: [{ tag: "table" }],
      toDOM: () => ["table", ["tbody", 0]],
    },
    table_row: {
      content: "table_cell+",
      parseDOM: [{ tag: "tr" }],
      toDOM: () => ["tr", 0],
    },
    table_cell: {
      content: "inline*",
      attrs: {
        header: { default: false },
        align: { default: null },
      },
      isolating: true,
      parseDOM: [
        {
          tag: "th",
          getAttrs: (el) => ({
            header: true,
            align: parseAlignFromStyle((el as HTMLElement).getAttribute("style")),
          }),
        },
        {
          tag: "td",
          getAttrs: (el) => ({
            header: false,
            align: parseAlignFromStyle((el as HTMLElement).getAttribute("style")),
          }),
        },
      ],
      toDOM: (node) => {
        const tag = node.attrs.header ? "th" : "td";
        const align = node.attrs.align as string | null;
        const attrs = align ? { style: `text-align:${align}` } : {};
        return [tag, attrs, 0];
      },
    },
  },

  mdItPlugins: [(md) => md.enable("table")],

  plugins: (_schema, context) => [tableToolbarPlugin(context.renderControlIcon)],

  keymap: (schema: Schema) => ({
    // Cell navigation. Tab / Shift-Tab move the cursor row-major; at the
    // boundary (last/first cell) the keystroke is consumed but the
    // selection is unchanged — that matches Typora and avoids letting
    // browser focus escape the table.
    Tab: tabCellNav(1),
    "Shift-Tab": tabCellNav(-1),

    // Cmd/Ctrl-Enter inside a cell: insert an empty row below the
    // current one. New cells inherit the column's `align` from the
    // header row.
    "Mod-Enter": (state, dispatch) => {
      const $from = state.selection.$from;
      let cellDepth = -1;
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === "table_cell") {
          cellDepth = d;
          break;
        }
      }
      if (cellDepth === -1) return false;
      const tableDepth = cellDepth - 2;
      const tableNode = $from.node(tableDepth);
      const rowIdx = $from.index(tableDepth);
      const cellIdx = $from.index(cellDepth - 1);
      const colCount = tableNode.child(rowIdx).childCount;
      if (dispatch) {
        const headerRow = tableNode.child(0);
        const newCells: PMNode[] = [];
        for (let c = 0; c < colCount; c++) {
          const align = (headerRow.child(c)?.attrs.align as string | null) ?? null;
          newCells.push(
            schema.nodes.table_cell.create({ header: false, align }, []),
          );
        }
        const newRow = schema.nodes.table_row.create(null, newCells);
        const tableStart = $from.before(tableDepth);
        let insertAt = tableStart + 1;
        for (let r = 0; r <= rowIdx; r++) insertAt += tableNode.child(r).nodeSize;
        const tr = state.tr.insert(insertAt, newRow);
        // Cursor inside the new row at the same column index.
        let cursorPos = insertAt + 1; // inside row
        for (let c = 0; c < cellIdx; c++) cursorPos += newRow.child(c).nodeSize;
        cursorPos += 1; // inside cell
        tr.setSelection(TextSelection.create(tr.doc, cursorPos));
        dispatch(tr);
      }
      return true;
    },

    // Cmd/Ctrl-Shift-Backspace inside a cell: delete the current row.
    // No-op (but consumed) when the table has a single row left.
    "Mod-Shift-Backspace": (state, dispatch) => {
      const $from = state.selection.$from;
      let cellDepth = -1;
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === "table_cell") {
          cellDepth = d;
          break;
        }
      }
      if (cellDepth === -1) return false;
      const tableDepth = cellDepth - 2;
      const tableNode = $from.node(tableDepth);
      const rowIdx = $from.index(tableDepth);
      const cellIdx = $from.index(cellDepth - 1);
      if (tableNode.childCount <= 1) return true; // consume, no-op
      if (dispatch) {
        const tableStart = $from.before(tableDepth);
        let rowStart = tableStart + 1;
        for (let r = 0; r < rowIdx; r++) rowStart += tableNode.child(r).nodeSize;
        const row = tableNode.child(rowIdx);
        const tr = state.tr.delete(rowStart, rowStart + row.nodeSize);
        // Cursor → adjacent row, same column. Prefer next row (same
        // index in the post-delete table); fall back to previous when
        // we deleted the last row.
        const newTable = tr.doc.nodeAt(tableStart)!;
        const targetRowIdx = Math.min(rowIdx, newTable.childCount - 1);
        let cursorPos = tableStart + 1;
        for (let r = 0; r < targetRowIdx; r++)
          cursorPos += newTable.child(r).nodeSize;
        cursorPos += 1; // inside row
        const targetRow = newTable.child(targetRowIdx);
        const targetCol = Math.min(cellIdx, targetRow.childCount - 1);
        for (let c = 0; c < targetCol; c++) cursorPos += targetRow.child(c).nodeSize;
        cursorPos += 1; // inside cell
        tr.setSelection(TextSelection.create(tr.doc, cursorPos));
        dispatch(tr);
      }
      return true;
    },

    // Live trigger: a paragraph whose text is exactly `|c1|c2|...|`
    // (≥ 2 cells, leading + trailing pipes) commits to a table on Enter.
    // Cells split on `|`; first and last segments (empty by construction)
    // are dropped; middle segments — including empty ones — become cells
    // verbatim (trimmed).
    Enter: (state, dispatch) => {
      const sel = state.selection;
      if (!sel.empty) return false;
      const $from = sel.$from;
      if ($from.parent.type.name !== "paragraph") return false;
      const text = $from.parent.textContent;
      if (!/^\|.+\|$/.test(text)) return false;
      const parts = text.split("|");
      // Leading + trailing `|` always produce empty first/last entries.
      const cells = parts.slice(1, -1).map((c) => c.trim());
      if (cells.length < 2) return false;

      if (dispatch) {
        const headerRow = schema.nodes.table_row.create(
          null,
          cells.map((c) =>
            schema.nodes.table_cell.create(
              { header: true, align: null },
              c ? [schema.text(c)] : [],
            ),
          ),
        );
        const bodyRow = schema.nodes.table_row.create(
          null,
          cells.map(() =>
            schema.nodes.table_cell.create(
              { header: false, align: null },
              [],
            ),
          ),
        );
        const tableNode = schema.nodes.table.create(null, [headerRow, bodyRow]);

        const paraStart = $from.before();
        const paraEnd = $from.after();
        const tr = state.tr;
        tr.replaceWith(paraStart, paraEnd, tableNode);
        // Cursor inside first body cell. Position: paraStart (= table
        // start) + 1 (table open) + headerRow.nodeSize + 1 (body row open)
        // + 1 (first cell open).
        const firstBodyCell = paraStart + 1 + headerRow.nodeSize + 2;
        tr.setSelection(TextSelection.create(tr.doc, firstBodyCell));
        dispatch(tr);
      }
      return true;
    },
  }),

  parserTokens: {
    table_open: (state, _tok, schema) => {
      state.openNode(schema.nodes.table);
    },
    table_close: (state) => {
      state.closeNode();
    },
    // thead/tbody are wrappers in md-it but our schema is flat — skip them.
    thead_open: () => {},
    thead_close: () => {},
    tbody_open: () => {},
    tbody_close: () => {},
    tr_open: (state, _tok, schema) => {
      state.openNode(schema.nodes.table_row);
    },
    tr_close: (state) => {
      state.closeNode();
    },
    th_open: (state, tok, schema) => {
      const align = parseAlignFromStyle(tok.attrGet("style"));
      state.openNode(schema.nodes.table_cell, { header: true, align });
    },
    th_close: (state) => {
      state.closeNode();
    },
    td_open: (state, tok, schema) => {
      const align = parseAlignFromStyle(tok.attrGet("style"));
      state.openNode(schema.nodes.table_cell, { header: false, align });
    },
    td_close: (state) => {
      state.closeNode();
    },
  },

  blockHandlers: {
    table: (state, node) => {
      // Render every cell first so we can measure column widths and
      // emit nicely padded source on save. Two-pass (measure → emit).
      const rows: string[][] = [];
      const aligns: Array<string | null> = [];
      node.forEach((row, _, rowIdx) => {
        const cells: string[] = [];
        row.forEach((cell, _o, cellIdx) => {
          if (rowIdx === 0) aligns[cellIdx] = cell.attrs.align as string | null;
          cells.push(renderCellInline(cell));
        });
        rows.push(cells);
      });

      const colCount = aligns.length;
      const widths = new Array<number>(colCount).fill(3);
      for (const r of rows)
        for (let i = 0; i < colCount; i++)
          widths[i] = Math.max(widths[i]!, (r[i] ?? "").length);

      const formatRow = (cells: string[]): string => {
        const padded = cells.map((c, i) => " " + c.padEnd(widths[i]!) + " ");
        return "|" + padded.join("|") + "|";
      };
      const dividerRow = (): string => {
        const dividers = aligns.map((a, i) => " " + alignDelim(a, widths[i]!) + " ");
        return "|" + dividers.join("|") + "|";
      };

      // Header row → divider → body rows.
      state.write(formatRow(rows[0] ?? []));
      state.out += "\n";
      if (state.delim) state.out += state.delim;
      state.out += dividerRow();
      for (let i = 1; i < rows.length; i++) {
        state.out += "\n";
        if (state.delim) state.out += state.delim;
        state.out += formatRow(rows[i]!);
      }
      state.closeBlock(node);
    },
  },

};
