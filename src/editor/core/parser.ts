import MarkdownIt from "markdown-it";
import Token from "markdown-it/lib/token.mjs";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type { RuleBlock } from "markdown-it/lib/parser_block.mjs";
import {
  Fragment,
  Mark,
  type Attrs,
  type MarkType,
  type Node as PMNode,
  type NodeType,
} from "prosemirror-model";

import {
  collectMdItPlugins,
  collectParserPostProcessors,
  collectParserSourceProtectors,
  collectParserTokens,
} from "./features/index";
import { parseFencedCodeSource } from "./fenced-code-source";
import { LIVE_SYNTAX_EDITING, LIVE_SYNTAX_RENDERING } from "./live-syntax-state";
import { schema } from "./schema";
import {
  SOURCE_FINGERPRINT_ATTR,
  SOURCE_FROM_ATTR,
  SOURCE_TEXT_ATTR,
  SOURCE_TO_ATTR,
} from "./source";
import { sourceFingerprint } from "./source-fingerprint";
import { projectTableSource } from "./table-source";

const md: MarkdownIt = new MarkdownIt("commonmark", { html: false });
for (const plugin of collectMdItPlugins()) md.use(plugin);
const parserSourceProtectors = collectParserSourceProtectors();

const INCOMPLETE_BLOCK_CHARACTERS = new Set(["*", "+", "-", ".", ")", "="]);

type SourceLine = { text: string; from: number };

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let from = 0;
  while (from <= source.length) {
    let to = from;
    while (to < source.length && source[to] !== "\r" && source[to] !== "\n") to += 1;
    lines.push({ text: source.slice(from, to), from });
    if (to >= source.length) break;
    from = source[to] === "\r" && source[to + 1] === "\n" ? to + 2 : to + 1;
  }
  return lines;
}

function cloneToken(token: Token): Token {
  const clone = new Token(token.type, token.tag, token.nesting);
  Object.assign(clone, token);
  clone.attrs = token.attrs?.map(([name, value]) => [name, value]) ?? null;
  clone.map = token.map ? [token.map[0], token.map[1]] : null;
  return clone;
}

function orderedListStart(line: string, fallback: number): number {
  const match = /^ {0,3}(\d+)[.)][\t ]+/.exec(line);
  return match ? Number(match[1]) : fallback;
}

/**
 * CommonMark deliberately keeps blank-line-separated items in one loose
 * list. Live mode needs the author's blank row to remain a real source gap,
 * because each side is an independently editing syntax structure. Split only
 * top-level list tokens here; the canonical Markdown remains untouched.
 */
function splitTopLevelListBlocks(tokens: readonly Token[], lines: readonly SourceLine[]): Token[] {
  const result: Token[] = [];
  for (let index = 0; index < tokens.length;) {
    const open = tokens[index]!;
    const isTopLevelList = open.level === 0
      && open.nesting === 1
      && (open.type === "bullet_list_open" || open.type === "ordered_list_open");
    if (!isTopLevelList) {
      result.push(open);
      index += 1;
      continue;
    }

    const closeType = open.type.replace("_open", "_close");
    let closeIndex = index + 1;
    while (closeIndex < tokens.length) {
      const candidate = tokens[closeIndex]!;
      if (candidate.level === 0 && candidate.type === closeType) break;
      closeIndex += 1;
    }
    if (closeIndex >= tokens.length || !open.map) {
      result.push(open);
      index += 1;
      continue;
    }

    const boundaries: number[] = [];
    for (let tokenIndex = index + 1; tokenIndex < closeIndex; tokenIndex += 1) {
      const candidate = tokens[tokenIndex]!;
      if (candidate.type !== "list_item_open" || candidate.level !== 1 || !candidate.map) continue;
      const itemLine = candidate.map[0];
      if (itemLine > open.map[0] && !lines[itemLine - 1]?.text.trim()) {
        boundaries.push(tokenIndex);
      }
    }
    if (boundaries.length === 0) {
      result.push(...tokens.slice(index, closeIndex + 1));
      index = closeIndex + 1;
      continue;
    }

    const segmentStarts = [index + 1, ...boundaries];
    const segmentEnds = [...boundaries, closeIndex];
    for (let segment = 0; segment < segmentStarts.length; segment += 1) {
      const firstTokenIndex = segmentStarts[segment]!;
      const endTokenIndex = segmentEnds[segment]!;
      const firstItem = tokens[firstTokenIndex]!;
      const nextItem = tokens[endTokenIndex];
      const fromLine = firstItem.map?.[0] ?? open.map[0];
      const toLine = nextItem?.map?.[0] ?? open.map[1];
      const segmentOpen = cloneToken(open);
      segmentOpen.map = [fromLine, toLine];
      if (segmentOpen.type === "ordered_list_open") {
        segmentOpen.attrSet(
          "start",
          String(orderedListStart(lines[fromLine]?.text ?? "", Number(open.attrGet("start") ?? 1))),
        );
      }
      result.push(segmentOpen, ...tokens.slice(firstTokenIndex, endTokenIndex));
      result.push(cloneToken(tokens[closeIndex]!));
    }
    index = closeIndex + 1;
  }
  return result;
}

