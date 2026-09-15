import type MarkdownIt from "markdown-it";
import type { RuleBlock } from "markdown-it/lib/parser_block.mjs";

// Adapted from markdown-it's lheading rule (MIT); see THIRD_PARTY_NOTICES.txt.

/** A Setext underline needs at least three consecutive, identical markers. */
export function setextHeadingLevel(line: string): number | null {
  if (/^={3,}[\t ]*$/.test(line)) return 1;
  if (/^-{3,}[\t ]*$/.test(line)) return 2;
  return null;
}

const strictSetextHeading: RuleBlock = (state, startLine, endLine) => {
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
  const parentType = state.parentType;
  state.parentType = "paragraph";
  try {
    const terminators = state.md.block.ruler.getRules("paragraph");
    for (let line = startLine + 1; line < endLine && !state.isEmpty(line); line++) {
      if (state.sCount[line]! - state.blkIndent > 3) continue;
      if (state.sCount[line]! >= state.blkIndent) {
        const underline = state.src.slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]);
        const level = setextHeadingLevel(underline);
        if (level !== null) {
          state.line = line + 1;
          const open = state.push("heading_open", `h${level}`, 1);
          open.markup = underline[0]!;
          open.map = [startLine, state.line];
          const inline = state.push("inline", "", 0);
          inline.content = state.getLines(startLine, line, state.blkIndent, false)
            .replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
          inline.map = [startLine, line];
          inline.children = [];
          state.push("heading_close", `h${level}`, -1).markup = underline[0]!;
          return true;
        }
      }
      if (state.sCount[line]! < 0) continue;
      if (terminators.some((rule) => rule(state, line, endLine, true))) break;
    }
    return false;
  } finally {
    state.parentType = parentType;
  }
};

export function strictSetextHeadings(md: MarkdownIt): void {
  md.block.ruler.at("lheading", strictSetextHeading);
}
