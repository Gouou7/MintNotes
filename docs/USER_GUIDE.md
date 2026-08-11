# User guide

[Documentation index](README.md)

This guide describes the behavior implemented by the current Mint Notes release. Deployment and server administration are covered separately in the [deployment guide](DEPLOYMENT.md).

## Create or activate an account

Mint Notes supports English, Simplified Chinese, and Traditional Chinese. On first use, the login page checks the browser's preferred-language list and uses the first supported match; if none matches, it uses English. The language selector on the login page can instead follow the browser or select any supported language explicitly. This browser-local choice remains available before login.

The login page provides **Register** and **Forgot password** actions. The first account created on an empty server becomes the administrator even when public registration is disabled. The registration page identifies this one-time bootstrap case.

Later accounts use one of two paths:

- Public registration, only when the server administrator enables it. The registration form also links to activation-code registration.
- A 72-hour, one-time activation code created under **Settings > Administrator settings**. When public registration is disabled, **Register** opens this path directly and explains that an activation code must be requested from an administrator.

Usernames are 3-48 characters and use lowercase letters, numbers, `.`, `_`, or `-`. A master password must contain at least 10 characters.

Account creation displays a recovery key once. Copying it reports whether the browser clipboard accepted the key, and a plaintext download is available as a fallback. Save the key in a password manager or another secure location, then explicitly confirm that it has been stored before entering the vault. The server cannot recreate the master password, recovery key, or vault key.

Use **Forgot password** to reset a master password with the account's recovery key. Without that recovery key, the encrypted vault cannot be recovered.

## Understand the layout

Desktop uses three panes:

- **Left:** application branding, pinned shortcuts above search, local search, compact new-note/new-folder controls plus a right-aligned collapse-all/current-note-location/sort group, and the active note/folder tree. The tree scrolls independently while the account identity, settings, and lock icon buttons remain in one anchored bottom row.
- **Center:** note title, live/source/reading modes, note lock and image attachment actions, sidebar controls, and save/sync status.
- **Right:** a tool panel with tabs for the outline generated from Markdown headings and the active note's encrypted version history.

All three panes scroll vertically on their own. On desktop, each sidebar meets the center pane at a single divider line; drag the wider invisible target around either line to resize that sidebar. When the window is too narrow to keep the right tool panel pinned but is still wider than a phone-sized layout, the right panel becomes a temporary drawer while the left directory remains pinned and can always be collapsed or reopened with its sidebar button. The active note, its Live/Source/Reading mode, the collapsed state and widths of both sidebars, and the selected Outline/History tab are remembered per user in that browser or installed PWA and are never synchronized. Returning on the same device restores that device's workspace; another browser profile or newly signed-in device starts with an empty editor until you open a note. In that empty state, the center toolbar keeps the same layout as an open note, while the mode, note-lock, and image controls remain visible but disabled. Clearing site data or confirming logout removes the remembered workspace. On phone-sized screens, both sidebars become temporary drawers opened from the editor toolbar, and each drawer uses its matching sidebar-collapse button to close. You can also swipe inward from the left screen edge to open the directory drawer or from the right screen edge to open the Outline/History drawer. In the directory drawer, one tap opens a note or expands or collapses a folder; the `…` action remains visible on touch devices without requiring a hover gesture. Selecting a history version closes the right drawer and shows the read-only preview in the center.

Status and warning messages, including transient results from Settings and Administrator settings, appear as notifications in the upper-right corner below the top toolbar without changing the editor or modal layout. Progress and success notices disappear after four seconds, and routine warnings after seven seconds. Critical storage or conflict notices remain until closed manually. Persistent one-time results that must be copied or saved, such as recovery keys and activation codes, remain inside their settings section.

## Organize notes and folders

Use the new-note or new-folder icon above the tree to create a root item. A new note opens with its complete default title selected in the title field, ready to replace by typing. Press Enter after naming the note to save the title and move focus directly into the editable Markdown body. A new folder opens an inline name field in the tree with its complete default name selected; press Enter or leave the field to save the name, or press Escape to keep the generated default. The same behavior applies when creating child items from a folder's contextual menu. The right-aligned collapse-all button immediately closes every expanded folder. The adjacent location button clears the current search, expands every ancestor folder, selects the active note, and scrolls its tree row into view. The sort icon opens the sorting choices.

Creating a note opens it in **Live** mode even if the previously viewed note was in Source or Reading mode, so the new note is immediately editable. A verified empty account receives a welcome note in the interface language active during its first unlock.

Note and folder names share one namespace within each directory. Creating another unnamed note adds `2`, `3`, and so on to the localized **Untitled note** name; folders use the same numbering behavior starting with the localized **New folder** name. Importing, duplicating, and conflict-copy creation also select an available sibling name automatically. Renaming, moving, or restoring an item is blocked when it would create a duplicate name in the destination directory. Items in trash do not reserve their former names.

Items can be dragged:

