// Public API for the Mint Notes editor core.
//
// Consumers see only `createEditor` and the small `Editor` controller
// it returns. ProseMirror is an implementation detail and is intentionally
// absent from this surface.

export { createEditor } from "./editor-api";
export type { Editor, EditorOptions } from "./editor-api";
export type {
  EditorExtension,
  EditorExtensionCommand,
  EditorExtensionContext,
} from "./extension";
