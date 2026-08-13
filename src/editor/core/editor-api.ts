// Public façade. Consumers see only `createEditor()` and the small `Editor`
// controller it returns; ProseMirror is an implementation detail and is never
// exposed to application code.
//
// Source-mode toggle (rendered ↔ raw markdown textarea) is built in.
// `⌘/` (Mac) or `Ctrl+/` (other) is wired automatically; consumers
// can also call `editor.toggleSource()` directly.

import type { Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { defaultPlugins } from "./editor";
import { parse } from "./parser";
import { schema } from "./schema";
import type { EditorExtension } from "./extension";
import { SOURCE_BLOCK_PRESENTATION_META } from "./extension";
import { INLINE_PRESENTATION_META } from "./inline-parse";
import { SourcePositionMap } from "./source-position-map";
import { authoredDocumentSource, sourceFingerprint } from "./source-fingerprint";
import {
  CanonicalSource,
  replaceSourceRange,
  SOURCE_FINGERPRINT_ATTR,
  SOURCE_FROM_ATTR,
  SOURCE_TEXT_ATTR,
  SOURCE_TO_ATTR,
  type SourceTransaction,
} from "./source";
import { SOURCE_TRANSACTION_META, transactionSourceEffect } from "./source-transaction";
import { liveSourceKeyTransaction } from "./live-source-commands";
import { selectionOutsideBlock, verticalSourceOffset } from "./source-navigation";

export interface EditorOptions {
  /** Initial markdown the editor opens with. Defaults to empty. */
  initialContent?: string;
  /** Fired on every document transaction; arg is the current markdown. Raw, no debounce. */
  onChange?: (md: string) => void;
  /** Fired when the editor surface (rendered or source) gains focus. */
  onFocus?: () => void;
  /** Fired when the editor surface loses focus. */
  onBlur?: () => void;
  /** Optional editor-owned behavior and presentation extensions. */
  extensions?: readonly EditorExtension[];
  /** Resolve authored image sources to presentation-only URLs. `null` means loading. */
  resolveImageSource?: (source: string) => string | null | undefined;
}

export interface Editor {
  /** Current markdown — renders source from the live PM doc, or returns the textarea contents in source mode. */
  getMarkdown(): string;
  /** Replace the document. Works in either rendered or source mode. */
  setMarkdown(md: string): void;
  /** Resolve viewport coordinates to an offset in canonical Markdown. */
  getMarkdownOffsetAtPoint(clientX: number, clientY: number): number;
  /** Insert Markdown at an explicit offset or at the current selection. */
  insertMarkdown(markdown: string, offset?: number): void;
  /** Replace the complete document and place the caret at a Markdown offset. */
  replaceMarkdown(markdown: string, offset?: number): void;
  /** Read the active caret/selection head as a canonical Markdown offset. */
  getSelectionOffset(): number;
  /** Restore the caret from a canonical Markdown offset. */
  setSelectionOffset(offset: number): void;
  /** Recompute presentation-only decorations without changing Markdown or history. */
  refreshPresentation(): void;
  /** Execute a command registered by an editor extension. */
  runExtensionCommand<Result>(command: string, input?: unknown): Result | undefined;
  /** Flip between rendered and raw-source views. ⌘/ does the same. */
  toggleSource(): void;
  /** Whether the editor is currently in raw-source mode. */
  isSourceMode(): boolean;
  /** Focus whichever surface is active. */
  focus(): void;
  /** Tear down the editor and remove its DOM. */
  destroy(): void;
}

export function createEditor(
  host: HTMLElement,
  options: EditorOptions = {},
): Editor {
  const wrap = document.createElement("div");
  wrap.className = "typora-web-wrap";
  const editorHost = document.createElement("div");
  editorHost.className = "typora-web-editor-host";
  const sourceTextarea = document.createElement("textarea");
  sourceTextarea.className = "typora-web-source";
  sourceTextarea.hidden = true;
  wrap.append(editorHost, sourceTextarea);
  host.append(wrap);

  let view: EditorView;
  let inSource = false;
  let canonicalMarkdown = options.initialContent ?? "";
  type SourceHistoryEntry = { source: string; selection: { anchor: number; head: number } };
  const sourceUndo: SourceHistoryEntry[] = [];
  const sourceRedo: SourceHistoryEntry[] = [];
  const SOURCE_HISTORY_LIMIT = 500;

  function structureSignatureForDocument(doc: PMNode): string {
    const visit = (node: PMNode): unknown => {
      const attributes = Object.fromEntries(
        Object.entries(node.attrs).filter(([name]) => (
          name !== SOURCE_FROM_ATTR
          && name !== SOURCE_TO_ATTR
          && name !== SOURCE_TEXT_ATTR
          && name !== SOURCE_FINGERPRINT_ATTR
          && name !== "sourceEditing"
        )),
      );
      const children: unknown[] = [];
      node.forEach((child) => {
        if (!child.isText) children.push(visit(child));
      });
      return [node.type.name, attributes, children];
    };
    return JSON.stringify(visit(doc));
  }

  function analyzeDerivedStructure(source: string): { document: PMNode; signature: string } {
    const doc = parse(source);
    return { document: doc, signature: structureSignatureForDocument(doc) };
  }

  const initialDerivedStructure = analyzeDerivedStructure(canonicalMarkdown);
  let canonicalPositionDocument = initialDerivedStructure.document;
  let canonicalStructureSignature = initialDerivedStructure.signature;
  let pendingDerivedStructure: {
    source: string;
    document: PMNode;
    signature: string;
  } | null = null;

  function updateCanonicalStructureSignature(): void {
    if (pendingDerivedStructure?.source === canonicalMarkdown) {
      canonicalPositionDocument = pendingDerivedStructure.document;
      canonicalStructureSignature = pendingDerivedStructure.signature;
    } else {
      const analysis = analyzeDerivedStructure(canonicalMarkdown);
      canonicalPositionDocument = analysis.document;
      canonicalStructureSignature = analysis.signature;
    }
    pendingDerivedStructure = null;
  }

  function sourcePositionMapForState(state: EditorState): SourcePositionMap {
    let hasActiveSourcePresentation = false;
    state.doc.descendants((node) => {
      if (
        node.type.name === "source_block"
        || (["blockquote", "code_block"].includes(node.type.name)
          && node.attrs.sourceEditing === true)
      ) {
        hasActiveSourcePresentation = true;
        return false;
      }
      return true;
    });
    return SourcePositionMap.fromDocument(
      hasActiveSourcePresentation
        || structureSignatureForDocument(state.doc) !== canonicalStructureSignature
        ? state.doc
        : canonicalPositionDocument,
      canonicalMarkdown,
    );
  }

  function rememberSourceHistory(
    stack: SourceHistoryEntry[],
    entry: SourceHistoryEntry,
  ): void {
    stack.push(entry);
    if (stack.length > SOURCE_HISTORY_LIMIT) stack.shift();
  }

  function sourceRangeAtOffset(offset: number): {
    pos: number;
    from: number;
    to: number;
    source: string;
    kind: string;
    presentationKind: string;
  } | null {
    let found: ReturnType<typeof sourceRangeAtOffset> = null;
    let gapFallback: ReturnType<typeof sourceRangeAtOffset> = null;
    view.state.doc.forEach((node, pos) => {
      const from = node.attrs[SOURCE_FROM_ATTR];
      const to = node.attrs[SOURCE_TO_ATTR];
      const source = node.attrs[SOURCE_TEXT_ATTR];
      if (
        Number.isInteger(from)
        && Number.isInteger(to)
        && typeof source === "string"
        && from <= offset
        && offset <= to
      ) {
        const presentationKind = node.type.name === "heading"
          ? `heading-${String(node.attrs.level ?? 1)}`
          : node.type.name;
        const candidate = { pos, from, to, source, kind: node.type.name, presentationKind };
        // A gap and either neighboring block share their source boundary.
        // Prefer the real block there so a structural line ending activates
        // the heading/paragraph edge instead of exposing a phantom gap row.
        if (node.type.name === "source_gap") gapFallback ??= candidate;
        else found ??= candidate;
      }
    });
    return found ?? gapFallback;
  }

  function activateSourceBoundary(offset: number): boolean {
    const range = sourceRangeAtOffset(offset);
    if (!range || ["paragraph", "source_gap", "source_block"].includes(range.kind)) return false;
    if (range.kind === "blockquote" || range.kind === "code_block") {
      const node = view.state.doc.nodeAt(range.pos);
      if (!node) return false;
      const tr = view.state.tr.setNodeMarkup(range.pos, undefined, {
        ...node.attrs,
        sourceEditing: true,
      });
      const localOffset = Math.max(0, Math.min(offset - range.from, node.content.size));
      tr.setSelection(TextSelection.create(tr.doc, range.pos + 1 + localOffset));
      tr.setMeta("addToHistory", false);
      tr.setMeta(SOURCE_BLOCK_PRESENTATION_META, true);
      view.dispatch(tr);
      return true;
    }
    const sourceBlockType = schema.nodes.source_block;
    if (!sourceBlockType) return false;
    const base = sourceBlockType.createChecked({
      kind: range.presentationKind,
      [SOURCE_FROM_ATTR]: range.from,
      [SOURCE_TO_ATTR]: range.to,
      [SOURCE_TEXT_ATTR]: range.source,
    }, range.source ? schema.text(range.source) : undefined);
    const sourceBlock = sourceBlockType.createChecked({
      ...base.attrs,
      [SOURCE_FINGERPRINT_ATTR]: sourceFingerprint(base),
    }, base.content);
    const tr = view.state.tr.replaceWith(
      range.pos,
      range.pos + view.state.doc.nodeAt(range.pos)!.nodeSize,
      sourceBlock,
    );
    const target = range.pos + 1 + Math.max(0, Math.min(offset - range.from, range.source.length));
    tr.setSelection(TextSelection.create(tr.doc, target));
    tr.setMeta("addToHistory", false);
    tr.setMeta(SOURCE_BLOCK_PRESENTATION_META, true);
    view.dispatch(tr);
    return true;
  }

  function moveActiveSourceBlockVertically(direction: -1 | 1): boolean {
    const { state } = view;
    const { selection } = state;
    const node = selection.$from.parent;
    if (!selection.empty || node.type.name !== "source_block") return false;
    const blockPos = selection.$from.before();
    const targetOffset = verticalSourceOffset(
      node.textContent,
      selection.$from.parentOffset,
      direction,
    );
    if (targetOffset !== null) {
      view.dispatch(
        state.tr
          .setSelection(TextSelection.create(state.doc, blockPos + 1 + targetOffset))
          .setMeta(SOURCE_BLOCK_PRESENTATION_META, true)
          .scrollIntoView(),
      );
      return true;
    }

    const outside = selectionOutsideBlock(state, blockPos, node, direction);
    if (!outside) return false;
    view.dispatch(
      state.tr
        .setSelection(outside)
        .setMeta(SOURCE_BLOCK_PRESENTATION_META, true)
        .scrollIntoView(),
    );
    return true;
  }

  function reparsePresentation(
    state: EditorState,
    sourceSelection: number,
    reactivateSource = false,
  ): void {
    const reparsed = parse(canonicalMarkdown);
    const repair = state.tr.replaceWith(0, state.doc.content.size, reparsed.content);
    const repairedPosition = SourcePositionMap.fromDocument(
      reparsed,
      canonicalMarkdown,
    ).sourceToDocument(sourceSelection, "right");
    repair.setSelection(TextSelection.near(
      repair.doc.resolve(Math.min(repairedPosition, repair.doc.content.size)),
    ));
    repair.setMeta("addToHistory", false);
    repair.setMeta(SOURCE_BLOCK_PRESENTATION_META, true);
    view.updateState(state.apply(repair));
    if (reactivateSource) activateSourceBoundary(sourceSelection);
  }

  function applyCanonicalTransaction(
    transaction: SourceTransaction,
    previousSelection: { anchor: number; head: number },
  ): boolean {
    const applied = new CanonicalSource(canonicalMarkdown).apply(transaction);
    if (applied.source.value === canonicalMarkdown) {
      pendingDerivedStructure = null;
      return false;
    }
    rememberSourceHistory(sourceUndo, {
      source: canonicalMarkdown,
      selection: previousSelection,
    });
    sourceRedo.length = 0;
    canonicalMarkdown = applied.source.value;
    updateCanonicalStructureSignature();
    options.onChange?.(canonicalMarkdown);
    return true;
  }

  function sourceSelectionForState(state: EditorState): { anchor: number; head: number } {
    const positions = sourcePositionMapForState(state);
    return {
      anchor: positions.documentToSource(state.selection.anchor, "left"),
      head: positions.documentToSource(state.selection.head, "right"),
    };
  }

  function applyAndRenderCanonicalTransaction(transaction: SourceTransaction): boolean {
    const previousSelection = sourceSelectionForState(view.state);
    if (!applyCanonicalTransaction(transaction, previousSelection)) return false;
    reparsePresentation(view.state, transaction.selection.head, true);
    return true;
  }

  function restoreSourceHistory(
    from: SourceHistoryEntry[],
    to: SourceHistoryEntry[],
  ): boolean {
    const target = from.pop();
    if (!target) return false;
    rememberSourceHistory(to, {
      source: canonicalMarkdown,
      selection: sourceSelectionForState(view.state),
    });
    canonicalMarkdown = target.source;
    updateCanonicalStructureSignature();
    options.onChange?.(canonicalMarkdown);
    reparsePresentation(view.state, target.selection.head, true);
    return true;
  }

  function buildView(initialMd: string): EditorView {
    const doc = initialMd ? parse(initialMd) : schema.nodes.doc.createAndFill()!;
    const base = EditorState.create({
      schema,
      doc,
      plugins: defaultPlugins({
        cursorWidget: false,
        extensions: options.extensions,
        resolveImageSource: options.resolveImageSource,
      }),
    });
    // Fire one no-op transaction so normalize's appendTransaction runs
    // and method-B marks (em, strong, autolink, etc.) apply on first
    // render. EditorState.create alone runs `state.init` but not
    // `appendTransaction`, leaving parsed-from-seed docs with raw text.
    const state = base.apply(base.tr.setSelection(TextSelection.atStart(doc)));
    const v: EditorView = new EditorView(editorHost, {
      state,
      dispatchTransaction(tr) {
        const beforeCanonical = canonicalMarkdown;
        const beforeSelection = sourceSelectionForState(v.state);
        const editedParent = v.state.selection.$head.parent;
        const editedSourcePresentation = tr.docChanged
          && (
            editedParent.type.name === "source_block"
            || (
              ["blockquote", "code_block"].includes(editedParent.type.name)
              && editedParent.attrs.sourceEditing === true
            )
          );
        const next = v.state.apply(tr);
        v.updateState(next);
        if (tr.docChanged && !tr.getMeta(SOURCE_BLOCK_PRESENTATION_META)) {
          const effect = transactionSourceEffect(tr, beforeCanonical);
          if (effect.kind === "source") {
            const changed = applyCanonicalTransaction(effect.transaction, beforeSelection);
            if (changed && effect.reparseDerivedDocument) {
              reparsePresentation(
                next,
                effect.transaction.selection.head,
                editedSourcePresentation,
              );
            }
          } else if (effect.kind === "unsupported") {
            // Undo/redo may replay a group of presentation and source steps
            // without their original transaction metadata. Recover only when
            // every resulting top-level node still proves an unchanged exact
            // authored snapshot; otherwise fail closed.
            const historySource = authoredDocumentSource(next.doc);
            if (historySource === null) {
              throw new Error("Editor transaction changed the document without a canonical source transaction");
            }
            if (historySource !== canonicalMarkdown) {
              canonicalMarkdown = historySource;
              updateCanonicalStructureSignature();
              options.onChange?.(canonicalMarkdown);
            }
          }
        }
        const currentState = v.state;
        let hasActivatedSourceBlock = false;
        currentState.doc.descendants((node) => {
          if (node.type.name === "source_block") hasActivatedSourceBlock = true;
        });
        const selectionInsideSourceBlock = currentState.selection.$head.parent.type.name === "source_block";
        if (hasActivatedSourceBlock && !selectionInsideSourceBlock) {
          const sourceSelection = sourcePositionMapForState(currentState)
            .documentToSource(currentState.selection.head, "right");
          reparsePresentation(currentState, sourceSelection);
          return;
        }
        if (
          !hasActivatedSourceBlock
          && !tr.docChanged
          && !tr.getMeta(SOURCE_BLOCK_PRESENTATION_META)
        ) {
          const sourceSelection = sourcePositionMapForState(currentState)
            .documentToSource(currentState.selection.head, "right");
          const range = sourceRangeAtOffset(sourceSelection);
          if (range?.kind !== "table") activateSourceBoundary(sourceSelection);
        }
      },
      handleKeyDown(_view, event) {
        const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
        const mod = isMac ? event.metaKey : event.ctrlKey;
        if (
          mod
          && event.key.toLowerCase() === "z"
          && !event.altKey
        ) {
          if (event.shiftKey) restoreSourceHistory(sourceRedo, sourceUndo);
          else restoreSourceHistory(sourceUndo, sourceRedo);
          event.preventDefault();
          return true;
        }
        if (
          (event.key === "ArrowUp" || event.key === "ArrowDown")
          && !event.shiftKey
          && !event.metaKey
          && !event.ctrlKey
          && !event.altKey
          && moveActiveSourceBlockVertically(event.key === "ArrowUp" ? -1 : 1)
        ) {
          event.preventDefault();
          return true;
        }
        if (
          (event.key === "Enter"
            || event.key === "Backspace"
            || event.key === "Delete"
            || event.key === "Tab")
          && !event.metaKey
          && !event.ctrlKey
          && !event.altKey
        ) {
          if (
            event.key === "Backspace"
            && view.state.selection.empty
            && view.state.selection.$head.parentOffset === 0
            && ["blockquote", "code_block", "source_block"].includes(
              view.state.selection.$head.parent.type.name,
            )
          ) {
            const selection = sourceSelectionForState(view.state);
            if (selection.head > 0) setSelectionOffset(selection.head - 1);
            event.preventDefault();
            return true;
          }
          const transaction = liveSourceKeyTransaction(
            canonicalMarkdown,
            sourceSelectionForState(view.state),
            event.key,
            event.shiftKey,
          );
          if (transaction) {
            applyAndRenderCanonicalTransaction(transaction);
            event.preventDefault();
            return true;
          }
        }
        if (
          (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
          || event.metaKey
          || event.ctrlKey
          || event.altKey
        ) return false;
        const current = view.state.selection;
        const positions = sourcePositionMapForState(view.state);
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const head = positions.documentToSource(
          current.head,
          direction < 0 ? "right" : "left",
        );
        const target = Math.max(0, Math.min(head + direction, canonicalMarkdown.length));
        if (
          current.empty
          && !event.shiftKey
          && current.$head.parent.type.name === "source_block"
        ) {
          const sourceFrom = Number(current.$head.parent.attrs[SOURCE_FROM_ATTR]);
          const sourceTo = Number(current.$head.parent.attrs[SOURCE_TO_ATTR]);
          const targetPosition = Number.isInteger(sourceFrom)
            && Number.isInteger(sourceTo)
            && target >= sourceFrom
            && target <= sourceTo
            ? current.$head.before() + 1 + target - sourceFrom
            : positions.sourceToDocument(target, direction < 0 ? "left" : "right");
          view.dispatch(
            view.state.tr
              .setSelection(TextSelection.create(view.state.doc, targetPosition))
              .setMeta(SOURCE_BLOCK_PRESENTATION_META, true)
              .scrollIntoView(),
          );
          event.preventDefault();
          return true;
        }
        if (positions.hasExactSourceBoundary(target)) return false;
        const anchor = positions.documentToSource(current.anchor);
        if (!activateSourceBoundary(target)) return false;
        if (event.shiftKey) {
          const activated = SourcePositionMap.fromDocument(view.state.doc, canonicalMarkdown);
          const anchorPosition = activated.sourceToDocument(anchor, "left");
          const headPosition = activated.sourceToDocument(target, "right");
          view.dispatch(view.state.tr.setSelection(TextSelection.create(
            view.state.doc,
            anchorPosition,
            headPosition,
          )));
        }
        event.preventDefault();
        return true;
      },
      handleDOMEvents: {
        focus: () => { options.onFocus?.(); return false; },
        blur: () => { options.onBlur?.(); return false; },
        copy: (_view, event) => {
          const selection = sourceSelectionForState(view.state);
          if (selection.anchor === selection.head || !event.clipboardData) return false;
          const from = Math.min(selection.anchor, selection.head);
          const to = Math.max(selection.anchor, selection.head);
          event.clipboardData.setData("text/plain", canonicalMarkdown.slice(from, to));
          event.preventDefault();
          return true;
        },
        cut: (_view, event) => {
          const selection = sourceSelectionForState(view.state);
          if (selection.anchor === selection.head || !event.clipboardData) return false;
          const from = Math.min(selection.anchor, selection.head);
          const to = Math.max(selection.anchor, selection.head);
          event.clipboardData.setData("text/plain", canonicalMarkdown.slice(from, to));
          applyAndRenderCanonicalTransaction({
            edits: [{ from, to, insert: "" }],
            selection: { anchor: from, head: from },
            origin: "delete",
            reparseDerivedDocument: true,
          });
          event.preventDefault();
          return true;
        },
      },
      handleTextInput(_view, fromPosition, toPosition, text) {
        const positions = sourcePositionMapForState(view.state);
        const from = positions.documentToSource(fromPosition, "right");
        const to = positions.documentToSource(toPosition, "left");
        if (to < from) return true;
        const head = from + text.length;
        const nextSource = canonicalMarkdown.slice(0, from)
          + text
          + canonicalMarkdown.slice(to);
        const nextDerivedStructure = analyzeDerivedStructure(nextSource);
        pendingDerivedStructure = { source: nextSource, ...nextDerivedStructure };
        const sourceTransaction: SourceTransaction = {
          edits: [{ from, to, insert: text }],
          selection: { anchor: head, head },
          origin: "input",
          ...(canonicalStructureSignature !== nextDerivedStructure.signature
            ? { reparseDerivedDocument: true }
            : {}),
        };
        view.dispatch(
          view.state.tr
            .insertText(text, fromPosition, toPosition)
            .setMeta(SOURCE_TRANSACTION_META, sourceTransaction),
        );
        return true;
      },
      handlePaste(_view, event) {
        const text = event.clipboardData?.getData("text/plain");
        if (text == null) return false;
        const selection = sourceSelectionForState(view.state);
        const from = Math.min(selection.anchor, selection.head);
        const to = Math.max(selection.anchor, selection.head);
        const head = from + text.length;
        applyAndRenderCanonicalTransaction({
          edits: [{ from, to, insert: text }],
          selection: { anchor: head, head },
          origin: "paste",
          reparseDerivedDocument: true,
        });
        return true;
      },
    });
    return v;
  }

  function rebuild(md: string): void {
    view.destroy();
    editorHost.innerHTML = "";
    view = buildView(md);
  }

  // Resize the source textarea to its content height. Called on every
  // input + on entering source mode so the page never shows a nested
  // scrollbar inside the textarea.
  function autoSizeSource(): void {
    sourceTextarea.style.height = "auto";
    sourceTextarea.style.height = `${sourceTextarea.scrollHeight}px`;
  }

  // Find the Y pixel position (in viewport coords) of `offset` inside
  // the textarea. Uses a hidden mirror div with matching font / width /
  // padding / wrap so soft-wrapped lines map correctly.
  function caretYInTextarea(offset: number): number | null {
    const ta = sourceTextarea;
    if (!ta.isConnected) return null;
    const cs = window.getComputedStyle(ta);
    const mirror = document.createElement("div");
    const props = [
      "fontFamily", "fontSize", "fontWeight", "fontStyle",
      "letterSpacing", "lineHeight", "tabSize",
      "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "boxSizing", "whiteSpace", "wordBreak", "wordWrap", "width",
    ] as const;
    for (const p of props) {
      (mirror.style as unknown as Record<string, string>)[p] = cs[p];
    }
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.top = "0";
    mirror.style.left = "0";
    mirror.style.height = "auto";
    const value = ta.value;
    mirror.textContent = value.slice(0, offset);
    const marker = document.createElement("span");
    marker.textContent = "​"; // zero-width space
    mirror.appendChild(marker);
    mirror.appendChild(document.createTextNode(value.slice(offset) || " "));
    document.body.appendChild(mirror);
    const markerRect = marker.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();
    const taRect = ta.getBoundingClientRect();
    document.body.removeChild(mirror);
    return taRect.top + (markerRect.top - mirrorRect.top);
  }

  function scrollTextareaCursorIntoView(): void {
    const offset = sourceTextarea.selectionStart;
    if (offset == null) return;
    const y = caretYInTextarea(offset);
    if (y == null) return;
    const pageY = y + window.scrollY;
    // Aim for the cursor to land roughly 1/3 down the viewport — same
    // visual band PM's tr.scrollIntoView uses for the rendered editor.
    const target = pageY - window.innerHeight / 3;
    window.scrollTo({ top: target, behavior: "instant" as ScrollBehavior });
  }

  function renderedCursorToMdOffset(): number {
    return sourcePositionMapForState(view.state)
      .documentToSource(view.state.selection.head);
  }
  function markdownOffsetAtPoint(clientX: number, clientY: number): number {
    if (inSource) return sourceTextarea.selectionStart ?? sourceTextarea.value.length;
    const position = view.posAtCoords({ left: clientX, top: clientY })?.pos
      ?? view.state.selection.from;
    return sourcePositionMapForState(view.state).documentToSource(position);
  }

  function insertMarkdown(markdown: string, offset?: number): void {
    const current = inSource ? sourceTextarea.value : canonicalMarkdown;
    const insertionOffset = Math.max(0, Math.min(offset ?? renderedCursorToMdOffset(), current.length));
    const applied = replaceSourceRange(
      current,
      { from: insertionOffset, to: insertionOffset },
      markdown,
      "command",
    );
    const next = applied.source.value;
    const nextOffset = insertionOffset + markdown.length;
    if (next === current) return;

    if (inSource) {
      sourceTextarea.value = next;
      sourceTextarea.setSelectionRange(nextOffset, nextOffset);
      canonicalMarkdown = next;
      updateCanonicalStructureSignature();
      autoSizeSource();
    } else {
      applyAndRenderCanonicalTransaction({
        edits: [{ from: insertionOffset, to: insertionOffset, insert: markdown }],
        selection: { anchor: nextOffset, head: nextOffset },
        origin: "command",
        reparseDerivedDocument: true,
      });
      view.focus();
    }
    if (inSource) options.onChange?.(next);
  }

  function replaceMarkdown(markdown: string, offset?: number): void {
    const markdownOffset = Math.max(0, Math.min(offset ?? markdown.length, markdown.length));
    const current = inSource ? sourceTextarea.value : canonicalMarkdown;
    if (markdown === current) {
      setSelectionOffset(markdownOffset);
      return;
    }
    if (inSource) {
      sourceTextarea.value = markdown;
      sourceTextarea.setSelectionRange(markdownOffset, markdownOffset);
      canonicalMarkdown = markdown;
      updateCanonicalStructureSignature();
      autoSizeSource();
      options.onChange?.(markdown);
      return;
    }

    applyAndRenderCanonicalTransaction({
      edits: [{ from: 0, to: canonicalMarkdown.length, insert: markdown }],
      selection: { anchor: markdownOffset, head: markdownOffset },
      origin: "command",
      reparseDerivedDocument: true,
    });
    view.focus();
  }

  function setSelectionOffset(offset: number): void {
    const clamped = Math.max(0, Math.min(offset, canonicalMarkdown.length));
    if (inSource) {
      sourceTextarea.setSelectionRange(clamped, clamped);
      return;
    }
    activateSourceBoundary(clamped);
    const position = Math.min(
      sourcePositionMapForState(view.state).sourceToDocument(clamped, "right"),
      view.state.doc.content.size,
    );
    try {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position))).scrollIntoView());
    } catch {}
  }

  function runExtensionCommand<Result>(command: string, input?: unknown): Result | undefined {
    if (inSource) return undefined;
    for (const extension of options.extensions ?? []) {
      const handler = extension.commands?.[command];
      if (handler) return handler(view, input) as Result;
    }
    return undefined;
  }

  function enterSource(): void {
    const md = canonicalMarkdown;
    const mdCursor = renderedCursorToMdOffset();
    sourceTextarea.value = md;
    editorHost.hidden = true;
    sourceTextarea.hidden = false;
    autoSizeSource();
    sourceTextarea.focus();
    const clamped = Math.min(mdCursor, md.length);
    sourceTextarea.setSelectionRange(clamped, clamped);
    scrollTextareaCursorIntoView();
    inSource = true;
  }

  function exitSource(): void {
    const md = sourceTextarea.value;
    const mdCursor = sourceTextarea.selectionStart ?? md.length;
    const changed = md !== canonicalMarkdown;
    canonicalMarkdown = md;
    updateCanonicalStructureSignature();
    rebuild(md);
    setSelectionOffset(mdCursor);
    sourceTextarea.hidden = true;
    editorHost.hidden = false;
    view.focus();
    inSource = false;
    if (changed) options.onChange?.(md);
  }

  // ⌘/ on Mac, Ctrl+/ elsewhere. Window-level keydown so it works
  // whether the editor or the source textarea has focus; gated on
  // event-target containment so multiple editors don't poach each
  // other's keystrokes.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "/") return;
    const isMac = /Mac/.test(navigator.platform);
    if (!(isMac ? e.metaKey : e.ctrlKey)) return;
    if (e.shiftKey || e.altKey) return;
    const t = e.target as Element | null;
    if (!t) return;
    if (!editorHost.contains(t) && t !== sourceTextarea) return;
    e.preventDefault();
    if (inSource) exitSource();
    else enterSource();
  };
  window.addEventListener("keydown", onKey);

  // Wire textarea focus/blur to the same callbacks as the editor.
  if (options.onFocus) {
    sourceTextarea.addEventListener("focus", () => options.onFocus!());
  }
  if (options.onBlur) {
    sourceTextarea.addEventListener("blur", () => options.onBlur!());
  }
  // Auto-grow the textarea as the user types so the page itself
  // owns the scroll, never the textarea.
  sourceTextarea.addEventListener("input", () => {
    autoSizeSource();
    const next = sourceTextarea.value;
    if (next === canonicalMarkdown) return;
    canonicalMarkdown = next;
    updateCanonicalStructureSignature();
    options.onChange?.(next);
  });

  view = buildView(canonicalMarkdown);

  return {
    getMarkdown(): string {
      return inSource ? sourceTextarea.value : canonicalMarkdown;
    },
    setMarkdown(md: string): void {
      if (md !== canonicalMarkdown) {
        sourceUndo.length = 0;
        sourceRedo.length = 0;
      }
      if (inSource) {
        sourceTextarea.value = md;
        canonicalMarkdown = md;
        updateCanonicalStructureSignature();
        autoSizeSource();
      } else {
        canonicalMarkdown = md;
        updateCanonicalStructureSignature();
        rebuild(md);
      }
    },
    getMarkdownOffsetAtPoint(clientX: number, clientY: number): number {
      return markdownOffsetAtPoint(clientX, clientY);
    },
    insertMarkdown(markdown: string, offset?: number): void {
      insertMarkdown(markdown, offset);
    },
    replaceMarkdown(markdown: string, offset?: number): void {
      replaceMarkdown(markdown, offset);
    },
    getSelectionOffset(): number {
      return inSource ? sourceTextarea.selectionStart ?? canonicalMarkdown.length : renderedCursorToMdOffset();
    },
    setSelectionOffset(offset: number): void {
      setSelectionOffset(offset);
    },
    refreshPresentation(): void {
      if (!inSource) {
        view.dispatch(view.state.tr.setMeta(INLINE_PRESENTATION_META, true));
      }
    },
    runExtensionCommand<Result>(command: string, input?: unknown): Result | undefined {
      return runExtensionCommand<Result>(command, input);
    },
    toggleSource(): void {
      if (inSource) exitSource();
      else enterSource();
    },
    isSourceMode(): boolean {
      return inSource;
    },
    focus(): void {
      if (inSource) sourceTextarea.focus();
      else view.focus();
    },
    destroy(): void {
      window.removeEventListener("keydown", onKey);
      view.destroy();
      wrap.remove();
    },
  };
}
