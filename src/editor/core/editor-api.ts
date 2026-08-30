// Public façade. Consumers see only `createEditor()` and the small `Editor`
// controller it returns; ProseMirror is an implementation detail and is never
// exposed to application code.
//
// Source-mode toggle (rendered ↔ raw markdown textarea) is built in.
// `⌘/` (Mac) or `Ctrl+/` (other) is wired automatically; consumers
// can also call `editor.toggleSource()` directly.

import type { Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { defaultPlugins } from "./editor";
import { parse } from "./parser";
import { schema } from "./schema";
import type {
  BlockSourcePresentation,
  EditorExtension,
} from "./extension";
import { SOURCE_BLOCK_PRESENTATION_META } from "./extension";
import { INLINE_PRESENTATION_META } from "./inline-parse";
import {
  isLiveSyntaxEditing,
  LIVE_SYNTAX_EDITING,
  LIVE_SYNTAX_RENDERING,
} from "./live-syntax-state";
import { SourcePositionMap } from "./source-position-map";
import { authoredDocumentSource, sourceFingerprint } from "./source-fingerprint";
import {
  CanonicalSource,
  replaceSourceRange,
  SOURCE_FINGERPRINT_ATTR,
  SOURCE_FROM_ATTR,
  SOURCE_LAYOUT_HEIGHT_ATTR,
  SOURCE_TEXT_ATTR,
  SOURCE_TO_ATTR,
  type SourceTransaction,
} from "./source";
import { SOURCE_TRANSACTION_META, transactionSourceEffect } from "./source-transaction";
import { SourceComposition } from "./source-composition";
import { liveSourceKeyTransaction } from "./live-source-commands";
import { resolveSourceBlockEditingPresentation } from "./presentation";
import {
  LIVE_NAVIGATION_META,
  LIVE_POINTER_SELECTION_META,
  LIVE_PRESENTATION_SYNC_META,
  markLiveNavigation,
  verticalSourceOffset,
  type LiveNavigationIntent,
} from "./source-navigation";

export interface EditorOptions {
  /** Initial markdown the editor opens with. Defaults to empty. */
  initialContent?: string;
  /** Fired for each committed canonical source change. One IME composition is one change. */
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
  type LiveSourceRange = {
    pos: number;
    from: number;
    to: number;
    source: string;
    kind: string;
    presentationKind: string;
    sourceBlockEditing: boolean;
  };
  type ActiveSourceBlockEditing = {
    from: number;
    to: number;
    presentation: BlockSourcePresentation;
  };
  const blockPresentations = options.extensions?.flatMap(
    (extension) => extension.presentations?.block ?? [],
  ) ?? [];
  const blockHeightCache = new Map<string, number>();
  let blockHeightFrame: number | null = null;
  let blockResizeObserver: ResizeObserver | null = null;
  let compositionFinalizeTimer: ReturnType<typeof setTimeout> | null = null;
  let pointerSelectionActive = false;
  let pointerSelectionCommitTimer: ReturnType<typeof setTimeout> | null = null;
  let detachPointerSelectionListeners: (() => void) | null = null;
  let presentationRefreshPending = false;
  let pendingComposition: {
    source: SourceComposition;
    baseStructureSignature: string;
    reparseRequested: boolean;
  } | null = null;

  function structureSignatureForDocument(doc: PMNode): string {
    const visit = (node: PMNode): unknown => {
      const editingPresentation = node.type.name === "source_block"
        ? null
        : resolveSourceBlockEditingPresentation(node, blockPresentations)?.id ?? null;
      const attributes = Object.fromEntries(
        Object.entries(node.attrs).filter(([name]) => (
          name !== SOURCE_FROM_ATTR
          && name !== SOURCE_TO_ATTR
          && name !== SOURCE_TEXT_ATTR
          && name !== SOURCE_FINGERPRINT_ATTR
          && name !== SOURCE_LAYOUT_HEIGHT_ATTR
          && name !== "liveSyntaxState"
        )),
      );
      const children: unknown[] = [];
      node.forEach((child) => {
        if (!child.isText) children.push(visit(child));
      });
      return [node.type.name, attributes, editingPresentation, children];
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

  function prepareDerivedStructureForTransaction(transaction: SourceTransaction): boolean {
    const nextSource = new CanonicalSource(canonicalMarkdown).apply(transaction).source.value;
    if (nextSource === canonicalMarkdown) return false;
    const analysis = pendingDerivedStructure?.source === nextSource
      ? pendingDerivedStructure
      : { source: nextSource, ...analyzeDerivedStructure(nextSource) };
    pendingDerivedStructure = analysis;
    return analysis.signature !== canonicalStructureSignature;
  }

  function sourcePositionMapForState(state: EditorState): SourcePositionMap {
    if (pendingComposition) {
      return SourcePositionMap.fromDocument(state.doc, pendingComposition.source.source);
    }
    let hasActiveSourcePresentation = false;
    state.doc.descendants((node) => {
      if (
        node.type.name === "source_block"
        || (["blockquote", "code_block"].includes(node.type.name)
          && isLiveSyntaxEditing(node.attrs.liveSyntaxState))
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

  function sourceRangeAtOffsetInDocument(
    doc: PMNode,
    offset: number,
    direction?: -1 | 1,
  ): LiveSourceRange | null {
    const blocks: LiveSourceRange[] = [];
    const gaps: LiveSourceRange[] = [];
    doc.forEach((node, pos) => {
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
        const sourceBlockEditingPresentation = node.type.name === "source_block"
          ? null
          : resolveSourceBlockEditingPresentation(node, blockPresentations);
        const sourceBlockEditing = node.type.name === "source_block"
          || sourceBlockEditingPresentation !== null;
        const presentationKind = sourceBlockEditingPresentation
          ? sourceBlockEditingPresentation.id
          : node.type.name === "heading"
          ? `heading-${String(node.attrs.level ?? 1)}`
          : node.type.name === "source_block"
            ? String(node.attrs.kind ?? "block")
            : node.type.name;
        const candidate = {
          pos,
          from,
          to,
          source,
          kind: node.type.name,
          presentationKind,
          sourceBlockEditing,
        };
        if (node.type.name === "source_gap") gaps.push(candidate);
        else blocks.push(candidate);
      }
    });
    const interior = blocks.find((range) => range.from < offset && offset < range.to);
    if (interior) return interior;
    if (direction === 1) {
      const starting = blocks.find((range) => range.from === offset);
      if (starting) return starting;
    } else if (direction === -1) {
      const ending = [...blocks].reverse().find((range) => range.to === offset);
      if (ending) return ending;
    }
    // A gap and either neighboring block share their source boundary. Prefer
    // a real block there so a structural newline never becomes a phantom row.
    return blocks[0] ?? gaps[0] ?? null;
  }

  function blockHeightKey(range: Pick<LiveSourceRange, "from" | "to" | "source">): string {
    return `${range.from}:${range.to}:${range.source}`;
  }

  function scheduleBlockHeightCache(): void {
    if (blockHeightFrame !== null || typeof requestAnimationFrame !== "function") return;
    blockHeightFrame = requestAnimationFrame(() => {
      blockHeightFrame = null;
      if (!view?.dom.isConnected) return;
      view.state.doc.forEach((node, pos) => {
        if (
          node.type.name === "source_block"
          || (["blockquote", "code_block"].includes(node.type.name)
            && isLiveSyntaxEditing(node.attrs.liveSyntaxState))
        ) return;
        const from = Number(node.attrs[SOURCE_FROM_ATTR]);
        const to = Number(node.attrs[SOURCE_TO_ATTR]);
        const source = node.attrs[SOURCE_TEXT_ATTR];
        if (!Number.isInteger(from) || !Number.isInteger(to) || typeof source !== "string") return;
        const dom = view.nodeDOM(pos);
        if (!(dom instanceof HTMLElement)) return;
        const height = dom.getBoundingClientRect().height;
        if (Number.isFinite(height) && height > 0) {
          blockHeightCache.set(`${from}:${to}:${source}`, Math.round(height * 100) / 100);
        }
      });
    });
  }

  function renderedHeightForRange(range: LiveSourceRange): number | null {
    const cached = blockHeightCache.get(blockHeightKey(range));
    if (cached !== undefined) return cached;
    const renderedDom = view.nodeDOM(range.pos);
    const renderedHeight = renderedDom instanceof HTMLElement
      ? renderedDom.getBoundingClientRect().height
      : 0;
    if (!Number.isFinite(renderedHeight) || renderedHeight <= 0) return null;
    const rounded = Math.round(renderedHeight * 100) / 100;
    blockHeightCache.set(blockHeightKey(range), rounded);
    return rounded;
  }

  function canonicalNodeForRange(from: number, to: number): PMNode | null {
    let found: PMNode | null = null;
    canonicalPositionDocument.forEach((node) => {
      if (
        found === null
        && node.attrs[SOURCE_FROM_ATTR] === from
        && node.attrs[SOURCE_TO_ATTR] === to
      ) found = node;
    });
    return found;
  }

  function activeSourceBlockEditing(state: EditorState): ActiveSourceBlockEditing | null {
    const node = state.selection.$head.parent;
    if (node.type.name !== "source_block") return null;
    const from = Number(node.attrs[SOURCE_FROM_ATTR]);
    const to = Number(node.attrs[SOURCE_TO_ATTR]);
    const kind = String(node.attrs.kind ?? "");
    if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
    const presentation = blockPresentations.find((candidate) => (
      candidate.id === kind && candidate.sourceBlockEditing
    ));
    if (!presentation) return null;
    return {
      from,
      to,
      presentation,
    };
  }

  function sourceBlockEditingRemainsActive(
    editing: ActiveSourceBlockEditing,
    transaction: SourceTransaction,
    nextState: EditorState,
    nextSource: string,
  ): { from: number; to: number; source: string } | null {
    if (transaction.edits.some((edit) => edit.from < editing.from || edit.to > editing.to)) {
      return null;
    }
    const delta = transaction.edits.reduce(
      (total, edit) => total + edit.insert.length - (edit.to - edit.from),
      0,
    );
    const to = editing.to + delta;
    if (
      transaction.selection.anchor < editing.from
      || transaction.selection.anchor > to
      || transaction.selection.head < editing.from
      || transaction.selection.head > to
    ) return null;
    const node = nextState.selection.$head.parent;
    if (
      node.type.name !== "source_block"
      || String(node.attrs.kind ?? "") !== editing.presentation.id
    ) return null;
    const source = nextSource.slice(editing.from, to);
    if (
      source !== node.textContent
      || editing.presentation.sourceBlockEditing?.matches(source) !== true
    ) return null;
    return { from: editing.from, to, source };
  }

  function refreshActiveSourceBlockSnapshot(
    state: EditorState,
    range: { from: number; to: number; source: string },
  ): EditorState {
    const node = state.selection.$head.parent;
    if (node.type.name !== "source_block") return state;
    const pos = state.selection.$head.before();
    const base = node.type.createChecked({
      ...node.attrs,
      [SOURCE_FROM_ATTR]: range.from,
      [SOURCE_TO_ATTR]: range.to,
      [SOURCE_TEXT_ATTR]: range.source,
    }, node.content);
    const tr = state.tr.setNodeMarkup(pos, undefined, {
      ...base.attrs,
      [SOURCE_FINGERPRINT_ATTR]: sourceFingerprint(base),
    });
    tr.setMeta("addToHistory", false);
    tr.setMeta(SOURCE_BLOCK_PRESENTATION_META, true);
    return state.apply(tr);
  }

  function sourceBlockForRange(range: LiveSourceRange, layoutHeight: number | null): PMNode | null {
    const sourceBlockType = schema.nodes.source_block;
    if (!sourceBlockType) return null;
    const base = sourceBlockType.createChecked({
      kind: range.presentationKind,
      [SOURCE_LAYOUT_HEIGHT_ATTR]: layoutHeight,
      [SOURCE_FROM_ATTR]: range.from,
      [SOURCE_TO_ATTR]: range.to,
      [SOURCE_TEXT_ATTR]: range.source,
    }, range.source ? schema.text(range.source) : undefined);
    return sourceBlockType.createChecked({
      ...base.attrs,
      [SOURCE_FINGERPRINT_ATTR]: sourceFingerprint(base),
    }, base.content);
  }

  function shouldEnterSourceEditing(range: LiveSourceRange, editTable: boolean): boolean {
    if (range.sourceBlockEditing) return range.kind !== "source_block";
    if (["paragraph", "source_gap", "source_block"].includes(range.kind)) return false;
    if (range.kind === "table" && !editTable) return false;
    return true;
  }

  function sourceRangesForSelectionInDocument(
    doc: PMNode,
    selection: { anchor: number; head: number },
    direction?: -1 | 1,
  ): LiveSourceRange[] {
    if (selection.anchor === selection.head) {
      const range = sourceRangeAtOffsetInDocument(doc, selection.head, direction);
      return range ? [range] : [];
    }
    const from = Math.min(selection.anchor, selection.head);
    const to = Math.max(selection.anchor, selection.head);
    const ranges: LiveSourceRange[] = [];
    doc.forEach((node, pos) => {
      const sourceFrom = Number(node.attrs[SOURCE_FROM_ATTR]);
      const sourceTo = Number(node.attrs[SOURCE_TO_ATTR]);
      const source = node.attrs[SOURCE_TEXT_ATTR];
      if (
        !Number.isInteger(sourceFrom)
        || !Number.isInteger(sourceTo)
        || typeof source !== "string"
        || sourceFrom >= to
        || sourceTo <= from
      ) return;
      const sourceBlockEditingPresentation = node.type.name === "source_block"
        ? null
        : resolveSourceBlockEditingPresentation(node, blockPresentations);
      ranges.push({
        pos,
        from: sourceFrom,
        to: sourceTo,
        source,
        kind: node.type.name,
        presentationKind: sourceBlockEditingPresentation
          ? sourceBlockEditingPresentation.id
          : node.type.name === "heading"
            ? `heading-${String(node.attrs.level ?? 1)}`
            : node.type.name === "source_block"
              ? String(node.attrs.kind ?? "block")
              : node.type.name,
        sourceBlockEditing: node.type.name === "source_block"
          || sourceBlockEditingPresentation !== null,
      });
    });
    return ranges;
  }

  function sourceSelectionAffinities(
    selection: { anchor: number; head: number },
    direction?: -1 | 1,
  ): { anchor: "left" | "right"; head: "left" | "right" } {
    if (selection.anchor === selection.head) {
      const affinity = direction === -1 ? "left" : "right";
      return { anchor: affinity, head: affinity };
    }
    return selection.anchor < selection.head
      ? { anchor: "left", head: "right" }
      : { anchor: "right", head: "left" };
  }

  function synchronizeLivePresentation(
    state: EditorState,
    sourceSelection: { anchor: number; head: number },
    intent: LiveNavigationIntent = {},
  ): Transaction | null {
    const direction = intent.direction;
    const selectedBefore = sourceRangesForSelectionInDocument(state.doc, sourceSelection, direction);
    const selectedKeys = new Set(selectedBefore.map((range) => blockHeightKey(range)));
    const rangeSelection = sourceSelection.anchor !== sourceSelection.head;
    const targetHeights = new Map<string, number | null>();
    for (const range of selectedBefore) {
      if (
        range.kind !== "source_block"
        && shouldEnterSourceEditing(range, intent.editTable === true || rangeSelection)
        && !["blockquote", "code_block"].includes(range.kind)
      ) targetHeights.set(blockHeightKey(range), renderedHeightForRange(range));
    }
    const tr = state.tr;
    let presentationChanged = false;

    const activeSourceBlocks: Array<{ pos: number; node: PMNode }> = [];
    tr.doc.forEach((node, pos) => {
      if (node.type.name === "source_block") activeSourceBlocks.push({ pos, node });
    });
    for (const active of activeSourceBlocks.reverse()) {
      const from = Number(active.node.attrs[SOURCE_FROM_ATTR]);
      const to = Number(active.node.attrs[SOURCE_TO_ATTR]);
      if (
        Number.isInteger(from)
        && Number.isInteger(to)
        && selectedKeys.has(blockHeightKey({
          from,
          to,
          source: String(active.node.attrs[SOURCE_TEXT_ATTR] ?? active.node.textContent),
        }))
      ) continue;
      const canonical = canonicalNodeForRange(from, to);
      if (!canonical) continue;
      tr.replaceWith(active.pos, active.pos + active.node.nodeSize, canonical);
      presentationChanged = true;
    }

    const editingBlocks: Array<{ pos: number; node: PMNode }> = [];
    tr.doc.forEach((node, pos) => {
      if (
        ["blockquote", "code_block"].includes(node.type.name)
        && isLiveSyntaxEditing(node.attrs.liveSyntaxState)
      ) editingBlocks.push({ pos, node });
    });
    for (const active of editingBlocks.reverse()) {
      const from = Number(active.node.attrs[SOURCE_FROM_ATTR]);
      const to = Number(active.node.attrs[SOURCE_TO_ATTR]);
      if (
        Number.isInteger(from)
        && Number.isInteger(to)
        && selectedKeys.has(blockHeightKey({
          from,
          to,
          source: String(active.node.attrs[SOURCE_TEXT_ATTR] ?? active.node.textContent),
        }))
      ) continue;
      tr.setNodeMarkup(active.pos, undefined, {
        ...active.node.attrs,
        liveSyntaxState: LIVE_SYNTAX_RENDERING,
      });
      presentationChanged = true;
    }

    const targets = sourceRangesForSelectionInDocument(tr.doc, sourceSelection, direction);
    for (const target of [...targets].reverse()) {
      if (!shouldEnterSourceEditing(target, intent.editTable === true || rangeSelection)) continue;
      const targetNode = tr.doc.nodeAt(target.pos);
      if (targetNode && ["blockquote", "code_block"].includes(target.kind)) {
        if (!isLiveSyntaxEditing(targetNode.attrs.liveSyntaxState)) {
          tr.setNodeMarkup(target.pos, undefined, {
            ...targetNode.attrs,
            liveSyntaxState: LIVE_SYNTAX_EDITING,
          });
          presentationChanged = true;
        }
      } else if (targetNode && target.kind !== "source_block") {
        const sourceBlock = sourceBlockForRange(
          target,
          targetHeights.get(blockHeightKey(target)) ?? null,
        );
        if (sourceBlock) {
          tr.replaceWith(target.pos, target.pos + targetNode.nodeSize, sourceBlock);
          presentationChanged = true;
        }
      }
    }

    const explicitSelection = intent.anchor !== undefined || intent.head !== undefined;
    if (!presentationChanged && !explicitSelection && intent.scroll !== true) return null;
    if (presentationChanged || explicitSelection) {
      const positions = SourcePositionMap.fromDocument(tr.doc, canonicalMarkdown);
      const anchor = Math.max(0, Math.min(intent.anchor ?? sourceSelection.anchor, canonicalMarkdown.length));
      const head = Math.max(0, Math.min(intent.head ?? sourceSelection.head, canonicalMarkdown.length));
      let affinities = sourceSelectionAffinities({ anchor, head }, direction);
      if (anchor === head) {
        const selectedRange = sourceRangeAtOffsetInDocument(tr.doc, head, direction);
        const affinity = direction === -1 || selectedRange?.to === head
          ? "left"
          : "right";
        affinities = { anchor: affinity, head: affinity };
      }
      const anchorPosition = positions.sourceToDocument(anchor, affinities.anchor);
      const headPosition = positions.sourceToDocument(head, affinities.head);
      try {
        tr.setSelection(TextSelection.create(tr.doc, anchorPosition, headPosition));
      } catch {
        tr.setSelection(TextSelection.near(tr.doc.resolve(headPosition), direction ?? 1));
      }
    }
    tr.setMeta("addToHistory", false);
    tr.setMeta(SOURCE_BLOCK_PRESENTATION_META, true);
    tr.setMeta(LIVE_PRESENTATION_SYNC_META, true);
    if (intent.scroll !== false) tr.scrollIntoView();
    return tr;
  }

  function enterSourceEditingAtBoundary(
    offset: number,
    options: { editTable?: boolean; scroll?: boolean } = {},
  ): boolean {
    const clamped = Math.max(0, Math.min(offset, canonicalMarkdown.length));
    const positions = sourcePositionMapForState(view.state);
    const position = positions.sourceToDocument(clamped, "right");
    const tr = markLiveNavigation(
      view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position))),
      {
        anchor: clamped,
        head: clamped,
        editTable: options.editTable,
        scroll: options.scroll ?? true,
      },
    );
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
      const sourceFrom = Number(node.attrs[SOURCE_FROM_ATTR]);
      const targetSource = Number.isInteger(sourceFrom) ? sourceFrom + targetOffset : undefined;
      view.dispatch(
        markLiveNavigation(state.tr
          .setSelection(TextSelection.create(state.doc, blockPos + 1 + targetOffset))
          .setMeta(SOURCE_BLOCK_PRESENTATION_META, true), {
          ...(targetSource !== undefined ? { anchor: targetSource, head: targetSource } : {}),
          direction,
          scroll: true,
        }),
      );
      return true;
    }

    const sourceFrom = Number(node.attrs[SOURCE_FROM_ATTR]);
    if (!Number.isInteger(sourceFrom)) return false;
    const targetSource = direction < 0
      ? sourceFrom - 1
      : sourceFrom + node.textContent.length + 1;
    if (targetSource < 0 || targetSource > canonicalMarkdown.length) return false;
    const targetPosition = sourcePositionMapForState(state).sourceToDocument(
      targetSource,
      direction < 0 ? "left" : "right",
    );
    const outside = TextSelection.near(state.doc.resolve(targetPosition), direction);
    view.dispatch(
      markLiveNavigation(state.tr
        .setSelection(outside)
        .setMeta(SOURCE_BLOCK_PRESENTATION_META, true), {
        anchor: targetSource,
        head: targetSource,
        direction,
        scroll: true,
      }),
    );
    return true;
  }

  function reparsePresentation(
    state: EditorState,
    sourceSelection: number,
    restoreSourceEditing = false,
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
    // A reparse caused by an authored edit must keep the caret on that exact
    // source range, including tables. Tables stay on their rich-cell path for
    // ordinary navigation, but an edit that just created or changed one must
    // not strand the DOM caret in the rebuilt projection.
    if (restoreSourceEditing) enterSourceEditingAtBoundary(sourceSelection, { editTable: true });
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
    if (state.selection.empty) {
      const head = positions.documentToSource(state.selection.head, "right");
      return { anchor: head, head };
    }
    const forward = state.selection.anchor < state.selection.head;
    return {
      anchor: positions.documentToSource(state.selection.anchor, forward ? "left" : "right"),
      head: positions.documentToSource(state.selection.head, forward ? "right" : "left"),
    };
  }

  function beginComposition(): void {
    if (compositionFinalizeTimer !== null) {
      clearTimeout(compositionFinalizeTimer);
      compositionFinalizeTimer = null;
    }
    if (pendingComposition) finalizeComposition();
    pendingComposition = {
      source: new SourceComposition(canonicalMarkdown, sourceSelectionForState(view.state)),
      baseStructureSignature: canonicalStructureSignature,
      reparseRequested: false,
    };
  }

  function finalizeComposition(): void {
    if (compositionFinalizeTimer !== null) {
      clearTimeout(compositionFinalizeTimer);
      compositionFinalizeTimer = null;
    }
    const composition = pendingComposition;
    if (!composition) return;
    const analysis = analyzeDerivedStructure(composition.source.source);
    const reparseDerivedDocument = composition.reparseRequested
      || composition.baseStructureSignature !== analysis.signature;
    const transaction = composition.source.transaction(reparseDerivedDocument);
    pendingDerivedStructure = { source: composition.source.source, ...analysis };
    pendingComposition = null;
    const changed = applyCanonicalTransaction(transaction, composition.source.baseSelection);
    if (changed && reparseDerivedDocument) {
      reparsePresentation(view.state, transaction.selection.head, true);
    }
    if (presentationRefreshPending && !inSource) {
      presentationRefreshPending = false;
      view.dispatch(view.state.tr.setMeta(INLINE_PRESENTATION_META, true));
    }
    scheduleBlockHeightCache();
  }

  function scheduleCompositionFinalization(): void {
    if (compositionFinalizeTimer !== null) clearTimeout(compositionFinalizeTimer);
    // ProseMirror flushes a final pending DOM mutation in a microtask after
    // compositionend. A timer lets that exact, composition-tagged transaction
    // enter the buffer before the canonical source is committed.
    compositionFinalizeTimer = setTimeout(() => {
      compositionFinalizeTimer = null;
      finalizeComposition();
    }, 0);
  }

  function dispatchTransactionInsideActiveSourceBlock(
    transaction: SourceTransaction,
  ): boolean {
    const editing = activeSourceBlockEditing(view.state);
    if (!editing) return false;
    const applied = new CanonicalSource(canonicalMarkdown).apply(transaction);
    const nextSource = applied.source.value;
    if (nextSource === canonicalMarkdown) return false;
    const delta = transaction.edits.reduce(
      (total, edit) => total + edit.insert.length - (edit.to - edit.from),
      0,
    );
    const nextTo = editing.to + delta;
    if (
      transaction.edits.some((edit) => edit.from < editing.from || edit.to > editing.to)
      || transaction.selection.anchor < editing.from
      || transaction.selection.anchor > nextTo
      || transaction.selection.head < editing.from
      || transaction.selection.head > nextTo
    ) return false;

    const blockPosition = view.state.selection.$head.before();
    let tr = view.state.tr;
    for (const edit of [...transaction.edits].sort((left, right) => right.from - left.from)) {
      const from = blockPosition + 1 + edit.from - editing.from;
      const to = blockPosition + 1 + edit.to - editing.from;
      tr = tr.insertText(edit.insert, from, to);
    }
    tr = tr.setSelection(TextSelection.create(
      tr.doc,
      blockPosition + 1 + transaction.selection.anchor - editing.from,
      blockPosition + 1 + transaction.selection.head - editing.from,
    ));
    tr.setMeta(SOURCE_TRANSACTION_META, transaction);
    view.dispatch(tr);
    return true;
  }

  function applyAndRenderCanonicalTransaction(transaction: SourceTransaction): boolean {
    if (dispatchTransactionInsideActiveSourceBlock(transaction)) return true;
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

  function applyLiveTextInput(
    fromPosition: number,
    toPosition: number,
    text: string,
  ): boolean {
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
        if (pointerSelectionActive && tr.selectionSet && !tr.docChanged) {
          tr.setMeta(LIVE_POINTER_SELECTION_META, true);
        }
        const compositionId = tr.getMeta("composition") as number | undefined;
        if (compositionId !== undefined && !pendingComposition) beginComposition();
        const beforeCanonical = pendingComposition?.source.source ?? canonicalMarkdown;
        const beforeSelection = sourceSelectionForState(v.state);
        const activeSourceEditing = tr.docChanged
          ? activeSourceBlockEditing(v.state)
          : null;
        const editedParent = v.state.selection.$head.parent;
        const editedSourcePresentation = tr.docChanged
          && (
            editedParent.type.name === "source_block"
            || (
              ["blockquote", "code_block"].includes(editedParent.type.name)
              && isLiveSyntaxEditing(editedParent.attrs.liveSyntaxState)
            )
          );
        let next = v.state.apply(tr);
        let reparseRequest: { selection: number; restoreEditing: boolean } | null = null;
        if (tr.docChanged && !tr.getMeta(SOURCE_BLOCK_PRESENTATION_META)) {
          const effect = transactionSourceEffect(tr, beforeCanonical);
          if (effect.kind === "source") {
            if (pendingComposition) {
              pendingComposition.source.apply(effect.transaction);
              pendingComposition.reparseRequested ||= effect.reparseDerivedDocument === true;
            } else {
              const nextCanonical = new CanonicalSource(beforeCanonical)
                .apply(effect.transaction).source.value;
              const retainedSourceEditing = activeSourceEditing
                ? sourceBlockEditingRemainsActive(
                    activeSourceEditing,
                    effect.transaction,
                    next,
                    nextCanonical,
                  )
                : null;
              const reparseDerivedDocument = effect.reparseDerivedDocument === true
                || prepareDerivedStructureForTransaction(effect.transaction);
              const changed = applyCanonicalTransaction(effect.transaction, beforeSelection);
              if (changed && retainedSourceEditing) {
                next = refreshActiveSourceBlockSnapshot(next, retainedSourceEditing);
              } else if (changed && reparseDerivedDocument) {
                reparseRequest = {
                  selection: effect.transaction.selection.head,
                  restoreEditing: editedSourcePresentation
                    || !["command", "external"].includes(effect.transaction.origin),
                };
              }
            }
          } else if (effect.kind === "unsupported") {
            // Undo/redo may replay a group of presentation and source steps
            // without their original transaction metadata. Recover only when
            // every resulting top-level node still proves an unchanged exact
            // authored snapshot; otherwise fail closed.
            if (pendingComposition) {
              throw new Error("IME composition changed the document without an exact canonical source transaction");
            }
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
        const intent = tr.getMeta(LIVE_NAVIGATION_META) as LiveNavigationIntent | undefined;
        if (pendingComposition && tr.selectionSet) {
          pendingComposition.source.setSelection(sourceSelectionForState(next));
        }
        const shouldSynchronizeSelection = !pendingComposition
          && !pointerSelectionActive
          && compositionId === undefined
          && !tr.docChanged
          && (tr.selectionSet || intent !== undefined)
          && (!tr.getMeta(SOURCE_BLOCK_PRESENTATION_META) || intent !== undefined);
        if (shouldSynchronizeSelection) {
          const mapped = sourceSelectionForState(next);
          const sourceSelection = {
            anchor: intent?.anchor ?? mapped.anchor,
            head: intent?.head ?? mapped.head,
          };
          const synchronization = synchronizeLivePresentation(next, sourceSelection, intent);
          if (synchronization) next = next.apply(synchronization);
        }
        v.updateState(next);
        scheduleBlockHeightCache();
        if (reparseRequest) {
          reparsePresentation(next, reparseRequest.selection, reparseRequest.restoreEditing);
          scheduleBlockHeightCache();
        }
      },
      handleKeyDown(_view, event) {
        if (event.isComposing || event.keyCode === 229) return false;
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
          const sourceSelection = sourceSelectionForState(view.state);
          const transaction = liveSourceKeyTransaction(
            canonicalMarkdown,
            sourceSelection,
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
        for (let depth = current.$head.depth; depth > 0; depth -= 1) {
          if (current.$head.node(depth).type.name === "table") return false;
        }
        const positions = sourcePositionMapForState(view.state);
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const selection = sourceSelectionForState(view.state);
        const head = selection.head;
        const target = Math.max(0, Math.min(head + direction, canonicalMarkdown.length));
        if (target === head) return false;
        const anchor = event.shiftKey ? selection.anchor : target;
        const anchorPosition = positions.sourceToDocument(anchor, "left");
        const headPosition = positions.sourceToDocument(target, direction < 0 ? "left" : "right");
        let navigation = view.state.tr;
        try {
          navigation = navigation.setSelection(TextSelection.create(
            navigation.doc,
            anchorPosition,
            headPosition,
          ));
        } catch {
          if (event.shiftKey) return false;
          navigation = navigation.setSelection(TextSelection.near(
            navigation.doc.resolve(headPosition),
            direction,
          ));
        }
        view.dispatch(markLiveNavigation(navigation, {
          anchor,
          head: target,
          direction,
          scroll: true,
        }));
        event.preventDefault();
        return true;
      },
      handleDOMEvents: {
        focus: () => { options.onFocus?.(); return false; },
        blur: () => { options.onBlur?.(); return false; },
        compositionstart: () => {
          beginComposition();
          return false;
        },
        compositionend: () => {
          scheduleCompositionFinalization();
          return false;
        },
        beforeinput: (_view, event) => {
          if (
            event.inputType !== "insertText"
            || event.data == null
            || event.data.length === 0
            || event.isComposing
            || pendingComposition
            || view.composing
          ) return false;
          const { from, to } = view.state.selection;
          applyLiveTextInput(from, to, event.data);
          event.preventDefault();
          return true;
        },
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
        // Keep ProseMirror's native transaction during composition. Its
        // composition metadata and browser-derived selection are required to
        // preserve the active IME text node across candidate updates.
        if (pendingComposition || _view.composing) return false;
        return applyLiveTextInput(fromPosition, toPosition, text);
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
    const ownerDocument = v.dom.ownerDocument;
    const onPointerDownCapture = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      pointerSelectionActive = true;
      if (pointerSelectionCommitTimer !== null) {
        clearTimeout(pointerSelectionCommitTimer);
        pointerSelectionCommitTimer = null;
      }
    };
    const onPointerUpCapture = (event: MouseEvent): void => {
      if (event.button !== 0 || !pointerSelectionActive) return;
      pointerSelectionActive = false;
      if (pointerSelectionCommitTimer !== null) clearTimeout(pointerSelectionCommitTimer);
      pointerSelectionCommitTimer = setTimeout(() => {
        pointerSelectionCommitTimer = null;
        if (inSource || !v.dom.isConnected) return;
        const selection = sourceSelectionForState(v.state);
        v.dispatch(markLiveNavigation(v.state.tr, {
          anchor: selection.anchor,
          head: selection.head,
          scroll: false,
        }));
      }, 0);
    };
    v.dom.addEventListener("mousedown", onPointerDownCapture, true);
    ownerDocument.addEventListener("mouseup", onPointerUpCapture, true);
    detachPointerSelectionListeners = () => {
      v.dom.removeEventListener("mousedown", onPointerDownCapture, true);
      ownerDocument.removeEventListener("mouseup", onPointerUpCapture, true);
    };
    return v;
  }

  function rebuild(md: string): void {
    detachPointerSelectionListeners?.();
    detachPointerSelectionListeners = null;
    pointerSelectionActive = false;
    view.destroy();
    editorHost.innerHTML = "";
    blockHeightCache.clear();
    view = buildView(md);
    scheduleBlockHeightCache();
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
    if (pendingComposition) finalizeComposition();
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
    if (pendingComposition) finalizeComposition();
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
    if (pendingComposition) finalizeComposition();
    const clamped = Math.max(0, Math.min(offset, canonicalMarkdown.length));
    if (inSource) {
      sourceTextarea.setSelectionRange(clamped, clamped);
      return;
    }
    enterSourceEditingAtBoundary(clamped, { editTable: true, scroll: true });
  }

  function runExtensionCommand<Result>(command: string, input?: unknown): Result | undefined {
    if (pendingComposition) finalizeComposition();
    if (inSource) return undefined;
    for (const extension of options.extensions ?? []) {
      const handler = extension.commands?.[command];
      if (handler) return handler(view, input) as Result;
    }
    return undefined;
  }

  function enterSource(): void {
    if (pendingComposition) finalizeComposition();
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
  if (typeof ResizeObserver !== "undefined") {
    blockResizeObserver = new ResizeObserver(() => scheduleBlockHeightCache());
    blockResizeObserver.observe(editorHost);
  }
  scheduleBlockHeightCache();

  return {
    getMarkdown(): string {
      return inSource ? sourceTextarea.value : canonicalMarkdown;
    },
    setMarkdown(md: string): void {
      if (pendingComposition) finalizeComposition();
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
      if (pendingComposition) {
        presentationRefreshPending = true;
      } else if (!inSource) {
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
      if (pendingComposition) finalizeComposition();
      if (compositionFinalizeTimer !== null) clearTimeout(compositionFinalizeTimer);
      if (pointerSelectionCommitTimer !== null) clearTimeout(pointerSelectionCommitTimer);
      pointerSelectionActive = false;
      window.removeEventListener("keydown", onKey);
      blockResizeObserver?.disconnect();
      if (blockHeightFrame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(blockHeightFrame);
      }
      detachPointerSelectionListeners?.();
      view.destroy();
      wrap.remove();
    },
  };
}
