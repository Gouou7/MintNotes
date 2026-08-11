# Editor source-fidelity audit

[Documentation index](README.md) · [Normative editor architecture](EDITOR_ARCHITECTURE.md)

This document records the current implementation's compliance with the editor's source-fidelity release gate. It is an engineering audit, not a user-facing feature statement. The normative behavior is defined in the editor architecture guide; where implementation and that guide differ, the implementation is a gap to fix rather than a reason to weaken the contract.

Audit snapshot: 2026-08-11. Evidence refers to the working implementation at this date, including the in-progress source-backed blockquote and fenced-code work already present in the workspace.

## Status definitions

| Status | Meaning |
| --- | --- |
| Compliant | Current code has direct evidence for the target behavior and an exact-string regression protects it. |
| Partial | Some paths preserve the source, but representation, presentation, source mapping, or regression coverage remains incomplete. |
| Violation | A current path is known to discard, regenerate, normalize, or visually misrepresent authored source. |

“Preserved” means exact string equality. Structural equality, equivalent Markdown, or an unchanged rendered result is not sufficient.

## Findings

### Canonical storage and blank lines

| Status | Evidence | Impact | Required behavior | Required regression |
| --- | --- | --- | --- | --- |
| Partial | [`editor-api.ts`](../src/editor/core/editor-api.ts) keeps an external `canonicalMarkdown` string and [`sourcePatch.ts`](../src/editor/core/sourcePatch.ts) attempts to splice a rendered transaction into that string using unchanged anchors. | Untouched source can survive some localized edits even when ProseMirror serializes it differently. The fallback mapping is heuristic, however, and cannot create document positions for source characters absent from the parsed tree. | Keep the canonical string authoritative and apply edits directly to canonical source ranges. A derived document must not be the only location model. | Edit one character in every supported structure and assert that all characters outside the explicit source range are identical. Include repeated text where anchor matching is ambiguous. |
| Violation | [`parser.ts`](../src/editor/core/parser.ts) builds a ProseMirror tree from Markdown tokens; blank lines between tokens, leading blank lines, trailing blank lines, and whitespace-only lines have no independent nodes or source spans. [`serializer.ts`](../src/editor/core/serializer.ts) uses `flushClose()` to impose block separation and removes trailing newlines when finalizing output. A current parse/serialize probe reduces `\n\na` to `a`, `a\n\n\nb` to `a\n\nb`, `a\n\n` to `a`, and `\n\n` to the empty string. | The derived tree cannot distinguish how many blank lines were authored or where whitespace-only lines existed. Any path that adopts serialized output can silently delete source. | Preserve leading, inter-block, and trailing blank lines, including their spaces, tabs, line-ending style, and final-line-ending state. Parsing and serialization remain read-only views. | Exact-string cases for leading, inter-block, trailing, and whitespace-only lines; LF and CRLF; empty and all-whitespace documents; final newline present and absent. |

### Newline meaning and presentation

| Status | Evidence | Impact | Required behavior | Required regression |
| --- | --- | --- | --- | --- |
| Partial | [`parser.ts`](../src/editor/core/parser.ts) stores Markdown `softbreak` as a text `\n`, and the serializer can return it. The normal Live paragraph styling in [`theme-github.css`](../src/editor/core/styles/theme-github.css) and [`theme-typora.css`](../src/editor/core/styles/theme-typora.css) does not give ordinary paragraph text a newline-preserving white-space mode. [`ReadOnlyMarkdown.tsx`](../src/editor/ReadOnlyMarkdown.tsx) renders ordinary React Markdown paragraphs without a soft-break presentation transform. | The source `a\nb` may remain in storage while both Live and Reading DOM visually collapse it to the same spacing as `a b`. Source fidelity and visual fidelity disagree. | Treat `a\nb` as one paragraph with an authored manual line break in Live and Reading, without converting it to two trailing spaces, `<br>`, or an empty paragraph. | Assert the canonical string and rendered line geometry for `a\nb`, `a\n\nb`, and `a\n\n\nb` in Source, Live, and Reading. |
| Violation | Because extra blank lines are absent from the parsed Live tree, Live cannot display every authored blank line in `a\n\n\nb`. Reading is allowed to collapse extra visual height, but its rendering must still be derived from the unchanged string. | Live currently cannot provide a stable line-for-line surface for extra authored blank lines. | Live displays all additional blank lines; Reading may use standard paragraph spacing while leaving canonical Markdown untouched. | Compare source offsets and element geometry for one, two, three, and four consecutive line endings. |