- Drop a note or folder into the middle of a folder row to move it inside. The destination folder is highlighted while it is ready to accept the item.
- In any sorting mode, drag near the upper or lower edge of a row to show a connected mint insertion marker for that row's parent directory.
- In **Manual** sorting, dropping on the marker reorders siblings at that exact position. Dropping an item or selection back onto its current position leaves the order unchanged.
- In A-Z, creation-time, or modification-time sorting, dropping on the marker can still change the parent folder, but the selected sort rule determines the item's final position.

Click an item to select it. Hold `Ctrl` on Windows/Linux or `Command` on macOS while clicking to add or remove individual notes and folders from the selection. Hold `Shift` while clicking to select a continuous range in the currently visible tree order; collapsed descendants are not part of that range. Right-click any selected row to move, drag, pin, duplicate, export, or trash the selection as a batch. Pinned notes and folders also appear as shortcuts in the **Pinned** section above the file tree and can be unpinned from either location. Clicking any pinned shortcut expands its complete ancestor path and scrolls its regular tree row into view; a pinned note opens in the editor, while a pinned folder also expands itself. The original position and folder hierarchy do not change. When both a folder and one of its descendants are selected, recursive operations process that subtree only once. Opening, renaming, and creating children remain single-item actions.

A folder cannot be moved into itself or one of its descendants.

Open the contextual menu with right-click or the `…` button. It provides open, rename, move, pin or unpin, create child, duplicate, export, and move-to-trash actions as applicable. Renaming a note or folder opens an inline name field on that item in the file tree instead of a browser dialog; press Enter or leave the field to save, or press Escape to cancel. Duplicating a folder recursively copies its descendants. Attached images receive new IDs and keys in a copied note.

Locked notes can still be moved normally, pinned, copied, exported, and opened from WikiLinks. A copied note is unlocked so it can be edited independently. A folder may still be renamed or moved when it contains locked notes, but neither the folder nor a larger batch containing it can be moved to trash until every locked descendant has been unlocked.

## Edit Markdown

The center toolbar provides three modes:

- **Live:** Typora-style editing with Markdown rendered in place.
- **Source:** edit the canonical Markdown text directly.
- **Reading:** render the current Markdown without editing controls.

Markdown remains the canonical note format in every mode. Switching modes does not convert it to a proprietary document format. The right outline is generated from H1-H6 headings and never uploads as separate plaintext metadata.

Encrypted image attachments render in Live and Reading modes after their browser-local Blob URLs are ready. Switching away from a note revokes those temporary URLs; returning to it reloads the images in place without changing the Markdown or moving the Live-mode caret.

In Reading mode and read-only historical previews, hover over a fenced code block to reveal its copy button in the upper-right corner. Select it to copy the complete code block. The button remains visible on touch devices and can also be reached with the keyboard.

An empty Live or Source editor shows a **Start writing…** hint at the first editable line. The hint disappears as soon as the editor receives focus, keeping the insertion caret unobstructed, and is presentation only: it is never added to Markdown, history, IndexedDB, synchronization, or exports.

Use the lock button immediately to the left of the image action, or **Lock note** in a single note's contextual menu, to protect it from accidental editing or deletion. Locking the current note saves pending title and editor changes locally first, then shows the note in Reading mode without changing this device's remembered Live/Source/Reading choice. Live and Source are disabled while the note is locked; the title, YAML properties, and **Restore as current** history action are also unavailable. The image action remains visible but disabled to keep the toolbar layout stable. Use the same toolbar or contextual-menu action to unlock it and restore the underlying device-local mode. Changing only the lock state does not change the note's modification time. The file tree and pinned shortcuts show a small lock badge on protected notes.

The note lock is an encrypted, cross-device client-side safety control, not password protection or a server authorization rule. It does not require a PIN or master password. Updated clients synchronize it with the note; if a remote lock arrives while that note is actively open, the existing active-note deferral rule applies and the lock becomes visible after leaving and reopening the note.

Live mode gives each authored blank line one editable row. The two line endings that separate ordinary Markdown paragraphs produce the normal single-row paragraph gap; each additional blank line adds exactly one more row. Leading and trailing blank lines, spaces or tabs on otherwise blank lines, and LF or CRLF line endings remain unchanged when switching modes, saving, or reopening a note. Typing in a blank row immediately turns that row into normal Markdown content.

Enter inserts one authored line ending. In an established list or quote it also writes the next source prefix; an ordered list increments its visible source number, while a new task is always unchecked. Enter on an empty list or quote line removes that line's prefix and returns to ordinary text. Shift+Enter writes a Markdown hard break in prose and an indented continuation line inside a list item. Backspace and Delete remove one authored character at a time, including across blank lines and hidden delimiters. Tab and Shift+Tab on a list item write or remove Markdown indentation instead of applying a presentation-only margin.

Headings adopt their level's Live typography as soon as the leading `#` run is typed. Entering an established heading, list, task, reference definition, or other source-backed structure reveals its original delimiters in a muted syntax color without changing the content style or normalizing equivalent spellings. Inline emphasis, strong emphasis, strikeout, highlight, code, Markdown links, WikiLinks, images, and math follow the same rule: delimiters hide while the caret is elsewhere and reappear over the same authored source range for editing. Clicking a task checkbox changes the corresponding `[ ]` or `[x]` character in one undoable Markdown edit.