/**
 * Protect source spellings whose CommonMark meaning differs from Mint Notes'
 * Live presentation. Same-size private sentinels preserve every UTF-16 source
 * boundary, and ParserState restores the authored characters immediately.
 *
 * Feature-owned protections also use this boundary when plain markdown-it
 * would otherwise consume syntax that the feature must present from exact
 * authored text. The feature declares only character offsets; sentinel
 * allocation and restoration remain centralized here.
 */
function protectLiveParserSpellings(source: string): {
  parserSource: string;
  restoration: ReadonlyMap<string, string>;
} {
  // Offsets throughout the editor are UTF-16 code-unit offsets. `split("")`
  // intentionally follows that model; code-point iteration would shift a
  // later candidate whenever an astral character appears earlier in source.
  const characters = source.split("");
  const sentinels = new Map<string, string>();
  const restoration = new Map<string, string>();
  let nextSentinel = 0xE001;
  const sentinelFor = (character: string): string | null => {
    const existing = sentinels.get(character);
    if (existing) return existing;
    while (nextSentinel <= 0xF8FF) {
      const candidate = String.fromCharCode(nextSentinel++);
      if (source.includes(candidate) || restoration.has(candidate)) continue;
      sentinels.set(character, candidate);
      restoration.set(candidate, character);
      return candidate;
    }
    return null;
  };
  let changed = false;
  for (const line of sourceLines(source)) {
    for (const protect of parserSourceProtectors) {
      for (const lineOffset of protect(line.text)) {
        const character = line.text[lineOffset];
        if (character === undefined) continue;
        const sentinel = sentinelFor(character);
        if (!sentinel) continue;
        const sourceOffset = line.from + lineOffset;
        if (characters[sourceOffset] !== sentinel) {
          characters[sourceOffset] = sentinel;
          changed = true;
        }
      }
    }
    if (!/^( {0,3})(?:[*+-]|\d+[.)]|={1,2}|-{1,2})$/.test(line.text)) continue;
    for (let index = 0; index < line.text.length; index += 1) {
      const character = line.text[index]!;
      if (!INCOMPLETE_BLOCK_CHARACTERS.has(character)) continue;
      const sentinel = sentinelFor(character);
      if (!sentinel) continue;
      const sourceOffset = line.from + index;
      if (characters[sourceOffset] !== sentinel) {
        characters[sourceOffset] = sentinel;
        changed = true;
      }
    }
  }
  return {
    parserSource: changed ? characters.join("") : source,
    restoration,
  };
}

function restoreProtectedCharacters(
  text: string,
  restoration: ReadonlyMap<string, string>,
): string {
  let restored = text;
  for (const [sentinel, character] of restoration) {
    restored = restored.replaceAll(sentinel, character);
  }
  return restored;
}

// markdown-it normally exposes an escaped character without the authored
// backslash. Live mode treats that backslash as canonical Markdown and hides
// it only through a decoration, so retain the exact escape pair in the model.
md.core.ruler.after("inline", "preserve_manual_escapes", (state) => {
  for (const token of state.tokens) {
    if (token.type !== "inline") continue;
    for (const child of token.children ?? []) {
      if (child.type === "text_special" && child.info === "escape") {
        child.content = child.markup;
      }
    }
  }
});

