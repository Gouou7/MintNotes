# Editor architecture

[Documentation index](README.md)

This document is the canonical engineering reference for Mint Notes editor behavior. User-facing syntax and interactions belong in the [user guide](USER_GUIDE.md); repository ownership and commands belong in the [development guide](DEVELOPMENT.md).

## Non-negotiable invariant

> Live mode must treat the canonical Markdown source as its editable document model. Rendering may hide or style authored syntax through decorations or node views, but entering or leaving a rendered structure must not swap in rendered-only content or change source-backed document positions. Cursor movement, selection, Backspace, and Delete operate the authored source; structure-changing edits reparse canonical Markdown immediately and must not synthesize, delete, or relocate a user's delimiters.

This is a release-blocking architecture invariant, not a presentation preference. Source, Live, and Reading modes are views of the same canonical Markdown. A mode switch, selection change, parser normalization, or renderer lifecycle event must never silently rewrite it.

## Source and whitespace fidelity

Canonical Markdown is authoritative at the string level, not merely at the level of an equivalent parse tree. Every authored character is significant document data, including leading blank lines, blank lines between blocks, trailing blank lines, line-ending style, and spaces or tabs on otherwise blank lines. In this document, “blank line” includes an empty line and a line containing only spaces or tabs.

Loading, saving, focusing, blurring, changing a selection, switching modes, validating, parsing, reparsing, rendering, and recovering from a render failure are read-only operations. None of them may trim the document, collapse or expand newlines, normalize line endings, remove whitespace-only lines, or invoke a serializer as a source replacement. They must not emit `onChange` when the canonical string is unchanged.

Only the following user-authorized operations may change canonical Markdown:

- typing and input-method composition;
- pasting or dropping content;
- deleting a selection or using source-position Backspace/Delete;
- an explicit user command with a documented source transformation, one undoable transaction, and a selection/cursor mapping defined against the resulting source.

Parsing may recognize structure, but the parse tree, rendered DOM, node-view state, and serializer output are derived representations. They must never replace canonical Markdown merely because they are structurally equivalent. Valid syntax is rendered over its original source range. Invalid or incomplete syntax falls back to literal source display in the smallest affected range; the editor must not complete, delete, relocate, or otherwise repair authored characters.

Newline presentation follows these rules without rewriting the source:

| Canonical source | Markdown meaning | Live presentation | Reading presentation |
| --- | --- | --- | --- |
| `a\nb` | One paragraph with one authored soft line break. | Display the authored line break. | Display the authored line break. |
| `a\n\nb` | Two paragraphs. | Display two paragraphs. | Display two paragraphs. |
| `a\n\n\nb` | Two paragraphs with one additional authored blank line. | Display every authored blank line. | May collapse additional visual height to standard paragraph spacing. |

The first case remains a soft Markdown line break: it must not be rewritten as two trailing spaces, `<br>`, or an empty paragraph. In all three cases, Source, Live, Reading, save, and reopen preserve the exact canonical string. LF and CRLF inputs remain distinguishable until an explicit, user-authorized line-ending conversion is implemented.

The current implementation is measured against this gate in the [editor source-fidelity audit](EDITOR_SOURCE_FIDELITY_AUDIT.md). That audit records current gaps; it does not weaken this normative contract or advertise unimplemented behavior.

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
- Backspace and Delete traverse and edit authored syntax in source order. They must not jump across hidden syntax or delete an entire rendered structure as a visual unit. At the absolute left edge of a source-backed block, Backspace moves to the previous editable source position (or does nothing at document start); it never deletes the delimiter to the caret's right. Delete remains the command that may remove that right-hand delimiter.
- A Live blockquote node owns the complete authored quote source, including every `>`, authored space, blank quoted line, nested quote prefix, and fenced region. Its inactive preview and active source editor are two presentations of that same node; activating it changes only transient presentation state.
- The inactive blockquote preview and active source surface share one layout footprint. Switching presentation must preserve authored line breaks and must not cause the surrounding document to reflow merely because editing was activated.
- The active blockquote source uses a preformatted `pre > code` editing surface. If a browser temporarily represents an edited empty line with `div` or `br` children, the node view converts those DOM boundaries back to authored newlines before they can enter the ProseMirror document.
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

- Callouts are detected from the authored lines of a source-backed blockquote. The Callout extension may decorate the block and provide a React preview renderer, but it does not materialize a rendered Callout as editable ProseMirror content and does not canonicalize the marker on exit.
- Callouts round-trip their authored `> [!TYPE]` marker, including incomplete markers and equivalent quote-prefix spacing. No placeholder, word-joiner, highlight, backtick, or other private sentinel may reach canonical Markdown.
- Multiline display math may use the reserved `mint-math` fenced language only inside the mounted Live editor. It must be canonicalized before application `onChange` and must never reach React document state, IndexedDB, history, synchronization, export, or the server.
- Live serialization must not synthesize backslashes for punctuation, block starts, table cells, link titles, or image titles. Canonical backslashes are user-authored and remain preserved even when Live presentation hides them.
- Mermaid SVG, decrypted attachment Blob URLs, and WikiLink lookup results are in-memory presentation artifacts. They are not Markdown and are never persisted as document content.
- Live attachment images resolve their authored `webmd-attachment:` source through the core's presentation callback. Loading completion refreshes inline decorations only; it must not replace the ProseMirror document, reset undo history, or move the canonical-source selection.
- Raw HTML and remote executable embeds remain disabled.

## Required verification

An editor-core or extension change is incomplete without focused regression coverage for every affected boundary:

1. Every no-edit round trip preserves the exact Markdown string, not only an equivalent tree or normalized serialization. Coverage includes leading, inter-block, and trailing blank lines; whitespace-only lines; LF and CRLF; soft line breaks; and presence or absence of a final line ending.
2. Loading, focusing, selection changes, preview activation, Source/Live/Reading switches, saving, and reopening preserve the exact string and do not emit `onChange` without a source edit.
3. Real ProseMirror transactions change only the explicitly edited canonical range. Every untouched character, blank line, line ending, entity, escape, link title, delimiter, and equivalent Markdown spelling remains byte-for-byte unchanged.
4. Cursor, selection, Backspace, Delete, and Enter operate source positions when syntax is visually hidden.
5. Structural delimiter edits reparse immediately without synthesizing, deleting, or relocating later delimiters.
6. Incomplete headings, quotes, Callouts, fences, tables, links, and Front Matter remain literal source in their smallest affected ranges.
7. `a\nb`, `a\n\nb`, and `a\n\n\nb` retain the newline semantics and mode-specific presentation defined above.
8. Live-only representations are absent from `onChange`, encrypted objects, history, synchronization, and exports.

Run `pnpm typecheck` and `pnpm test` for every editor behavior change. Run `pnpm build` for lifecycle or extension integration changes, then identify any desktop, tablet, or mobile interaction that still requires manual verification.