The safe inline HTML spelling `<br>` (including `<br/>`) produces a rendered hard break while inactive and reveals its exact muted source when selected. Other raw HTML remains disabled. Obsidian comments written as `%%comment%%`, including multiline comments, are hidden in inactive Live and Reading views; moving the caret into a complete comment reveals the authored source for editing. Removing a closing delimiter immediately returns the incomplete text to normal Markdown display.

In Live mode, a line-leading `>` immediately enters the source-backed quote candidate state without adding or changing any characters. Press Enter to add another line with the same authored quote prefix. While the caret is inside the block, Live mode exposes the complete source—including every `>`, space, line break, blank quoted line, nested prefix, and fence—so normal cursor movement, Backspace, and Delete edit those characters in order. At the far left of the block, Backspace moves to the previous editable line instead of removing the `>` to its right; at the start of the document it does nothing. Delete may remove the `>` to the caret's right. Press Enter on the final empty quoted line to leave the block. When the caret moves elsewhere, Live mode shows a stable rendered preview; click that preview to reveal the same source block with the caret at the nearest source line. Preview and source share the same reserved footprint, avoiding a document jump when editing is activated. The Live editor does not automatically insert backslashes before punctuation. To request a literal Markdown-significant symbol, type the backslash yourself in Live or Source mode—for example, `\>` displays as an ordinary `>` instead of starting a blockquote. Live mode hides that user-authored escape while the canonical Markdown retains it across reloads.

In Live mode, click anywhere on a rendered horizontal-rule row to reveal its `---`, `***`, or `___` Markdown source with the caret at the end. Moving the caret into a horizontal rule with the arrow keys also reveals its source, placing the caret at the side from which you entered. You can then delete or edit the delimiter. Press Enter at the end to add a line after the rule; at the start, Enter inserts a line before it, and in the middle it splits the visible source at the caret. Moving the caret away from an unchanged delimiter renders it as a horizontal rule again.

In Live mode, a fenced code block reserves space for its opening and closing fences so its height stays unchanged when the source appears. While the caret is elsewhere, the fences are hidden and the language appears in the upper-right corner. The hidden fences remain real editable Markdown rather than a separate rendered copy. Click anywhere in the block, or move the caret into it with the arrow keys, to reveal editable opening ```` ```lang ```` and closing ```` ``` ```` lines at the top and bottom edges. Entering from below places the caret on the closing fence; repeated ArrowUp presses then visit each code line and the opening fence before leaving the block. Backspace at the start of the paragraph below likewise moves to the authored closing fence before it can delete code-body text. Entering from above follows the reverse order, and Delete at the end of the preceding paragraph moves to the authored opening fence. On an otherwise empty code line, typing ```` ``` ```` immediately closes the block at that line and reparses all following text as Markdown. Any later fence remains exactly where it was and participates in that reparse; Mint Notes does not delete or relocate it. Press Enter at the end of an existing valid closing fence to leave the block and start a paragraph below it. A block with only an opening fence extends through the end of the note, including lines that otherwise look like headings or lists. Typing a closing-fence line inside it ends the block immediately. Removing a tick from the closing fence immediately makes it incomplete and reparses the following text as part of the now-unclosed code block. Mint Notes preserves that exact Markdown after saving and reopening instead of generating a replacement fence.

### Math, diagrams, and WikiLinks

Use `$...$` for inline KaTeX and `$$...$$` for display math. Display math may occupy one line or use opening and closing `$$` lines:

```markdown
Euler's identity is $e^{i\pi} + 1 = 0$.

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$
```

Live and Reading modes render the formula; Source mode always shows the canonical delimiters. Selecting an inline formula or activating a display formula reveals its editable source in Live mode. Math inside inline-code spans or fenced code blocks remains literal.

Put Mermaid source in a fenced block whose language is `mermaid`:

````markdown
```mermaid
flowchart LR
  Draft --> Review
  Review --> Publish
```
````

The browser renders Mermaid locally. Activating a diagram in Live mode reveals its fenced source. Diagram links and scripts are not interactive, external resource references are removed, and a diagram that cannot be parsed remains available in Source mode.

WikiLinks use `[[Note title]]`. Add `|Label` to choose the displayed text, use a folder path to disambiguate duplicate titles, and append `#Heading` to open a section. Prefix the link with `!` to render a source-backed embed label:

```markdown
[[Setup]]
[[Guides/Setup|Setup guide]]
[[Setup#Install]]
[[#Local heading]]
![[Setup|Embedded setup]]
```

A title-only WikiLink prefers a note in the current folder, then another matching live note. A folder path starts at the vault root. Missing targets show a notice; Mint Notes does not create a note implicitly. WikiLinks remain ordinary portable Markdown text in exports, so tools without WikiLink support can still display their source.

### Callouts

Place an Obsidian-style callout marker on the first line of a blockquote:

```markdown
> [!TIP]
> Keep the recovery key somewhere safe.

> [!WARNING]- Optional details
> This callout starts collapsed in Reading mode.
```

Mint Notes recognizes every built-in Obsidian type and alias: Note; Abstract/Summary/TLDR; Info; Todo; Tip/Hint/Important; Success/Check/Done; Question/Help/FAQ; Warning/Caution/Attention; Failure/Fail/Missing; Danger/Error; Bug; Example; and Quote/Cite. Aliases use the same color and icon as their official type while keeping the alias as the default title, such as Important or Caution. Type names are case-insensitive. Unknown names use a neutral style so custom callouts remain readable. Add a space and text after the marker for a custom title—for example, `> [!TIP] Custom title`. In Live mode, click the rendered Callout to reveal the complete authored blockquote source. Clicking its header places the caret at the end of the first source line; clicking its body chooses the nearest source line. Moving the caret away restores the rendered icon, title, and body without rewriting the marker. A `+` suffix makes the callout collapsible and initially expanded; `-` makes it initially collapsed. Live mode keeps every Callout expanded so its Markdown remains editable. Reading mode and historical previews honor the requested fold state.

An optional Mint Notes appearance block may follow the title:

```markdown
> [!TIP]+ Deployment {color=purple icon=important}
> Verify the backup before upgrading.
```

`color` accepts `gray`, `blue`, `cyan`, `green`, `purple`, `amber`, `red`, or `rose`. `icon` accepts these Mint Notes icon identifiers: `note`, `abstract`, `info`, `todo`, `tip`, `important`, `success`, `question`, `warning`, `caution`, `failure`, `danger`, `bug`, `example`, `quote`, or `custom`. Invalid or unknown attribute blocks remain part of the visible title instead of being discarded. Other Markdown tools may show the `{...}` block as title text because these appearance attributes are a Mint Notes extension.

Live mode edits Callout source with the same rules as any other blockquote. Enter continues the current authored quote prefix; Enter on the final empty quoted line exits the block, so a bodyless Callout may consist of only its marker line. Backspace and Delete traverse the literal prefixes and marker characters instead of deleting the rendered frame as one unit. If an edit makes the marker incomplete, such as `> [!CAUTION`, the Callout immediately degrades to an ordinary blockquote while preserving that exact source and its surrounding lines; retyping `]` restores the Callout presentation. Nested quote levels remain visible in source and are edited in authored order. Standard undo restores each source edit. Live editing never adds placeholders, word-joiners, highlight/backtick sentinels, synthesized quote prefixes, or backslash escapes.

### YAML properties

Valid YAML frontmatter at the very top of a note appears as a properties panel in Live and Reading modes:

```yaml
---
version:
description:
created:
modified: "{{date}}"
tags:
---
```

In Live mode, edit, rename, add, or remove top-level scalar properties and simple scalar lists directly in the panel. Boolean values use checkboxes, ISO dates use date inputs, and lists such as `tags` use value chips. Reading mode and historical previews show the same properties read-only. Source mode always exposes the complete original YAML.

Nested objects, nested lists, multiline values, anchors, and aliases are shown read-only in the panel and must be edited in Source mode. Invalid YAML is preserved unchanged and shown with a source-editing notice. Notes without frontmatter do not show a properties panel. Mint Notes never evaluates template text such as `{{date}}` and does not automatically create or update `created` or `modified`.

On desktop, the left side of the status bar shows the active note's creation time, latest modification time, and local save or synchronization state. On phone-sized screens, it keeps only the save or synchronization state so the essential status remains readable without horizontal scrolling; creation and modification times remain available through the status tooltip on pointer-based browsers. Moving the caret or changing the selection without changing the title or Markdown does not update the modification time. The right side counts words with language-aware segmentation. Punctuation is excluded from the word count. The character count excludes whitespace but includes symbols.

## Use note history

Open **History** in the right tool panel to browse the active note's saved versions. Versions are grouped by day. Select one to replace the center editor with a read-only historical preview; **Exit preview** returns to the current note without changing it.

Automatic history is enabled by default. During an editing session Mint Notes saves the state before editing when the configured interval has elapsed, records checkpoints every 10 minutes by default during continuous editing, and records the final state after two minutes without content changes. Identical automatic content is not saved twice. **Save current version** always creates a complete manual snapshot, even when the content is unchanged or automatic history is disabled. Its initial name is the current local date and time, it starts protected, and its inline name field is focused with the complete name selected so it can be replaced immediately.

Each row shows its name, capture time, capture type, and pending-sync state. Existing versions and versions without a custom name display their localized capture time. Open the row's `…` menu to rename it, protect or unprotect it, or delete it. Rename accepts Enter or focus loss, Escape cancels, and blank names are rejected. Protected rows reuse the small lock badge shown on locked notes; protection is independent from locking the current note.