function isNestedListItem(state: StateBlock, line: number): boolean {
  if (state.listIndent < 0 || line >= state.lineMax) return false;
  const indent = state.sCount[line]! - state.blkIndent;
  if (indent < 0 || indent > 3) return false;
  const text = state.src.slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]);
  // A separator distinguishes list items (including empty ones) from
  // unfinished markers. Nested ordered items retain their authored number
  // when Enter followed by Tab moves them under the preceding item.
  return /^(?:[-+*]|\d{1,9}[.)])[\t ]+/.test(text);
}

function paragraphEndLine(state: StateBlock, startLine: number, endLine: number, stopAtSetext = false): number {
  const terminatorRules = state.md.block.ruler.getRules("paragraph");
  let nextLine = startLine + 1;
  for (; nextLine < endLine && !state.isEmpty(nextLine); nextLine++) {
    if (state.sCount[nextLine]! - state.blkIndent > 3) continue;
    if (state.sCount[nextLine]! < 0) continue;
    if (isNestedListItem(state, nextLine)) break;
    if (stopAtSetext && state.sCount[nextLine]! >= state.blkIndent) {
      const text = state.src.slice(state.bMarks[nextLine]! + state.tShift[nextLine]!, state.eMarks[nextLine]);
      if (/^(?:=+|-+)[\t ]*$/.test(text)) break;
    }
    if (terminatorRules.some((rule) => rule(state, nextLine, endLine, true))) break;
  }
  return nextLine;
}

// Preserve trailing whitespace inside paragraphs.
//
// The default paragraph rule does `state.getLines(...).trim()` on the
// final content, which discards trailing spaces. That breaks lossless
// round-trip — md text `"[a](url) "` would parse to a doc whose text is
// `"[a](url)"`, dropping a real source char. We replace the rule with
// the same logic minus the trim, since the only whitespace we'd want to
// strip (leading indent, trailing newline) is already handled by
// `blkIndent` and getLines' `keepLastLF=false`.
const paragraphPreserveTrailing: RuleBlock = (state, startLine, endLine) => {
  const oldParentType = state.parentType;
  state.parentType = "paragraph";
  const nextLine = paragraphEndLine(state, startLine, endLine);

  const content = state.getLines(startLine, nextLine, state.blkIndent, false);
  state.line = nextLine;

  state.push("paragraph_open", "p", 1).map = [startLine, state.line];
  const token_i = state.push("inline", "", 0);
  token_i.content = content;
  token_i.map = [startLine, state.line];
  token_i.children = [];
  state.push("paragraph_close", "p", -1);

  state.parentType = oldParentType;
  return true;
};
md.block.ruler.at("paragraph", paragraphPreserveTrailing);

// Enter followed by Tab creates an empty nested item. CommonMark otherwise
// treats "- " as a Setext underline, and empty markers or ordered markers
// above 1 as continuation text. End the parent paragraph first so the list
// rule can own the new item and keep owning it when text is entered.
md.block.ruler.before("lheading", "paragraph_before_nested_list", (state, startLine, endLine, silent) => {
  if (silent || state.listIndent < 0) return false;
  const oldParentType = state.parentType;
  state.parentType = "paragraph";
  const nextLine = paragraphEndLine(state, startLine, endLine, true);
  state.parentType = oldParentType;
  if (nextLine >= endLine || state.isEmpty(nextLine) || !isNestedListItem(state, nextLine)) return false;
  return paragraphPreserveTrailing(state, startLine, endLine, false);
});

const featureTokens = collectParserTokens();

type Frame = { type: NodeType; attrs: Attrs | null; content: PMNode[] };

export class ParserState {
  private stack: Frame[] = [{ type: schema.nodes.doc, attrs: null, content: [] }];
  private marks: readonly Mark[] = Mark.none;

  constructor(private readonly protectedCharacterRestoration: ReadonlyMap<string, string> = new Map()) {}