### Source coordinates and no-edit lifecycle

| Status | Evidence | Impact | Required behavior | Required regression |
| --- | --- | --- | --- | --- |
| Violation | [`editor-api.ts`](../src/editor/core/editor-api.ts) labels Source/Live cursor conversion “best-effort.” It serializes or reparses prefixes and then uses `mapEquivalentOffset`; [`sourcePatch.ts`](../src/editor/core/sourcePatch.ts) ultimately falls back to a proportional offset. Blank lines and normalized structures missing from the derived tree therefore have no stable ProseMirror positions. | Mode switches, clicks, and boundary navigation can land several characters away from the authored position, especially around normalized syntax or repeated text. | Maintain an explicit mapping between every canonical source boundary and its Live presentation position. Mode switches preserve the exact offset when possible and a documented nearest boundary otherwise. | Round-trip every source offset through Source → Live → Source for whitespace, equivalent syntax, invalid syntax, and repeated substrings. |
| Partial | The controller retains `canonicalMarkdown` across some mode changes, and selection-only transactions generally avoid application `onChange`. Full coverage for open, focus/blur, preview activation, render failure, save, and reopen is not present at the exact-string level. | A no-edit lifecycle regression could still normalize source without a focused release gate detecting it. | All no-edit operations are read-only and emit no `onChange`. | Spy on `onChange` while loading, focusing, selecting, activating a preview, switching all modes, saving, and reopening; assert zero calls and exact source equality. |

### Structured Markdown syntax

| Status | Structure and evidence | Impact and required behavior | Required regression |
| --- | --- | --- | --- |
| Violation | Headings in [`heading.ts`](../src/editor/core/features/heading.ts) commit a source-looking paragraph to a heading node containing only the body; the serializer later recreates the marker. Horizontal rules in [`hr.ts`](../src/editor/core/features/hr.ts) swap between a paragraph and an atom. | Marker spelling, spacing, and source positions can be lost or regenerated. Keep authored delimiters source-backed and use decorations/node views only for presentation. | ATX marker count and spacing, closing hashes, Setext variants, and every valid horizontal-rule spelling must survive no-edit and unrelated edits exactly. |
| Violation | Lists and tasks in [`list.ts`](../src/editor/core/features/list.ts) and [`task.ts`](../src/editor/core/features/task.ts) are structured nodes whose serialization recreates bullets, ordered markers, indentation, and task prefixes. | Equivalent list spellings and indentation can be canonicalized; marker positions are not stable source positions. | Preserve each bullet character, ordered-list delimiter/start, indentation, checkbox case/spacing, and blank continuation line. |
| Violation | Tables in [`table.ts`](../src/editor/core/features/table.ts) store rows, cells, headers, and alignment as structured nodes and serialize a formatted table. | Pipe spacing, escaped pipes, divider widths, leading/trailing pipes, and alignment spelling can be reformatted. | Preserve the complete authored table source unless an explicit table command changes a documented range. |
| Partial | Application Front Matter parsing in [`frontmatter.ts`](../src/editor/frontmatter.ts) retains the original prefix and body when merely reading it. Core Front Matter in [`front-matter.ts`](../src/editor/core/features/front-matter.ts) stores only YAML body text and recreates delimiters. Property commands serialize the YAML document with `document.toString()`. | Viewing can preserve the original bytes, but editing one property may rewrite unrelated YAML formatting, comments, quoting, or blank lines. Incomplete Front Matter is not protected by one consistent literal-source contract across layers. | Reading and unrelated body edits preserve the full Front Matter string. An explicit property command changes only its contracted source range and remains undoable. |
| Violation | Reference definitions in [`ref-def.ts`](../src/editor/core/features/ref-def.ts) and TOC in [`toc.ts`](../src/editor/core/features/toc.ts) use structured/atom nodes and regenerate source. TOC serialization explicitly writes lowercase `[toc]`, including when input was `[TOC]`. | Case, spacing, optional title delimiters, escapes, and other equivalent spellings can be replaced. | Keep definitions and TOC tokens source-backed; render their recognized meaning over the original range. |

