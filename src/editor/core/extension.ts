import type { Schema } from "prosemirror-model";
import type { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

export interface EditorExtensionContext {
  schema: Schema;
}

export type EditorExtensionCommand = (view: EditorView, input: unknown) => unknown;

export interface EditorExtension {
  readonly id: string;
  createPlugins(context: EditorExtensionContext): readonly Plugin[];
  readonly commands?: Readonly<Record<string, EditorExtensionCommand>>;
}