  literalInline(source: string, from: number, to: number): void {
    this.top().attrs = { ...this.top().attrs, sourceLiteral: true, sourceFrom: from, sourceTo: to, sourceText: source };
    this.addText(source);
  }

  private top(): Frame {
    return this.stack[this.stack.length - 1]!;
  }

  push(node: PMNode): void {
    this.top().content.push(node);
  }

  addText(text: string): void {
    if (!text) return;
    this.top().content.push(schema.text(
      restoreProtectedCharacters(text, this.protectedCharacterRestoration),
      this.marks,
    ));
  }

  openMark(mark: Mark): void {
    this.marks = mark.addToSet(this.marks);
  }

  closeMarkType(type: MarkType): void {
    this.marks = this.marks.filter((m) => m.type !== type);
  }

  // Peek the currently-open mark of a given type (so a close-handler can
  // read attrs before closing — link needs href for its close delim).
  topMark(type: MarkType): Mark | undefined {
    return this.marks.find((m) => m.type === type);
  }

  openNode(type: NodeType, attrs: Attrs | null = null): void {
    this.stack.push({ type, attrs, content: [] });
  }

  closeNode(): void {
    const frame = this.stack.pop();
    if (!frame) throw new Error("closeNode: stack underflow");
    let node = frame.type.createAndFill(frame.attrs, frame.content);
    if (node?.type.name === "table" && typeof frame.attrs?.sourceText === "string") {
      node = projectTableSource(node, frame.attrs.sourceText, Number(frame.attrs.sourceFrom))
        ?? schema.nodes.source_block.create({ kind: "unmapped-table", ...frame.attrs }, schema.text(frame.attrs.sourceText));
    }
    if (!node) throw new Error(`parser: cannot fill <${frame.type.name}>`);
    // Only an actually empty list item needs its marker projected here.
    // createAndFill may prepend a required paragraph before a heading; that
    // synthetic paragraph must not cause us to discard the authored heading.
    if (
      node.type.name === "list_item"
      && typeof frame.attrs?.sourceText === "string"
      && frame.content.length === 0
      && node.firstChild?.type.name === "paragraph"
      && !node.firstChild.textContent
      && node.firstChild.attrs.sourceFrom === null
    ) {
      const paragraph = schema.nodes.paragraph.createChecked({ ...frame.attrs, sourceLiteral: true }, schema.text(frame.attrs.sourceText));
      node = node.copy(Fragment.from(paragraph));
    }
    if (node.type.name === "quote_container" && typeof frame.attrs?.sourceText === "string") {
      const from = Number(frame.attrs.sourceFrom);
      const to = Number(frame.attrs.sourceTo);
      const children: PMNode[] = [];
      let cursor = from;
      // Empty quotes have no parsed children. Do not retain createAndFill's
      // synthetic paragraph: the authored marker gap already owns their rows.
      frame.content.forEach((child) => {
        const childFrom = Number(child.attrs.sourceFrom);
        const childTo = Number(child.attrs.sourceTo);
        if (child.attrs.sourceFrom !== null && Number.isInteger(childFrom) && childFrom > cursor) {
          children.push(sourceGapNode(frame.attrs!.sourceText.slice(cursor - from, childFrom - from), cursor, childFrom, to + 1));
        }
        children.push(child);
        if (child.attrs.sourceTo !== null && Number.isInteger(childTo)) cursor = childTo;
      });
      if (cursor < to) children.push(sourceGapNode(frame.attrs.sourceText.slice(cursor - from), cursor, to, to + 1));
      node = node.type.createChecked(node.attrs, children);
    }
    this.top().content.push(node);
  }

  finish(): PMNode {
    while (this.stack.length > 1) this.closeNode();
    const root = this.stack[0]!;
    const doc = root.type.createAndFill(null, root.content);
    if (!doc) throw new Error("parser: cannot build doc");
    return doc;
  }
}

function stripBlockquotePrefix(line: string): string {
  let remaining = line;
  while (/^ {0,3}>/.test(remaining)) {
    remaining = remaining.replace(/^ {0,3}> ?/, "");
  }
  return remaining;
}