### Source-backed block boundaries

| Status | Evidence | Impact | Required behavior | Required regression |
| --- | --- | --- | --- | --- |
| Partial | [`blockquote.ts`](../src/editor/core/features/blockquote.ts) now stores the complete authored quote text, including Callout markers, and includes direct tests for left-edge Backspace moving to the previous line or doing nothing at document start. When an edit no longer parses as one quote, its `appendTransaction` still serializes and replaces the complete document to reparse it. | The reported left-edge Backspace case has focused protection, but Enter/Delete and edits to quoted blank lines can still cross a hidden boundary or expose global normalization through the whole-document reparse. | Every `>`, following space/tab, quoted blank line, nested prefix, and intervening newline owns a canonical position. Boundary commands edit or traverse exactly that source character; reparse must not adopt normalized serialization. | Insert/delete text on empty quoted lines and around `> [!note]`; cover Enter, Backspace, and Delete at every character boundary with preceding/following paragraphs and nested quotes. Assert that multiline source never becomes `> [!note] > text`. |
| Partial | [`fenced-code.ts`](../src/editor/core/features/fenced-code.ts) stores opening fence, body, and closing fence in one source-backed node and has boundary-navigation tests. A fence-structure change still serializes and replaces the whole document before remapping the selection. | Local fence edits can expose unrelated blank lines or equivalent syntax to serializer normalization, and boundary coverage is not yet an exact-source matrix. | Opening/closing markers, length, indentation, info string, body newlines, and neighboring blank lines remain exact outside the direct edit. | Test Enter/Backspace/Delete before, inside, and after both fences, including incomplete fences, longer nested runs, quotes, and adjacent blocks. |
| Partial | [`hr.ts`](../src/editor/core/features/hr.ts) preserves the matched marker in an attribute and reveals a source paragraph on entry, but the normal state remains an atom with no positions for its individual characters. | Navigation and deletion depend on node replacement rather than a permanently source-backed range. | The inactive and active presentations use the same canonical positions and footprint; entering the rule is presentation-only. | Test every caret boundary around `---`, `***`, and `___` with adjacent blank lines and blocks, asserting no source or layout change on activation alone. |

### Auxiliary conversions and full reparses

| Status | Evidence | Impact | Required behavior | Required regression |
| --- | --- | --- | --- | --- |
| Partial | [`frontmatter.ts`](../src/editor/frontmatter.ts) preserves prefix/body during reads but uses YAML serialization after a property mutation. | An authorized property edit may cause unauthorized changes elsewhere in the YAML source. | Define the exact range each property command owns and preserve every unrelated byte. | Change, add, and delete one property in YAML containing comments, quotes, flow style, blank lines, tabs where accepted, CRLF, and a final newline. |
| Partial | [`liveMathCodec.ts`](../src/editor/liveMathCodec.ts) converts display-math delimiters to the private `mint-math` fence for Live and converts them back before application state. It deliberately preserves a detected LF/CRLF style and line array shape, but no exhaustive exact-string bijection covers ambiguous authored fences, spacing, or mixed endings. | A presentation-only codec could leak private syntax or canonicalize delimiters if a case is missed. | Materialization is reversible for every accepted input and never changes unrelated whitespace or reaches `onChange`. | Assert `canonicalize(materialize(source)) === source` across indentation, quotes, blank lines, backtick runs, incomplete math, CRLF, and surrounding invalid syntax. |
| Violation | Blockquote and fenced-code structure changes can trigger whole-document serialize-and-reparse transactions in their feature plugins. | A local edit can expose every unrelated block to serializer normalization and source-coordinate remapping. | Reparse from the authoritative canonical string and replace only derived presentation state; never generate the string from the derived document first. | Place distinctive whitespace and equivalent syntax before and after the edited block and assert exact preservation after every structural edit. |

