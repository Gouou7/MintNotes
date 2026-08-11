# Editor architecture

[Documentation index](README.md)

This document is the canonical engineering reference for Mint Notes editor behavior. User-facing syntax and interactions belong in the [user guide](USER_GUIDE.md); repository ownership and commands belong in the [development guide](DEVELOPMENT.md).

## Non-negotiable invariant

> Live mode must treat the canonical Markdown source as its editable document model. Rendering may hide or style authored syntax through decorations or node views, but entering or leaving a rendered structure must not swap in rendered-only content or change source-backed document positions. Cursor movement, selection, Backspace, and Delete operate the authored source; structure-changing edits reparse canonical Markdown immediately and must not synthesize, delete, or relocate a user's delimiters.

This is a release-blocking architecture invariant, not a presentation preference. Source, Live, and Reading modes are views of the same canonical Markdown. A mode switch, selection change, parser normalization, or renderer lifecycle event must never silently rewrite it.

## One-way data flow

```text
canonical Markdown
  -> parser
  -> source-backed ProseMirror document
  -> decorations and node views
  -> rendered Live presentation

source-position transaction
  -> changed canonical range
  -> authored-source patch
  -> canonical Markdown
  -> application state, encryption, IndexedDB, history, sync, export
```

Reading mode parses canonical Markdown without creating an editable copy. Rendered DOM, node-view text, Blob URLs, measurement nodes, and other presentation state never flow back into persistence.

## Source coordinates and structural edits

- Selections and commands map to canonical source offsets. The workspace carries that offset across Source/Live remounts.
- Decorations may hide authored delimiters visually, but the delimiters retain stable editable positions.
- Entering or leaving a rendered structure reveals or hides presentation only; it does not replace a source-backed node with rendered-body-only content.
- Backspace and Delete traverse and edit authored syntax in source order. They must not jump across hidden syntax or delete an entire rendered structure as a visual unit.
- An edit that changes a block boundary reparses canonical Markdown immediately. For fenced blocks, the first valid closing fence defines the block and every later authored fence remains available to the parser.
- Each Live transaction patches only its changed canonical range. Unedited entities, escapes, link titles, delimiters, and other equivalent authored spellings remain byte-for-byte unchanged.

## Ownership boundaries

| Module | Responsibility |
| --- | --- |
| `src/editor/core/` | Canonical parser and serializer, authored-source patching, source-position transactions, stable controller, and generic extension lifecycle. |
| `src/editor/extensions/` | Callout and cursor-aware Math, Mermaid, and WikiLink presentation registered through `EditorExtension`. |
| Other `src/editor/` modules | React adapter, Source mode, image-drop routing, read-only rendering, and outline extraction. |
| Vault components | Store canonical Markdown and call typed editor/controller APIs; they never receive a ProseMirror view or rendered DOM as document data. |

The core must not import Mint Notes extensions. Extensions may use ProseMirror only through `EditorExtension`; React and vault modules use the stable controller or typed extension helpers.

## Presentation-only representations

- Callouts round-trip their authored `> [!TYPE]` marker. No highlight, backtick, or other private sentinel may reach canonical Markdown.
- Multiline display math may use the reserved `mint-math` fenced language only inside the mounted Live editor. It must be canonicalized before application `onChange` and must never reach React document state, IndexedDB, history, synchronization, export, or the server.
- Live serialization must not synthesize backslashes for punctuation, block starts, table cells, link titles, or image titles. Canonical backslashes are user-authored and remain preserved even when Live presentation hides them.
- Mermaid SVG, decrypted attachment Blob URLs, and WikiLink lookup results are in-memory presentation artifacts. They are not Markdown and are never persisted as document content.
- Live attachment images resolve their authored `webmd-attachment:` source through the core's presentation callback. Loading completion refreshes inline decorations only; it must not replace the ProseMirror document, reset undo history, or move the canonical-source selection.
- Raw HTML and remote executable embeds remain disabled.

## Required verification

An editor-core or extension change is incomplete without focused regression coverage for every affected boundary:

1. Parser/serializer round trips preserve canonical Markdown, including incomplete and equivalent syntax.
2. Real ProseMirror transactions preserve untouched authored source rather than adopting normalized renderer serialization.
3. Cursor, selection, Backspace, Delete, and Enter operate source positions when syntax is visually hidden.
4. Structural delimiter edits reparse immediately without synthesizing, deleting, or relocating later delimiters.
5. Source/Live/Reading switches preserve Markdown and the nearest canonical caret offset.
6. Live-only representations are absent from `onChange`, encrypted objects, history, synchronization, and exports.

Run `pnpm typecheck` and `pnpm test` for every editor behavior change. Run `pnpm build` for lifecycle or extension integration changes, then identify any desktop, tablet, or mobile interaction that still requires manual verification.