function fenceSourceLines(token: Token, src: string): string[] {
  if (!token.map) return [];
  const lines = src.split("\n").slice(token.map[0], token.map[1]);
  if (lines.at(-1)?.endsWith("\r")) lines[lines.length - 1] = lines.at(-1)!.slice(0, -1);
  const quoted = /^ {0,3}>/.test(lines[0] ?? "");
  return quoted ? lines.map(stripBlockquotePrefix) : lines;
}

function sourceFenceIsClosed(token: Token, src: string): boolean {
  if (!token.map || token.map[1] <= token.map[0] + 1) return false;
  const closingLine = fenceSourceLines(token, src).at(-1)?.trim() ?? "";
  const marker = token.markup[0];
  if (!marker || closingLine[0] !== marker) return false;
  let markerLength = 0;
  while (closingLine[markerLength] === marker) markerLength++;
  return markerLength >= token.markup.length
    && closingLine.slice(markerLength).trim().length === 0;
}

function sourceForToken(token: Token, src: string): string {
  if (!token.map) return token.content;
  return fenceSourceLines(token, src).join("\n");
}

function sourceForBlockquote(token: Token, src: string): string {
  if (!token.map) return "> ";
  const lines = src.split("\n").slice(token.map[0], token.map[1]);
  if (lines.at(-1)?.endsWith("\r")) lines[lines.length - 1] = lines.at(-1)!.slice(0, -1);
  if (token.level === 0) return lines.join("\n");

  const first = lines[0] ?? "";
  const markerOffset = first.search(/>/);
  if (markerOffset <= 0) return lines.join("\n");

  // markdown-it token maps are document-relative. When a quote lives in a
  // list item, the list serializer owns the outer indentation, so keep the
  // exact quote spelling relative to that container.
  return lines.map((line) => line.slice(Math.min(markerOffset, line.length))).join("\n");
}

function blockquoteCloseIndex(tokens: Token[], openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index]?.type === "blockquote_open") depth += 1;
    else if (tokens[index]?.type === "blockquote_close" && --depth === 0) return index;
  }
  return openIndex;
}

function handleBlock(
  state: ParserState,
  token: Token,
  src: string,
  listItemSourceGapBefore = 0,
): void {
  const { nodes } = schema;
  switch (token.type) {
    case "paragraph_open":
      state.openNode(nodes.paragraph);
      return;
    case "paragraph_close":
      state.closeNode();
      return;
    case "heading_open": {
      // markdown-it sets token.markup to "#"/"##"/... for ATX and "="/"-"
      // for setext (lheading). We capture it as a `style` attr so the
      // serializer can emit the same shape on round-trip.
      const markup = token.markup;
      const style = markup === "=" || markup === "-" ? "setext" : "atx";
      state.openNode(nodes.heading, {
        level: Number(token.tag.slice(1)),
        style,
      });
      return;
    }
    case "heading_close":
      state.closeNode();
      return;
    case "bullet_list_open":
      state.openNode(nodes.bullet_list);
      return;
    case "bullet_list_close":
      state.closeNode();
      return;
    case "ordered_list_open": {
      const raw = token.attrGet("start");
      state.openNode(nodes.ordered_list, { start: raw ? Number(raw) : 1 });
      return;
    }
    case "ordered_list_close":
      state.closeNode();
      return;
    case "list_item_open":
      state.openNode(nodes.list_item, { sourceGapBefore: listItemSourceGapBefore });
      return;
    case "list_item_close":
      state.closeNode();
      return;
    case "fence": {
      const source = sourceForToken(token, src);
      const textNodes = source ? [schema.text(source)] : [];
      state.push(nodes.code_block.createChecked({
        lang: token.info.trim(),
        liveSyntaxState: sourceFenceIsClosed(token, src) ? LIVE_SYNTAX_RENDERING : LIVE_SYNTAX_EDITING
          || parseFencedCodeSource(source)?.closingFrom === null,
      }, textNodes));
      return;
    }
    case "code_block": {
      const content = token.content.replace(/\n$/, "");
      const source = `\`\`\`\n${content}\n\`\`\``;
      const textNodes = [schema.text(source)];
      state.push(nodes.code_block.createChecked({ lang: "" }, textNodes));
      return;
    }
    case "hr":
      state.push(nodes.horizontal_rule.create({ markup: token.markup || "---" }));
      return;
    case "inline": {
      for (const child of token.children ?? []) handleInline(state, child);
      return;
    }
    default: {
      const handler = featureTokens[token.type];
      if (handler) handler(state, token, schema);
      return;
    }
  }
}