Automatic versions are thinned as they age: all are kept for 24 hours, then the newest version per hour through day 7, and the newest version per day afterward. Manual and pre-restore safety versions are not thinned. Unprotected versions remain subject to the account retention setting, which defaults to 90 days. Protected versions still consume the history quota but are excluded from thinning, retention cleanup, single-version deletion, and current-note or account-wide history clearing. Rename and protection changes are saved to the encrypted local database first and synchronize after reconnecting.

Historical preview provides two restore actions:

- **Restore as current:** first saves the current note as an unprotected pre-restore safety checkpoint, then writes the historical title, Markdown, tags, and attachment references as a normal new local-first revision. Folder position, favorite state, creation time, and ordering are preserved. You can protect that safety checkpoint afterward from its `…` menu.
- **Restore as copy:** creates a new sibling note and gives every referenced attachment a new UUID and encryption key. The original note is unchanged. The operation stops if all referenced attachments cannot be recovered.

Deleting one unprotected version, clearing the current note's unprotected history, and clearing all unprotected account history require an online connection and explicit confirmation. A clear first synchronizes pending protection changes and stops safely if they cannot be confirmed by the server. Moving a note to trash keeps its history. A note with protected history, and an attachment referenced by protected history, cannot be permanently deleted until the relevant snapshots are unprotected; automatic trash cleanup skips them as well. If an attachment was already missing when protection was enabled, Mint Notes protects the recoverable text and remaining attachments but cannot reconstruct the missing bytes. Open **Settings > Note history** to disable automatic capture, select a 5/10/30/60-minute interval, choose a 7/30/90/180/365-day or permanent retention period, inspect encrypted history usage, or clear unprotected versions. The server enforces a separate 256 MiB per-user history quota by default.

## Add images

Drop a supported image into the live or source editor to insert it at the drop position. You can also copy an image to the clipboard and paste it at the current cursor with `Ctrl+V` on Windows/Linux or `Command+V` on macOS. Ordinary text paste is unchanged. The image toolbar button provides a file-picker fallback.

After local encryption finishes, an inserted image appears in the active note without requiring a refresh. Live mode updates the rendered image in place when its temporary Blob URL becomes available, preserving the active editor and caret. The image remains available when switching among Live, Source, and Reading modes; the temporary in-memory Blob URL used for display is never written into the canonical Markdown.

Supported formats are PNG, JPEG, GIF, WebP, and AVIF. The browser verifies file signatures and rejects SVG. The bundled client limits each image to 25 MiB.

Each image is encrypted locally with its own random key and UUID before synchronization. Other devices download encrypted chunks only when the owning note is opened. Decrypted Blob URLs exist only in memory while required by the active note.

An attachment belongs to one note. Copying the note creates a separate encrypted attachment. Moving a note to trash also tombstones its attachments; restoring the note restores them.

## Local save and synchronization

Editing never waits for a network request. After half a second without input, or at least once every five seconds during continuous typing, the browser encrypts the latest document and atomically writes both the encrypted object and a durable outbox entry to IndexedDB. If typing continues while that write is in progress, its completion does not replace the newer in-memory text or disturb the active Live editor caret. A failed local encryption or browser-database commit stays queued in the unlocked tab and retries automatically; ordinary locking waits for it rather than discarding the draft. Keep the tab open while a critical local-save warning is visible, because a browser crash cannot preserve data when its storage subsystem remains unwritable. Network uploads combine nearby changes and send the latest durable version after two seconds of inactivity or at least once every fifteen seconds during continuous editing. Once acknowledged, the server is the durable cross-device copy; the local encrypted store exists as a low-latency working cache and retry queue.

The status bar reports:

- **Synced:** the initial server check has completed and no local object, attachment chunk, or history snapshot remains in an outbox.
- **Syncing:** the latest change is durable in encrypted local storage and is waiting for server acknowledgement, queued ciphertext is being uploaded, or remote changes are being pulled.
- **Sync error · saved locally:** the browser is online but the server request failed or was rejected. The encrypted local copy remains available and the app retries automatically.
- **Offline · saved locally:** the browser has explicitly detected that the device is offline. Editing can continue in the unlocked vault and synchronization resumes after reconnecting.

Local saving remains separate from network synchronization. While encryption and the atomic IndexedDB object/outbox write are in progress, the visible status does not change. After that durable write completes, it changes to **Syncing**. On pointer-based browsers, the status tooltip distinguishes local saving, waiting for the server, active network synchronization, an unreachable server, and an explicit offline condition. A local encryption or IndexedDB failure instead produces a persistent critical warning and never claims that the latest change was saved locally.

Synchronization pulls remote changes at startup after unlock, after reconnecting, when the page becomes visible, and when the server sends a lightweight change notification. It no longer performs a complete synchronization every five seconds. While the unlocked page is visible, a five-minute safety check covers missed notifications; hidden and locked pages do not poll. Attachment chunks upload before their manifest and owning note update.

