import type { Schema } from "prosemirror-model";
import type { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

export const SOURCE_BLOCK_PRESENTATION_META = "source-block-presentation";

export interface EditorExtensionContext {
  schema: Schema;
}

export interface SourceBlockPresentation {
  readonly nodeType: string;
  matches(source: string): boolean;
  render(container: HTMLElement, source: string): void | (() => void);
}

export type EditorExtensionCommand = (view: EditorView, input: unknown) => unknown;

export interface EditorExtension {
  readonly id: string;
  createPlugins(context: EditorExtensionContext): readonly Plugin[];
  readonly commands?: Readonly<Record<string, EditorExtensionCommand>>;
  readonly sourceBlockPresentations?: readonly SourceBlockPresentation[];
}