function handleInline(state: ParserState, token: Token): void {
  const { nodes } = schema;
  switch (token.type) {
    case "text":
      state.addText(token.content);
      return;
    case "softbreak":
      // Preserve md soft-wrap newlines as "\n" so the serializer round-trips them
      state.addText("\n");
      return;
    case "hardbreak":
      state.push(nodes.hard_break.create());
      return;
    default: {
      const handler = featureTokens[token.type];
      if (handler) handler(state, token, schema);
      return;
    }
  }
}

type SourceBlockRange = { from: number; to: number };

function originalLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function contentEndOfLine(source: string, start: number): number {
  let end = start;
  while (end < source.length && source[end] !== "\r" && source[end] !== "\n") end += 1;
  return end;
}

function topLevelSourceRanges(tokens: readonly Token[], source: string): SourceBlockRange[] {
  const starts = originalLineStarts(source);
  const ranges: SourceBlockRange[] = [];
  for (const token of tokens) {
    if (
      !token.block
      || token.level !== 0
      || !token.map
      || token.type === "inline"
      || token.nesting === -1
    ) continue;
    const [fromLine, toLine] = token.map;
    if (toLine <= fromLine) continue;
    const from = starts[fromLine] ?? source.length;
    // markdown-it includes trailing blank lines in some container maps,
    // notably lists. Those rows are not represented by the rich block and
    // therefore belong to a top-level source_gap instead of the block's
    // authored snapshot. Keep internal blank lines because a later nonblank
    // line still belongs to the same container.
    let lastContentLine = toLine - 1;
    while (token.type !== "fence" && lastContentLine > fromLine) {
      const candidateStart = starts[lastContentLine] ?? source.length;
      const candidateEnd = contentEndOfLine(source, candidateStart);
      if (source.slice(candidateStart, candidateEnd).trim().length > 0) break;
      lastContentLine -= 1;
    }
    const lastLineStart = starts[lastContentLine] ?? source.length;
    // An unclosed fence also owns trailing blank rows, including the final
    // line ending. They must not turn into editable gaps outside the code.
    const to = token.type === "fence" && !sourceFenceIsClosed(token, source)
      ? starts[toLine] ?? source.length
      : contentEndOfLine(source, lastLineStart);
    const previous = ranges.at(-1);
    if (previous?.from === from && previous.to === to) continue;
    ranges.push({ from, to });
  }
  return ranges;
}

function sourceGapContent(
  source: string,
  hideFirstLineEnding: boolean,
): PMNode[] {
  const lineEndings = [...source.matchAll(/\r\n|\r|\n/g)];
  const children: PMNode[] = [];
  let cursor = 0;
  const pushText = (text: string): void => {
    if (text) children.push(schema.text(text));
  };
  for (const [index, match] of lineEndings.entries()) {
    const start = match.index;
    pushText(source.slice(cursor, start));
    const ending = match[0];
    // Only the first line ending belongs to the preceding rendered block.
    // Every later ending terminates an authored blank row and must own that
    // row's DOM height so native pointer placement resolves to its exact
    // canonical source boundary instead of a synthetic trailing break.
    const visible = !(hideFirstLineEnding && index === 0);
    for (let characterIndex = 0; characterIndex < ending.length; characterIndex += 1) {
      const character = ending[characterIndex]!;
      children.push(schema.nodes.source_gap_eol.createChecked({
        character,
        // CRLF is one authored line ending. Its CR remains a separately
        // addressable source character while the LF alone owns presentation.
        visible: visible && characterIndex === ending.length - 1,
      }));
    }
    cursor = start + ending.length;
  }
  pushText(source.slice(cursor));
  return children;
}

