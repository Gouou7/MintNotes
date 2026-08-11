import type { SourceSelection, SourceTransaction } from "./source";

type LiveSourceKey = "Enter" | "Backspace" | "Delete" | "Tab";

type LineContext = {
  readonly from: number;
  readonly to: number;
  readonly text: string;
};

type ListPrefix = {
  readonly full: string;
  readonly indent: string;
  readonly marker: string;
  readonly task: boolean;
};

const QUOTE_PREFIX = /^( {0,3}(?:>[\t ]?)+)/;
const LIST_PREFIX = /^(\s*)((?:[-+*])|(?:\d+[.)]))([\t ]+)(?:\[([^\]\r\n])\]([\t ]+))?/;

function lineContext(source: string, offset: number): LineContext {
  let from = offset;
  while (from > 0 && source[from - 1] !== "\n" && source[from - 1] !== "\r") from -= 1;
  let to = offset;
  while (to < source.length && source[to] !== "\n" && source[to] !== "\r") to += 1;
  return {
    from,
    to,
    text: source.slice(from, to),
  };
}

function listPrefix(line: string): ListPrefix | null {
  const match = LIST_PREFIX.exec(line);
  if (!match) return null;
  const full = match[0];
  return {
    full,
    indent: match[1]!,
    marker: match[2]!,
    task: match[4] !== undefined,
  };
}

function nextListPrefix(prefix: ListPrefix): string {
  const ordered = /^(\d+)([.)])$/.exec(prefix.marker);
  const marker = ordered
    ? `${Number(ordered[1]) + 1}${ordered[2]}`
    : prefix.marker;
  return `${prefix.indent}${marker} ${prefix.task ? "[ ] " : ""}`;
}

function transaction(
  selection: SourceSelection,
  from: number,
  to: number,
  insert: string,
  origin: SourceTransaction["origin"],
): SourceTransaction {
  const head = from + insert.length;
  return {
    edits: [{ from, to, insert }],
    selection: { anchor: head, head },
    origin,
    reparseDerivedDocument: true,
  };
}

function enterTransaction(
  source: string,
  selection: SourceSelection,
  shiftKey: boolean,
): SourceTransaction {
  const from = Math.min(selection.anchor, selection.head);
  const to = Math.max(selection.anchor, selection.head);
  const line = lineContext(source, from);
  const beforeLine = source.slice(line.from, from);
  const selectedLine = beforeLine + source.slice(to, line.to);
  const list = listPrefix(selectedLine);
  const atLineEnd = to === line.to;

  if (shiftKey) {
    if (list) {
      const continuationIndent = " ".repeat(list.full.length);
      return transaction(selection, from, to, `\n${continuationIndent}`, "input");
    }
    return transaction(selection, from, to, "  \n", "input");
  }

  if (list && atLineEnd) {
    const contentBefore = beforeLine.slice(list.full.length);
    const contentAfter = source.slice(to, line.to);
    if (!`${contentBefore}${contentAfter}`.trim()) {
      return transaction(
        selection,
        line.from,
        line.from + list.full.length,
        "",
        "command",
      );
    }
    return transaction(selection, from, to, `\n${nextListPrefix(list)}`, "command");
  }

  const quote = QUOTE_PREFIX.exec(selectedLine);
  if (quote) {
    const prefix = quote[1]!;
    const contentBefore = beforeLine.slice(prefix.length);
    const contentAfter = source.slice(to, line.to);
    const bareCandidate = prefix === ">" && line.text === ">";
    if (atLineEnd && !bareCandidate && !`${contentBefore}${contentAfter}`.trim()) {
      return transaction(selection, line.from, line.from + prefix.length, "", "command");
    }
    return transaction(selection, from, to, `\n${prefix}`, "command");
  }

  return transaction(selection, from, to, "\n", "input");
}

function tabTransaction(
  source: string,
  selection: SourceSelection,
  shiftKey: boolean,
): SourceTransaction | null {
  if (selection.anchor !== selection.head) return null;
  const line = lineContext(source, selection.head);
  const list = listPrefix(line.text);
  if (!list) return null;

  if (shiftKey) {
    if (!list.indent) return null;
    const remove = Math.min(
      list.indent.length,
      /\d+[.)]/.test(list.marker) ? list.marker.length + 1 : 2,
    );
    const head = Math.max(line.from, selection.head - remove);
    return {
      edits: [{ from: line.from, to: line.from + remove, insert: "" }],
      selection: { anchor: head, head },
      origin: "command",
      reparseDerivedDocument: true,
    };
  }

  const indent = " ".repeat(/\d+[.)]/.test(list.marker) ? list.marker.length + 1 : 2);
  const head = selection.head + indent.length;
  return {
    edits: [{ from: line.from, to: line.from, insert: indent }],
    selection: { anchor: head, head },
    origin: "command",
    reparseDerivedDocument: true,
  };
}

/** Canonical-source implementations of keys whose Markdown meaning is structural. */
export function liveSourceKeyTransaction(
  source: string,
  selection: SourceSelection,
  key: LiveSourceKey,
  shiftKey = false,
): SourceTransaction | null {
  if (key === "Enter") return enterTransaction(source, selection, shiftKey);
  if (key === "Tab") return tabTransaction(source, selection, shiftKey);

  const from = Math.min(selection.anchor, selection.head);
  const to = Math.max(selection.anchor, selection.head);
  if (from !== to) return transaction(selection, from, to, "", "delete");
  if (key === "Backspace") {
    if (from === 0) return null;
    return transaction(selection, from - 1, from, "", "delete");
  }
  if (to === source.length) return null;
  return transaction(selection, to, to + 1, "", "delete");
}