Remote changes are applied to the local encrypted database in batches so a large update does not remove or redraw tree items one by one. A page cursor advances only after every retained change decrypts and commits locally; a failed change is retried instead of skipped. Workspace choices are device-local, so synchronization never switches the active note, editor mode, or sidebar state. If the currently edited note changes or is deleted on another device, Mint Notes keeps the current editor stable and shows a notification; the remote version appears after leaving the note, or the local draft is retained as a conflict copy when both devices edited it. Remote permanent deletion waits while any affected local object, attachment, or history operation remains pending. Pulling back the exact encrypted revision that this browser already uploaded and acknowledged advances synchronization silently and does not show an “updated on another device” notification.

If one encrypted local or remote object cannot pass decryption and integrity checks, Mint Notes isolates that object instead of aborting the whole vault load. Other readable notes remain visible, the original local ciphertext and any pending edits are retained, and a full server pull is attempted when it is safe to do so. A new welcome note is created only after an online full pull confirms that the account is actually empty. The persistent local warning offers **Do not show this version again**; this records only the exact object revision and nonce in local preferences and does not delete or modify its ciphertext. A changed revision is reported again. Do not clear the site's browser data, because it may contain the only pending encrypted copy.

When two devices update the same object from the same base revision, Mint Notes does not choose a winner by timestamp. It retains the server version and creates a local note named with a localized **conflict copy** suffix for the conflicting document data. Attachments in that copy receive independent IDs and encryption keys, so deleting the original note cannot break the conflict copy. If every referenced attachment cannot currently be recovered, Mint Notes keeps the pending local version and synchronization cursor for retry instead of creating an incomplete copy.

## Search and sorting

Search runs locally over decrypted titles and Markdown. Matching descendants keep their parent folders visible so results retain context. Search terms are not sent to the server. When the search field contains text, use the clear button on its right to remove the entire query and restore the full tree.

Available sorting modes are:

- **A-Z:** folders first, then locale-aware title order.
- **Created:** newest first.
- **Modified:** most recently changed first.
- **Manual:** explicit sibling order controlled by dragging.

The selected mode is remembered per user in the current browser.

## Trash and permanent deletion

Moving an item to trash happens immediately without an extra confirmation. A locked note cannot be moved to trash. A folder or multi-item selection containing a locked note at any descendant depth is blocked as a whole until that note is unlocked. Moving an allowed folder includes its descendants; owned attachments follow their notes. Open **Settings > Trash** to browse the original deleted folder hierarchy and deletion times. Deleted folders start collapsed and show the number of descendants they contain; expand one folder at a time when you need to inspect its original hierarchy. Search by title, filter notes or folders, and sort by newest deletion, oldest deletion, or name. Search and type filters reveal the ancestor path of a matching nested item automatically. Long root lists are shown in batches. Restore appears on each deleted root, while permanent delete is available from its more-actions menu; both apply to that root and all of its descendants.

Trash is retained for 30 days by default. Under **Settings > Trash**, choose 7, 30, 90, 180, or 365 days, or retain trash permanently. The choice saves immediately. The server applies the selected policy hourly to synchronized tombstones; other devices remove their cached copies when they receive the purge event.

Use **Clear trash** or an item's **Permanently delete** action for immediate cleanup. Both require an online connection and a second explicit confirmation. A batch containing a note with protected history or an attachment referenced by protected history is rejected as a whole; unprotect every relevant snapshot before retrying. A confirmed allowed purge removes the object's server history and associated attachment chunks and cannot be undone.

Do not use permanent deletion as a substitute for retention management. A previously created server backup or plaintext export may still contain the data.

## Import and export

Open **Settings > Import and export**.

### Export

Every Markdown or ZIP export asks for confirmation because its contents are plaintext.

- A note without attachments exports as one `.md` file.
- A note with attachments exports as ZIP.
- A folder exports only that subtree.
- A complete export retains the folder hierarchy and empty folders.
- Images are written under `_attachments/<uuid>.<ext>`, and Markdown links become portable relative paths.
- `_export.json` records the format version and original attachment-name mapping for lossless re-import.

Exports are decrypted in the browser. Markdown and ZIP output is plaintext and must be stored in a trusted or independently encrypted location. Export stops instead of silently creating an incomplete ZIP when an attachment cannot be recovered.

The lock state is application metadata rather than Markdown content, so Markdown and ZIP exports do not retain it. Imported notes and notes created from an explicit copy start unlocked.

### Import

The importer accepts Markdown, text, and ZIP files without an application-level size limit for the source file, individual note entries, or total expanded data. Available browser memory and storage still determine the practical limit. ZIP folder structure and empty directories are retained. Relative Markdown image links are converted to encrypted attachments when their files are present, valid, and within the separate 25 MiB per-image attachment limit.

The importer rejects unsafe path traversal, duplicate archive paths, archives containing more than 4,000 files, and unsupported image contents.

## Settings and account security

The settings sections are ordered as **General**, **Security**, **Note history**, **Trash**, **Data migration**, and **About**, followed by **Administrator settings** for administrators. Each section has a distinct navigation symbol. Except while a replacement recovery key must be saved, close Settings with its close button or by clicking outside the Settings window.