function sourceGapNode(
  source: string,
  from: number,
  to: number,
  fullSourceLength: number,
): PMNode {
  const node = schema.nodes.source_gap.createChecked(
    {
      structuralOnly: from > 0
        && to < fullSourceLength
        && /^(?:\r\n|\r|\n)$/.test(source),
      [SOURCE_FROM_ATTR]: from,
      [SOURCE_TO_ATTR]: to,
      [SOURCE_TEXT_ATTR]: source,
    },
    sourceGapContent(source, from > 0 && /^[\r\n]/.test(source)),
  );
  return node.type.createChecked({
    ...node.attrs,
    [SOURCE_FINGERPRINT_ATTR]: sourceFingerprint(node),
  }, node.content);
}

function withSourceRange(node: PMNode, range: SourceBlockRange, source: string): PMNode {
  if (node.isTextblock && node.type.name !== "source_gap") {
    node = node.type.createChecked({ ...node.attrs,
      sourceLiteral: ["paragraph", "heading"].includes(node.type.name),
    }, source ? schema.text(source) : undefined);
  }
  if (node.type.name === "table") {
    node = projectTableSource(node, source, range.from)
      ?? schema.nodes.source_block.create({ kind: "unmapped-table" }, schema.text(source));
  }
  return node.type.createChecked({
    ...node.attrs,
    [SOURCE_FROM_ATTR]: range.from,
    [SOURCE_TO_ATTR]: range.to,
    [SOURCE_TEXT_ATTR]: source,
    [SOURCE_FINGERPRINT_ATTR]: sourceFingerprint(node),
  }, node.content, node.marks);
}

function restoreParagraphLineEndings(node: PMNode, source: string): PMNode {
  if (node.type.name !== "paragraph") return node;
  const endings = [...source.matchAll(/\r\n|\r|\n/g)].map((match) => match[0]);
  let endingIndex = 0;
  const rewrite = (child: PMNode): PMNode => {
    if (child.isText) {
      const text = (child.text ?? "").replaceAll("\n", () => endings[endingIndex++] ?? "\n");
      return schema.text(text, child.marks);
    }
    if (child.type.name === "hard_break") {
      return child.type.create({ ...child.attrs, eol: endings[endingIndex++] ?? "\n" });
    }
    if (child.childCount === 0) return child;
    const children: PMNode[] = [];
    child.forEach((nested) => children.push(rewrite(nested)));
    return child.copy(Fragment.from(children));
  };
  const children: PMNode[] = [];
  node.forEach((child) => children.push(rewrite(child)));
  return node.copy(Fragment.from(children));
}

function addSourceGaps(doc: PMNode, tokens: readonly Token[], source: string): PMNode {
  if (!source) return schema.nodes.doc.createChecked(null, [schema.nodes.paragraph.create({
    sourceFrom: 0, sourceTo: 0, sourceText: "", sourceLiteral: true,
  })]);
  const ranges = topLevelSourceRanges(tokens, source);
  if (ranges.length === 0) {
    return schema.nodes.doc.createChecked(null, [sourceGapNode(source, 0, source.length, source.length)]);
  }
  if (ranges.length !== doc.childCount) return doc;

  const children: PMNode[] = [];
  let cursor = 0;
  doc.forEach((child, _offset, index) => {
    const range = ranges[index]!;
    if (range.from > cursor) {
      children.push(sourceGapNode(
        source.slice(cursor, range.from),
        cursor,
        range.from,
        source.length,
      ));
    }
    const authoredSource = source.slice(range.from, range.to);
    children.push(withSourceRange(
      restoreParagraphLineEndings(child, authoredSource),
      range,
      authoredSource,
    ));
    cursor = range.to;
  });
  if (cursor < source.length) {
    children.push(sourceGapNode(source.slice(cursor), cursor, source.length, source.length));
  }
  return schema.nodes.doc.createChecked(null, children);
}

export interface ParseOptions {
  /**
   * Keep canonical whitespace as explicit Live-only source blocks. Feature
   * unit tests may disable this to exercise an isolated upstream-derived
   * transform without changing its historical tree fixtures.
   */
  readonly sourceGaps?: boolean;
}

