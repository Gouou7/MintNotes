import type { ResolvedPos } from "prosemirror-model";

/** Match authored container/heading markers, including list continuation indent. */
export function sourceLinePrefix(text: string, inContainer: boolean): string {
  const prefix = /^(?:[\t ]*(?:>[\t ]?|(?:[-+*]|\d+[.)])[\t ]+))*(?:[\t ]*#{1,6}[\t ]+)?/.exec(text)![0];
  const indent = inContainer ? /^[\t ]*/.exec(text.slice(prefix.length))![0] : "";
  return prefix + indent;
}

/**
 * Markers use monospace columns so their negative margin matches their actual
 * width without measuring/replacing the native text surface. Reuse container
 * indents and the document's smallest side padding; long prefixes stay readable
 * by letting only the excess width enter the text column.
 */
export function sourceLinePrefixStyle(prefix: string, ancestors: ResolvedPos, task: boolean): string {
  let columns = 0;
  let leadingColumns = 0;
  let onlyIndent = true;
  for (const character of prefix) {
    columns += character === "\t" ? 4 - columns % 4 : 1;
    onlyIndent &&= character === " " || character === "\t";
    if (onlyIndent) leadingColumns = columns;
  }
  let indent = 0;
  let borders = 0;
  for (let depth = 1; depth < ancestors.depth; depth++) {
    const type = ancestors.node(depth).type.name;
    if (type === "bullet_list" || type === "ordered_list") indent += 1.6;
    if (type === "quote_container") {
      indent += 1;
      borders += 3;
    }
  }
  return `--source-prefix-width: ${columns}ch; `
    // Leading source whitespace carries no ink and can extend past the gutter.
    + `--source-prefix-gutter: calc(${leadingColumns}ch + var(--markdown-body-font-size, 1rem) * ${Number(indent.toFixed(1))} + ${borders + 18}px); `
    + `--source-prefix-body-offset: ${task ? "22px" : "0px"};`;
}