### Invalid and incomplete syntax

| Status | Evidence | Impact | Required behavior | Required regression |
| --- | --- | --- | --- | --- |
| Partial | Source-backed blockquote, fenced-code, inline text, and application Front Matter paths retain some malformed inputs as literal text. Structured features still have syntax-specific input rules, atoms, serializers, and normalization paths; there is no shared “smallest affected literal range” guarantee. | A partial delimiter can disappear, be completed, change case, absorb a following block, or cause unrelated content to be reparsed. | If a construct is invalid or incomplete, show its original source literally in the smallest affected range. Continue rendering valid syntax elsewhere without repairing the invalid range. | Exact-string cases for incomplete headings, quotes, Callouts, fences, tables, links/reference definitions, TOC, and Front Matter, both alone and between valid blocks. |

## Required conformance matrix

Future implementation work must turn the following matrix into automated release gates. Tests must compare the canonical Markdown string directly; parse-tree equality is supplementary only.

### Source strings

Cover each case as LF and, where line endings exist, CRLF. Repeat with and without a final line ending.

```text
""
"\n"
"\n\n"
"\n\na"
"a\n"
"a\n\n"
"a\n\n\n"
"a\nb"
"a\n\nb"
"a\n\n\nb"
"a\n \n\t\nb"
" \t"
" \n\t\n"
```

Also cover consecutive soft line breaks inside paragraphs, mixed spaces and tabs around block delimiters, and mixed line endings as preserved opaque input until the product defines an explicit conversion command.

### Mode semantics

| Source | Source mode | Live mode | Reading mode | Stored source in every mode |
| --- | --- | --- | --- | --- |
| `a\nb` | Two source lines. | One paragraph with a visible authored line break. | One paragraph with a visible authored line break. | Exactly `a\nb`. |
| `a\n\nb` | Two paragraphs separated by one blank line. | Two paragraphs. | Two paragraphs. | Exactly `a\n\nb`. |
| `a\n\n\nb` | Two paragraphs with one extra blank line. | Two paragraphs and the extra authored blank line. | May use standard paragraph spacing. | Exactly `a\n\n\nb`. |

The visual assertion must measure line/paragraph layout; checking text content alone cannot distinguish a displayed line break from collapsed whitespace.

### No-edit operations

For every source-string case and syntax fixture:

1. Load or reopen the note.
2. Focus and blur the editor.
3. Move and extend the selection across every relevant boundary.
4. Activate and deactivate rendered previews, including quotes, Callouts, fences, and horizontal rules.
5. Switch Source → Live → Reading → Source in every order used by the UI.
6. Save, close, and reopen.
7. Exercise a renderer failure/fallback path.

Every step must preserve the exact canonical string and must not emit `onChange` without an authorized source edit.

### Local-edit isolation

For each supported syntax, edit one character near the beginning, middle, and end. Assert that the expected source range is the only changed substring and that all other content remains byte-for-byte identical. Fixtures must place leading, inter-block, trailing, and whitespace-only lines on both sides of the edit, plus equivalent Markdown spellings and repeated text that defeat simple unique-anchor mapping.

### Invalid-syntax fallback

Test incomplete headings, quotes, Callouts, fenced code, tables, inline links, reference definitions, TOC, and Front Matter. Each fixture must remain exact, display literally in the smallest invalid range, keep valid neighboring syntax renderable, and remain stable under mode switches and unrelated edits.

## Exit criteria and documentation policy

- A row moves to Compliant only when the target behavior is implemented and protected by exact-string tests plus presentation or cursor tests where relevant.
- New editor transformations must document their authorized source range, cursor mapping, undo unit, and invalid-input behavior before they are enabled.
- Full-document serialization is never acceptable as an implicit cleanup step. If serialization is used for export or diagnostics, its output remains non-authoritative.
- This documentation-only audit intentionally adds no expected-to-fail tests and makes no editor behavior changes.
- Do not copy target behavior into the user guide until the corresponding rows are Compliant and the behavior is released.