The top of **General** displays the current avatar, display name, and login username without a separate profile section. Choose **Edit profile** to reveal the avatar actions and separate display-name and username forms, each with its own change button; avatar actions are labeled **Upload avatar**, **Change avatar**, and **Remove avatar** as applicable. The same page also lets you select the interface language and theme and enter an application text size from 12 to 24 pixels. The default is 14 pixels; choose **Restore default** to return to it. Language can follow the browser or explicitly use English, Simplified Chinese, or Traditional Chinese. Language, theme, and text size save immediately in the current browser. Each user's language preference is kept with that user's device-local UI preferences and is also mirrored to the pre-login selector; it is not sent to the server. Avatar images are center-cropped to 256 by 256 pixels before browser-side encryption; the server stores only the encrypted profile asset.

Changing the login username starts from **Edit profile**, then continues to a verification dialog instead of keeping password and recovery-key inputs on the settings page. An online verified session and the current master password are required. Enter the existing recovery key to keep it unchanged, or choose **Reset recovery key and continue** when it is unavailable. The reset path shows the replacement key before committing the change and requires explicit confirmation that it has been stored; closing the dialog before completion leaves the old username and recovery key valid. The browser rewraps both vault-key envelopes without re-encrypting notes, attachments, or history, then the server atomically changes the username, encrypted envelopes, and—only on the reset path—the recovery verifier. Other devices are signed out and must update Mint Notes before logging in with the new username. Existing accounts keep their compatible legacy envelope until their first username change; that change migrates the account to an immutable random envelope context so later username changes no longer make the cryptographic binding depend on the login name.

Under **Security**, the **Account credentials** row keeps the **Change master password** and **Reset recovery key** actions together without displaying password fields until an action is selected. Changing the master password opens a dialog for the current and replacement passwords, then rewraps the vault key rather than re-encrypting every note. Other login sessions are revoked, and the recovery key remains unchanged.

The login page leaves **Remember this device** off by default. Without it, the session cookie belongs to the current browser session: refreshes can continue without another password, and a new tab can continue only while another authorized tab can grant it access. A non-remembered device cannot cold-start offline. With the option enabled, the browser stores a non-exportable device key, a rolling long-lived session, and a versioned snapshot of the most recently server-verified user and remembered endpoint. That snapshot permits offline cold startup on the same browser profile: a device without a local PIN opens its encrypted local vault directly, while a PIN-protected device shows the PIN lock screen. Older remembered credentials created before this support must complete one successful online restoration before they acquire the snapshot. Clearing site data removes offline access; clearing cookies or remotely revoking the endpoint is detected when the device next reaches the server.

Press Enter in the login password, PIN unlock, master-password unlock, registration confirmation, password-recovery confirmation, PIN setup, or master-password-change fields to run that form's primary confirmation action. Input-method composition and repeated keydown events do not submit, and a busy form ignores additional Enter presses.

The same section lists trusted browser endpoints rather than individual login tokens. Repeated login from the same user and browser profile preserves the first-trusted time and updates recent login, recent online time, login count, IP address, remembered status, and active state. A current endpoint must be trusted for at least 24 hours before it can sign out another active endpoint. Remote sign-out revokes every session belonging to that endpoint. Signed-out and expired endpoint records can be removed immediately from the list; otherwise the server deletes them automatically 30 days after revocation or session expiry. Removing an inactive record also removes its old server-side sessions, but does not delete any synchronized notes or browser-local data on that device.

The **Security** section presents **Device PIN**, **Automatic locking**, **Login devices**, and **Change master password** in that order, followed by recovery-key controls. The PIN row shows only its current status and the available set, change, or remove actions; the master-password and new-PIN fields appear in a confirmation dialog only after an action is selected. Set a PIN of at least four characters independently after re-entering the master password; letters, numbers, and symbols are accepted. Removing it also requires the master password and disables automatic locking. The PIN stays local and encrypts the complete persistent device-unlock envelope after its non-exportable device-key layer. The PIN-derived key is never persisted. While an unlocked tab is running, it keeps a separate encrypted refresh envelope only in that tab's browser session so an ordinary refresh can continue without asking again. Legacy PIN-verifier credentials upgrade automatically after their next successful PIN unlock. Use a longer local passphrase when protection against browser-storage theft matters because a short PIN can be guessed offline. Resetting the recovery key invalidates the old key immediately, keeps the result dialog open, and disables the Settings close action until you copy or download the replacement and explicitly confirm that it is stored safely.

When a PIN is configured, each ordinary application launch requires it even if automatic locking is off. The PIN also supports manual locking. Automatic locking is an independent option: it is off by default and can be set to 1, 2, 5, 10, 15, 30, or 60 minutes after a PIN exists. Disabling automatic locking preserves both the PIN and the startup PIN requirement. Five consecutive failures clear local trust and request endpoint revocation, but the browser-local counter is damage control rather than a cryptographic defense against offline guessing. Keyboard, pointer, touch, input, and scrolling activity reset the timer; time spent on a hidden page still counts.

