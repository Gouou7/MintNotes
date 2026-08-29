import type { Schema } from "prosemirror-model";
import type { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

export const SOURCE_BLOCK_PRESENTATION_META = "source-block-presentation";

export interface EditorExtensionContext {
  schema: Schema;
}

export type PresentationCleanup = void | (() => void);

export interface InlinePresentationMatch<Data = unknown> {
  /** Text-node-local source offsets. Both ends are canonical source boundaries. */
  readonly from: number;
  readonly to: number;
  /** Complete authored syntax covered by from/to. */
  readonly source: string;
  /** Source passed to the renderer, such as a math body or WikiLink label. */
  readonly renderSource: string;
  /** Stable semantic identity used to preserve widget lifecycle. */
  readonly key: string;
  readonly data: Data;
}

export interface InlinePresentationSearchContext {
  readonly parentNodeType: string | null;
}

/**
 * A presentation-only inline recognizer. It may describe decorations and DOM,
 * but it cannot receive an EditorView or mutate Markdown.
 */
export interface InlineSourcePresentation<Data = unknown> {
  readonly id: string;
  readonly sourceClassName: string;
  /** Optional class applied to the complete authored range while selected. */
  readonly editingClassName?: string;
  readonly widgetClassName: string;
  readonly priority?: number;
  find(
    source: string,
    context: InlinePresentationSearchContext,
  ): readonly InlinePresentationMatch<Data>[];
  render(
    container: HTMLElement,
    match: InlinePresentationMatch<Data>,
  ): PresentationCleanup;
}

export interface BlockPresentationMatch<Data = unknown> {
  /** Complete authored source owned by the derived block node. */
  readonly source: string;
  /** Source passed to the renderer, usually the block body. */
  readonly renderSource: string;
  readonly key: string;
  readonly data: Data;
}

export interface BlockPresentationSearchContext {
  readonly nodeType: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface BlockSourceEditing {
  /** Complete and in-progress authored forms that require exact block editing. */
  matches(source: string): boolean;
}

/**
 * A presentation-only block matcher. The core owns selection-driven editing state and
 * ProseMirror decorations; extensions only recognize source and mount output.
 */
export interface BlockSourcePresentation<Data = unknown> {
  readonly id: string;
  readonly nodeTypes: readonly string[];
  readonly sourceClassName: string;
  readonly widgetClassName: string;
  readonly priority?: number;
  /** Exact, text-backed editing for authored forms that cannot use the derived node. */
  readonly sourceBlockEditing?: BlockSourceEditing;
  match(
    source: string,
    context: BlockPresentationSearchContext,
  ): BlockPresentationMatch<Data> | null;
  render(
    container: HTMLElement,
    match: BlockPresentationMatch<Data>,
  ): PresentationCleanup;
}

export interface ExtensionPresentations {
  readonly inline?: readonly InlineSourcePresentation[];
  readonly block?: readonly BlockSourcePresentation[];
}

export interface SourceBlockPresentation {
  readonly nodeType: string;
  matches(source: string): boolean;
  render(container: HTMLElement, source: string): void | (() => void);
}

export type EditorExtensionCommand = (view: EditorView, input: unknown) => unknown;

export interface EditorExtension {
  readonly id: string;
  /** Declarative, core-hosted presentation behavior for new extensions. */
  readonly presentations?: ExtensionPresentations;
  /**
   * Transitional low-level hook for core-coupled extensions such as Callout.
   * New presentation extensions must use `presentations` instead.
   */
  createPlugins?(context: EditorExtensionContext): readonly Plugin[];
  /** Transitional command hook; source-changing commands will move to SourceTransaction. */
  readonly commands?: Readonly<Record<string, EditorExtensionCommand>>;
  /** Transitional source-block hook used by the source-backed blockquote view. */
  readonly sourceBlockPresentations?: readonly SourceBlockPresentation[];
}
