import { EditorState, Plugin, TextSelection, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { parse, markdownParser } from "../parser.ts";
import { schema } from "../schema.ts";
import { defaultPlugins } from "../editor.ts";
import { mdConfig, serialize, serializeWith } from "../serializer.ts";
import { safeLink, type MintContext } from "./context.ts";

export type EditorMode = "live" | "source" | "reading";
export interface EditorOptions extends MintContext {
  initialContent?: string; documentKey?: string;
  onChange?: (markdown: string, documentKey: string) => void;
  onModeChange?: (mode: EditorMode) => void;
  getScrollViewport?: () => { element: HTMLElement; top: number; bottom: number } | null;
}
export interface InsertionBookmark { insert(markdown: string): boolean; dispose(): void }
export interface Editor {
  getMarkdown(): string; loadDocument(key: string, markdown: string): void; setMarkdown(markdown: string): void;
  replaceMarkdown(markdown: string): void; setMode(mode: EditorMode): void;
  getSelectionOffset(): number; setSelectionOffset(offset: number): void;
  getMarkdownOffsetAtPoint(x: number, y: number): number;
  createInsertionBookmark(offset?: number): InsertionBookmark; createInsertionBookmarkAtPoint(x: number, y: number): InsertionBookmark;
  jumpToHeading(index: number): boolean; refreshPresentation(): void; flush(): void; isComposing(): boolean; focus(): void; destroy(): void;
}

export function documentOutline(markdown: string): { level: number; text: string; line: number; offset: number }[] {
  const lines = markdown.split(/\r\n|\r|\n/), offsets: number[] = []; let cursor = 0;
  for (const match of markdown.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) { offsets.push(cursor); cursor += match[0].length; }
  const tokens = markdownParser.parse(markdown, {}), result: ReturnType<typeof documentOutline> = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]; if (token.type !== "heading_open" || token.level !== 0 || !token.map) continue;
    const line = token.map[0], inline = tokens[i + 1];
    const text = (inline?.children ?? []).filter(child => !child.type.endsWith("_open") && !child.type.endsWith("_close")).map(child => child.content).join("").replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => alias || target).replace(/[*_~`]/g, "").trim();
    if (lines[line] !== undefined) result.push({ level: Number(token.tag.slice(1)), text, line, offset: offsets[line] ?? 0 });
  } return result;
}

export function createMintEditor(host: HTMLElement, options: EditorOptions = {}, depth = 0): Editor {
  let markdown = options.initialContent ?? "", documentKey = options.documentKey ?? "note", generation = 0;
  let mode: EditorMode = options.readOnly ? "reading" : "live", composing = false, destroyed = false, suppress = false;
  let pendingMode: EditorMode | null = null, pendingLoad: { key: string; source: string } | null = null;
  let sourcePrevious = markdown;
  let compositionTimer: ReturnType<typeof setTimeout> | undefined;
  const bookmarks = new Set<{ from: number; to: number; source: boolean; generation: number; valid: boolean }>();
  const wrap = document.createElement("div"), live = document.createElement("div"), source = document.createElement("textarea");
  wrap.className = "typora-web-wrap"; live.className = "typora-web-editor-host"; source.className = "typora-web-source"; source.setAttribute("aria-label", options.label?.("sourceLabel") ?? "Markdown source"); source.hidden = true; wrap.append(live, source); host.append(wrap);
  const context: MintContext = { ...options, readOnly: mode === "reading", revision: 0,
    renderMarkdown: (container, text) => {
      if (depth >= 4) { container.textContent = text; return; }
      const nested = createMintEditor(container, { ...options, documentKey, initialContent: text, readOnly: true, onChange: undefined, getScrollViewport: undefined }, depth + 1); return () => nested.destroy();
    } };
  const readonly = new Plugin({ filterTransaction: tr => suppress || !context.readOnly || !tr.docChanged });
  const makeState = (text: string) => {
    const state = EditorState.create({ schema, doc: parse(text), plugins: [...defaultPlugins(Object.assign(context, { cursorWidget: false })), readonly] });
    const previous = suppress; suppress = true;
    try { return state.apply(state.tr.setSelection(TextSelection.atStart(state.doc))); } finally { suppress = previous; }
  };
  const emit = (text: string) => { if (destroyed || text === markdown) return; markdown = text; options.onChange?.(text, documentKey); };
  const mapSourceBookmarks = (before: string, after: string) => {
    let start = 0; while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let end = before.length, next = after.length; while (end > start && next > start && before[end - 1] === after[next - 1]) { end--; next--; }
    const difference = next - end;
    for (const bookmark of bookmarks) if (bookmark.source && bookmark.valid) {
      if (bookmark.from >= end) { bookmark.from += difference; bookmark.to += difference; }
      else if (bookmark.to > start) bookmark.valid = false;
    }
  };
  const onTransaction = (tr: Transaction) => {
    if (destroyed) return;
    const previous = view.state.doc, result = view.state.applyTransaction(tr);
    for (const transaction of result.transactions) if (transaction.docChanged) for (const bookmark of bookmarks) if (!bookmark.source && bookmark.valid) {
      const from = transaction.mapping.mapResult(bookmark.from, 1), to = transaction.mapping.mapResult(bookmark.to, -1);
      bookmark.valid = !from.deletedAcross && !to.deletedAcross; bookmark.from = from.pos; bookmark.to = Math.max(from.pos, to.pos);
    }
    view.updateState(result.state);
    if (!suppress && mode !== "reading" && tr.docChanged && !previous.eq(result.state.doc) && !composing && !view.composing) {
      const next = serialize(result.state.doc);
      // Empty body placeholders may change the model without editing Markdown.
      if (!tr.getMeta("mint-presentation-only") || next !== serialize(previous)) emit(next);
    }
    if (tr.scrolledIntoView) revealCaret();
  };
  const view = new EditorView(live, { state: makeState(markdown), editable: () => mode !== "reading", dispatchTransaction: onTransaction,
    handleDOMEvents: {
      compositionstart: () => { composing = true; return false; },
      compositionend: () => { scheduleFlush(); return false; },
      click: (_view, event) => {
        const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
        if (!anchor || mode !== "reading") return false;
        const href = anchor.getAttribute("href") ?? ""; event.preventDefault();
        if (href.startsWith("#")) { let id = href.slice(1); try { id = decodeURIComponent(id); } catch { /* Keep malformed fragment literal. */ } [...host.querySelectorAll<HTMLElement>("[id]")].find(element => element.id === id)?.scrollIntoView({ block: "nearest" }); }
        else if (safeLink(href)) window.open(href, "_blank", "noopener,noreferrer"); return true;
      },
      drop: (_view, event) => { if (event.dataTransfer?.files.length) { event.preventDefault(); return true; } return false; }
    }
  });
  live.classList.toggle("mint-reading", mode === "reading");
  function revealCaret() {
    const viewport = options.getScrollViewport?.(); if (!viewport || mode === "source") return;
    try { const rect = view.coordsAtPos(view.state.selection.head), bounds = viewport.element.getBoundingClientRect();
      if (rect.top < bounds.top + viewport.top) viewport.element.scrollTop -= bounds.top + viewport.top - rect.top;
      else if (rect.bottom > bounds.bottom - viewport.bottom) viewport.element.scrollTop += rect.bottom - bounds.bottom + viewport.bottom;
    } catch { /* A detached view has no measurable caret. */ }
  }
  function scheduleFlush() { if (compositionTimer) clearTimeout(compositionTimer); compositionTimer = setTimeout(() => { compositionTimer = undefined; flush(); }, 20); }
  function flush() {
    if (destroyed) return;
    if (compositionTimer) clearTimeout(compositionTimer); compositionTimer = undefined;
    if (view.composing) { scheduleFlush(); return; }
    if (composing) { composing = false; if (mode === "source") emit(source.value); else if (mode !== "reading") emit(serialize(view.state.doc)); }
    if (pendingLoad) { const load = pendingLoad; pendingLoad = null; loadDocument(load.key, load.source); }
    if (pendingMode) { const next = pendingMode; pendingMode = null; setMode(next); }
  }
  function offsetAtPosition(pos: number): number {
    let marker = "\u0000position\u0000"; while (markdown.includes(marker)) marker += "\u0000";
    const result = serializeWith(view.state.doc, mdConfig, [{ pos, char: marker }]); const offset = result.indexOf(marker); return Math.min(markdown.length, Math.max(0, offset));
  }
  function positionAtOffset(offset: number): number { return Math.min(view.state.doc.content.size, Math.max(1, parse(markdown.slice(0, offset)).content.size - 1)); }
  function getSelectionOffset() { return mode === "source" ? source.selectionEnd : offsetAtPosition(view.state.selection.head); }
  function setSelectionOffset(offset: number) {
    const clamped = Math.max(0, Math.min(markdown.length, offset));
    if (mode === "source") { source.setSelectionRange(clamped, clamped); return; }
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(positionAtOffset(clamped)))).scrollIntoView());
  }
  function resizeSource() { source.style.height = "auto"; source.style.height = `${Math.max(source.scrollHeight, 168)}px`; }
  function setMode(next: EditorMode) {
    if (destroyed || next === mode) return;
    if (composing || view.composing) { pendingMode = next; return; }
    const offset = getSelectionOffset();
    // Positions are owned by a specific input surface, never guessed across a mode boundary.
    bookmarks.forEach(bookmark => { bookmark.valid = false; });
    const wasSource = mode === "source"; mode = next; context.readOnly = next === "reading";
    if (next === "source") { source.value = markdown; sourcePrevious = markdown; source.hidden = false; live.hidden = true; resizeSource(); source.setSelectionRange(offset, offset); }
    else { source.hidden = true; live.hidden = false; suppress = true;
      if (wasSource) view.updateState(makeState(markdown));
      view.setProps({ editable: () => mode !== "reading" }); view.dispatch(view.state.tr.setMeta("mint-refresh", ++context.revision!)); setSelectionOffset(offset); suppress = false;
    }
    live.classList.toggle("mint-reading", next === "reading"); options.onModeChange?.(next);
  }
  function loadDocument(key: string, text: string) {
    if (destroyed) return;
    generation++; bookmarks.clear();
    if (composing || view.composing) { pendingLoad = { key, source: text }; return; }
    generation++; documentKey = key; bookmarks.clear(); markdown = text;
    suppress = true; view.updateState(makeState(text)); suppress = false; source.value = text; sourcePrevious = text; if (mode === "source") resizeSource();
  }
  source.addEventListener("input", () => { const before = sourcePrevious; sourcePrevious = source.value; mapSourceBookmarks(before, source.value); if (!composing) emit(source.value); resizeSource(); });
  source.addEventListener("compositionstart", () => { composing = true; }); source.addEventListener("compositionend", scheduleFlush);
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "/" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || mode === "reading") return;
    event.preventDefault(); setMode(mode === "source" ? "live" : "source"); if (mode === "source") source.focus(); else view.focus();
  };
  wrap.addEventListener("keydown", keydown);
  function createBookmark(offset?: number, position?: number): InsertionBookmark {
      const selected = view.state.selection;
      const bookmark = { from: mode === "source" ? offset ?? source.selectionStart : position ?? (offset === undefined ? selected.from : positionAtOffset(offset)),
        to: mode === "source" ? offset ?? source.selectionEnd : position ?? (offset === undefined ? selected.to : positionAtOffset(offset)), source: mode === "source", generation, valid: !context.readOnly };
      bookmarks.add(bookmark);
      return { insert(text) {
        if (!bookmark.valid || destroyed || composing || view.composing || context.readOnly || bookmark.generation !== generation) return false;
        if (bookmark.source) { const before = markdown, next = before.slice(0, bookmark.from) + text + before.slice(bookmark.to); source.value = next; sourcePrevious = next; mapSourceBookmarks(before, next); emit(next); resizeSource(); }
        else view.dispatch(view.state.tr.insertText(text, bookmark.from, bookmark.to).setMeta("uiEvent", "paste"));
        bookmark.valid = false; bookmarks.delete(bookmark); return true;
      }, dispose() { bookmark.valid = false; bookmarks.delete(bookmark); } };
    }
  return {
    getMarkdown: () => markdown, loadDocument, setMarkdown: text => { if (text !== markdown) loadDocument(documentKey, text); },
    replaceMarkdown(text) {
      if (destroyed || context.readOnly || composing || view.composing || text === markdown) return;
      if (mode === "source") { const before = markdown; source.value = text; sourcePrevious = text; mapSourceBookmarks(before, text); emit(text); resizeSource(); }
      else view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, parse(text).content).setMeta("uiEvent", "mint-property"));
    }, setMode, getSelectionOffset, setSelectionOffset,
    getMarkdownOffsetAtPoint: (x, y) => { const pos = view.posAtCoords({ left: x, top: y })?.pos; return pos === undefined ? getSelectionOffset() : offsetAtPosition(pos); },
    createInsertionBookmark: offset => createBookmark(offset),
    createInsertionBookmarkAtPoint(x, y) {
      if (mode === "source") return createBookmark();
      const position = view.posAtCoords({ left: x, top: y })?.pos;
      return position === undefined ? { insert: () => false, dispose() {} } : createBookmark(undefined, position);
    },
    jumpToHeading(index) {
      if (mode === "source") { const heading = documentOutline(markdown)[index]; if (!heading) return false; setSelectionOffset(heading.offset); return true; }
      const heading = [...view.dom.children].filter(element => /^H[1-6]$/.test(element.tagName))[index];
      if (!heading) return false; heading.scrollIntoView({ block: "center" }); return true;
    },
    refreshPresentation() { if (!destroyed && !composing && !view.composing) { suppress = true; view.dispatch(view.state.tr.setMeta("mint-refresh", ++context.revision!)); suppress = false; } },
    flush, isComposing: () => composing || view.composing, focus() { if (mode === "source") source.focus(); else view.focus(); },
    destroy() { if (destroyed) return; destroyed = true; generation++; if (compositionTimer) clearTimeout(compositionTimer); bookmarks.clear(); pendingLoad = null; pendingMode = null; context.footnotes?.clear(); options.initialContent = undefined; (context as EditorOptions).initialContent = undefined; wrap.removeEventListener("keydown", keydown); view.updateState(EditorState.create({ schema })); view.destroy(); source.value = ""; sourcePrevious = ""; markdown = ""; wrap.remove(); }
  };
}
