// Public API for the Mint Notes editor core.
//
// Consumers see only `createEditor` and the small `Editor` controller
// it returns. ProseMirror is an implementation detail and is intentionally
// absent from this surface.

export { createEditor } from "./editor-api";
export type { Editor, EditorOptions } from "./editor-api";
export type {
  BlockPresentationMatch,
  BlockPresentationSearchContext,
  BlockSourceEditing,
  BlockSourcePresentation,
  EditorExtension,
  EditorExtensionCommand,
  EditorExtensionContext,
  ExtensionPresentations,
  InlinePresentationMatch,
  InlinePresentationSearchContext,
  InlineSourcePresentation,
  PresentationCleanup,
  SourceBlockPresentation,
} from "./extension";
export { SOURCE_BLOCK_PRESENTATION_META } from "./extension";
export { CanonicalSource, replaceSourceRange } from "./source";
export type {
  AppliedSourceTransaction,
  SourceEdit,
  SourceOffset,
  SourceRange,
  SourceSelection,
  SourceTransaction,
} from "./source";
export { SourcePositionMap } from "./source-position-map";
export type { PositionAffinity } from "./source-position-map";
export { SOURCE_TRANSACTION_META, transactionSourceEffect } from "./source-transaction";
export type { TransactionSourceEffect } from "./source-transaction";