export function parse(src: string, options: ParseOptions = {}): PMNode {
  const protectedSource = protectLiveParserSpellings(src);
  const lines = sourceLines(src);
  const tokens = splitTopLevelListBlocks(
    md.parse(protectedSource.parserSource, {}),
    lines,
  );
  const state = new ParserState(protectedSource.restoration);
  const listHasItem: boolean[] = [];
  const compositeQuotes: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.type === "blockquote_open") {
      const source = sourceForBlockquote(token, src);
      const close = blockquoteCloseIndex(tokens, index);
      const composite = options.sourceGaps !== false && (
        !/^[\t >]*\[!/.test(source) || tokens.slice(index, close).some((part) => part.type === "table_open")
      );
      if (composite) {
        const from = lines[token.map![0]]!.from;
        // Empty quotes can include following unquoted blank lines in their
        // token map. Those lines belong outside the quote's border.
        let lastLine = token.map![1] - 1;
        while (lastLine > token.map![0] && !lines[lastLine]!.text.trim()) lastLine--;
        const last = lines[lastLine]!;
        const to = last.from + last.text.length;
        state.openNode(schema.nodes.quote_container, { sourceFrom: from, sourceTo: to, sourceText: src.slice(from, to) });
        compositeQuotes.push(token.level);
      } else {
        state.push(schema.nodes.blockquote.createChecked(
          { liveSyntaxState: LIVE_SYNTAX_RENDERING }, source ? schema.text(source) : undefined,
        ));
        index = close;
      }
      continue;
    }
    if (token.type === "blockquote_close" && compositeQuotes.at(-1) === token.level) {
      state.closeNode();
      compositeQuotes.pop();
      continue;
    }
    if (options.sourceGaps !== false && token.type === "inline" && token.map && (
      listHasItem.length > 0 || compositeQuotes.length > 0 || tokens[index - 1]?.type === "heading_open"
    )) {
      const from = lines[token.map[0]]?.from ?? 0;
      // Setext inline tokens exclude the underline row. It is still authored
      // text and must remain addressable inside lists and quotes as well.
      const heading = tokens[index - 1];
      const endLine = heading?.type === "heading_open" ? heading.map?.[1] ?? token.map[1] : token.map[1];
      const lastLine = lines[endLine - 1]!;
      const to = lastLine.from + lastLine.text.length;
      state.literalInline(src.slice(from, to), from, to);
      continue;
    }
    if (options.sourceGaps !== false && token.type === "table_open" && token.map) {
      const from = lines[token.map[0]]!.from;
      const last = lines[token.map[1] - 1]!;
      const to = last.from + last.text.length;
      state.openNode(schema.nodes.table, { sourceFrom: from, sourceTo: to, sourceText: src.slice(from, to) });
      continue;
    }
    if (options.sourceGaps !== false && token.type === "list_item_open" && token.map) {
      const line = lines[token.map[0]]!;
      let sourceGapBefore = 0;
      if (listHasItem.at(-1)) {
        for (let row = token.map[0] - 1; row >= 0 && !lines[row]!.text.trim(); row--) sourceGapBefore++;
      }
      state.openNode(schema.nodes.list_item, { sourceGapBefore, sourceFrom: line.from, sourceTo: line.from + line.text.length, sourceText: line.text });
      if (listHasItem.length) listHasItem[listHasItem.length - 1] = true;
      continue;
    }
    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      listHasItem.push(false);
    }
    let listItemSourceGapBefore = 0;
    if (token.type === "list_item_open" && listHasItem.at(-1) === true && token.map) {
      for (let line = token.map[0] - 1; line >= 0 && !lines[line]!.text.trim(); line -= 1) {
        listItemSourceGapBefore += 1;
      }
    }
    handleBlock(state, token, src, listItemSourceGapBefore);
    if (token.type === "list_item_open" && listHasItem.length > 0) {
      listHasItem[listHasItem.length - 1] = true;
    }
    if (token.type === "bullet_list_close" || token.type === "ordered_list_close") {
      listHasItem.pop();
    }
  }
  let doc = state.finish();
  for (const f of collectParserPostProcessors()) doc = f(doc);
  return options.sourceGaps === false ? doc : addSourceGaps(doc, tokens, src);
}