Locking clears the in-memory vault key, PIN-derived key, decrypted device envelope, the current tab's encrypted refresh envelope, plaintext documents, and attachment Blob URLs but preserves the authenticated endpoint, PIN-encrypted persistent credential, ciphertext cache, and synchronization outbox. The lock screen shows the current account's display name without retaining or displaying its encrypted profile avatar. Refreshing a manually or automatically locked page cannot bypass the PIN. Use the lock button beside Settings to lock immediately; if this device has no PIN yet, the application directs you to **Settings > Security > Set PIN** first. Unlock with the local PIN when configured, or use the master password as a fallback only after the server session has been verified; the master-password option is unavailable during offline restoration. **Log out** is available only at the bottom of **Settings > General** and requires a second confirmation. Logout permanently deletes this account's complete local browser data, including encrypted notes and attachment chunks, unsynchronized outboxes, local preferences, PIN, device credential, and temporary authorization state. It also revokes all sessions for the current endpoint; if that request cannot reach the server, a browser-local pending revocation is recreated after local deletion and retried at the next online startup. Unsynchronized changes cannot be recovered; content already synchronized to the server is not deleted and downloads again after a later login. Other local accounts, the shared pre-login language choice, and PWA application files are not removed.

If the password is lost, choose **Forgot password**, enter the username and saved recovery key, then set a new password. Complete a recovery drill before storing irreplaceable data.

The **Reset recovery key** action in **Settings > Security > Account credentials** opens a separate master-password dialog before creating a replacement recovery key. The new key remains in that dialog with copy and download actions until **I have saved it** is selected; the previous key stops working immediately and is never persisted by the browser or server.

On smaller screens, Settings keeps its title and a single-row, horizontally scrollable tab bar above the independently scrolling section content. Each tab keeps its full label and icon without shrinking when a section contains more content.

The **About** section introduces Mint Notes as an AI-developed toy project focused on lightweight deployment, secure storage, simple use, responsive PWA layouts, end-to-end encryption, remote self-hosting, and familiar Markdown editing. It also shows the current application version and credits `typora-web` as the origin of the in-repository editor core and Lucide React as the interface icon library.

Administrators manage activation codes and accounts under **Administrator settings > User management**, which separates **Add user** from **Existing users** so other administrator settings can be added independently. Disabling is reversible. Permanent deletion requires the administrator's master password and the exact target username, cannot target the current or last administrator, and removes that user's server database records and encrypted content without touching other users. Independent backups and ciphertext already cached in a user's browser are outside this remote deletion.

## PWA and offline behavior

Install Mint Notes from the browser's PWA/install menu after opening it over HTTPS. The application shell is cached for offline startup. A remembered device can cold-start offline and load its durable encrypted local objects before any network work: without a PIN it opens directly, and with a PIN it requires the correct PIN. A non-remembered device shows that offline access is unavailable.

On supported iPhones and iPads, the installed application fills the complete available viewport, including the background beneath the bottom safe area, while keeping controls clear of the status area and Home indicator. The time, connectivity indicators, Dynamic Island, and Home indicator remain system-owned and visible. Some iOS/WebKit releases may still reserve an opaque strip above Home Screen web applications; Mint Notes cannot draw into that system-owned area. After an application update that changes the installed appearance, fully close and reopen Mint Notes; removing and adding it to the Home Screen again may be necessary if iOS retains older installation metadata.

An application-update prompt appears only when the browser has installed a changed Service Worker and is waiting to activate it. Mint Notes fingerprints the deployed Service Worker content, so restarting the same server build does not create a new version. Duplicate callbacks, refreshes, and reopenings for the same pending version are suppressed for 24 hours; a genuinely different deployed version prompts immediately. Confirm the prompt only after the status bar shows that the latest edit is saved locally. Confirmation activates the waiting version and reloads the application.

The installed application keeps its interface at the device viewport scale. Two-finger pinch gestures do not zoom the application shell; use the text-size setting under **Settings > General** when larger interface text is required.

A normal online refresh first verifies the server session. Without a local PIN, an already authorized browser session can restore locally without showing the lock screen. With a PIN configured, an unlocked tab's ordinary refresh may use its tab-scoped encrypted refresh envelope and stay unlocked only when the optional inactivity interval has not elapsed; manual lock and inactivity lock delete that envelope, so refreshing the lock screen still requires the PIN. An ordinary browser or installed-app launch requires the PIN even when offline. During locally restored operation, the status bar reports that changes are saved locally; synchronization, server history, uncached attachment downloads, account/device controls, administration, and server retention settings remain disabled. The application revalidates when connectivity returns, when the visible page regains focus, and every 30 seconds while visible. Only a successful check for the same remembered endpoint enables network work, which resumes by pulling before pushing. A `401`, endpoint no longer marked remembered, or user/endpoint mismatch immediately locks the vault and deletes local trust while retaining the encrypted cache and outboxes for recovery after the same account signs in again.

Remembered-device offline trust has no additional local expiry. This improves availability but delays remote revocation until the device reconnects. Without a PIN, possession of the trusted browser profile is enough to ask its non-exportable device key to decrypt the local vault, so enable a PIN when physical access or browser-profile compromise is a concern.
