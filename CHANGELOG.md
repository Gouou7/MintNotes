# Changelog

All notable changes to Mint Notes are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Added end-to-end encrypted custom names and independent protection controls for every note-history snapshot, with inline renaming, a shared protection badge, and a compact three-action menu.
- Added username changes in Settings. The confirmation dialog accepts the current password and recovery key, or can generate a replacement recovery key when the existing key is unavailable.

### Changed

- Changed manual history saves to always create a complete snapshot, even when content is unchanged, using a selected local date-time name and protection by default; automatic history remains deduplicated and unprotected by default.
- Moved client and server history behavior into dedicated typed modules, with durable offline metadata updates and additive compatibility for existing encrypted history records.
- Moved the Live Markdown editor into the Mint Notes codebase as a project-owned core, preserving canonical Markdown compatibility while loading Callouts, math, Mermaid, and WikiLinks through maintained extensions.
- Decoupled new vault-key envelopes from usernames so accounts can be renamed without changing passwords or encrypted note data, while legacy accounts migrate automatically on their first username change.
- Changed device PIN setup, replacement, and removal to request the master password and new PIN in an action-specific confirmation dialog instead of keeping credential fields on the Security settings page.
- Grouped master-password changes and recovery-key resets under two account-credential actions whose verification fields open only after the user selects an operation.

### Security

- Protected history is excluded from individual deletion, bulk clearing, retention cleanup, and thinning, and prevents physical cleanup of its owning note and referenced attachments until protection is removed; custom names remain encrypted while the server sees only the protection state and random attachment references.
- Username changes now atomically update the login name and encrypted vault envelopes, revoke other sessions and remembered endpoints, and require either the current recovery key or explicit confirmation of a newly generated replacement key.

## [0.9.0] - 2026-07-30

### Fixed

- Fixed pinned nested notes and folders remaining hidden when selected from the Pinned section while their parent folders were collapsed; the complete path now expands and the original tree row scrolls into view.

## [0.8.4] - 2026-07-30

### Fixed

- Fixed continuous Live editing occasionally losing the caret or reverting newer text when an older encrypted local save completed while later input was still waiting in the debounce window.
- Fixed attachment Blob URL updates rebuilding the Live editor and discarding its active focus or selection while an image finished loading.

## [0.8.3] - 2026-07-29

### Added

- Added image insertion by drag-and-drop or clipboard paste in both Live and Source editing modes, while leaving ordinary text paste unchanged.
- Added a copy button to fenced code blocks in Reading mode and read-only history previews, with hover reveal, touch and keyboard access, and localized copy feedback.

### Fixed

- Added between-row drop feedback to A-Z, creation-time, and modification-time sorting so moving notes or folders out of nested directories has a clear destination indicator without overriding the selected sort order.
- Fixed dragged images failing to insert in Source mode after local attachment encryption completed.

## [0.8.2] - 2026-07-29

### Added

- Added offline cold-start access for remembered devices. Devices without a local PIN open their encrypted local vault directly; PIN-protected devices require the PIN, and non-remembered sessions remain unavailable offline.
- Added a versioned last-verified local session snapshot and foreground revalidation. Local-only sessions keep network features disabled until `/api/auth/me` confirms the same remembered endpoint, then resume synchronization in pull-before-push order.

### Fixed

- Fixed server or reverse-proxy unavailability sending remembered devices to the login page with a misleading registration-configuration error.
- Fixed offline logout and exhausted-PIN revocation requests being lost after local account data was removed; the endpoint revocation is now retained for the next online startup.

### Security

- Server authorization is never inferred from the cached identity snapshot. A confirmed `401`, a non-remembered endpoint, or an identity mismatch deletes local trust and locks the vault while retaining encrypted objects and pending synchronization data.

## [0.8.1] - 2026-07-28

### Fixed

- Fixed the empty editor toolbar shifting its mode switch and hiding note actions; Live, Source, Reading, note-lock, and image controls now keep the regular note layout while remaining disabled until a note is selected, and the redundant encryption description has been removed from the welcome state.

## [0.8.0] - 2026-07-28

### Added

- Added copy-result feedback and a downloadable plaintext backup to the one-time registration recovery-key screen, which now requires explicit confirmation that the key was stored before entering the vault.

### Changed

- Changed new-note editing so Enter in the title moves focus directly into the Markdown body; empty Live and Source editors show a presentation-only **Start writing…** hint that disappears as soon as the editor receives focus.
- Refined the note toolbar with a larger rounded title field aligned to the editor-mode control, and simplified the phone status bar to keep synchronization state and word and character counts readable without horizontal scrolling.
- Simplified the status bar to four user-facing synchronization states while retaining detailed local-save tooltips, distinguishing an explicitly offline browser from an unreachable server, and preventing local persistence failures from claiming that the latest change was saved.

### Fixed

- Fixed responsive workspace controls so notifications stay below the top toolbar, the pinned left directory can always be collapsed and reopened at intermediate widths, and phone drawers use the matching sidebar-close symbols.
- Fixed manual tree sorting lacking a clear between-row drop target and moving same-position single or multi-item drops; a connected mint insertion marker now distinguishes before/after placement from full-row folder drops.
- Fixed asynchronous local encryption allowing an older save of the same object to overwrite a newer edit in IndexedDB or its synchronization outbox.
- Fixed conflict, duplicate, and history-restored note copies reusing the source note's attachment ownership; copies now receive independent attachment IDs and keys, while incomplete attachment recovery keeps the local change pending for a safe retry instead of creating a broken copy.

## [0.7.0] - 2026-07-28

### Changed

- Changed the PIN lock screen to show the current account's display name as the primary heading and the localized **Notes locked** status beneath it, without retaining or displaying the encrypted profile avatar.
- Changed workspace restoration so the active note, editor mode, and collapsed sidebars are remembered independently in each browser or installed PWA instead of synchronizing across devices; newly signed-in devices start with an empty editor.
- Changed Live Callout headers so clicking the rendered title row reveals the complete editable marker with its `>` quote prefix, places the caret near the clicked title character, and keeps long marker lines usable without covering the body.
- Changed installed iOS and iPadOS layouts to extend application surfaces beneath the translucent system status area while keeping toolbars, drawers, settings, notifications, editor content, and bottom controls inside device safe areas.

### Fixed

- Fixed login and lock screens being clipped in short mobile landscape viewports instead of allowing the complete form to scroll.

## [0.6.0] - 2026-07-26

### Added

- Added lock and unlock actions to the contextual menu for a single note.

### Fixed

- Fixed lock-state changes altering a note's modification time and modification-time sorting.
- Kept the image attachment action visible but disabled while a note is locked, preserving the toolbar layout.

## [0.5.0] - 2026-07-26

### Added

- Added end-to-end encrypted note locking that synchronizes across devices, keeps locked notes in Reading mode without changing the workspace's selected editor mode, and shows lock badges in the directory and pinned-note lists.
- Added recursive trash protection for locked notes, including folders and multi-item selections containing a locked descendant, while explicit note copies remain unlocked.

### Fixed

- Fixed touch devices requiring a second tap to open a note or expand or collapse a folder in the mobile directory drawer.

## [0.4.0] - 2026-07-26

### Added

- Added inline `$...$` and display `$$...$$` KaTeX math rendering in Live and Reading modes, with editable source presentation in Live mode and canonical delimiters preserved in Markdown.
- Added local Mermaid rendering for `mermaid` fenced blocks in Live and Reading modes, with strict sanitization and editable source fallback.
- Added WikiLink navigation for note titles, vault-root paths, custom labels, and headings, including current-folder preference when duplicate note titles exist.
- Added optional Mint Notes Callout appearance attributes for predefined colors and icons.

### Changed

- Expanded Callouts to cover every built-in Obsidian type and alias, preserve alias-specific default titles, and render unknown custom types with a neutral style.
- Changed empty Callout editing so Backspace moves into the marker line; an incomplete marker degrades to an ordinary blockquote without deleting its content, while retyping `]` restores Callout rendering.

### Fixed

- Fixed Live Callout title editing so entering a space and custom title after the closing `]` remains visible and renders immediately.
- Fixed an acknowledged encrypted revision uploaded by the current browser being reported as an update from another device when synchronization encountered it again.
- Fixed repeated PWA update prompts by fingerprinting the deployed Service Worker, suppressing duplicate prompts for the same version for 24 hours, and still prompting immediately for a genuinely different version.

## [0.3.0] - 2026-07-26

### Added

- Added inward edge-swipe gestures on phone-sized screens to open the directory drawer from the left or the Outline/History drawer from the right.

### Changed

- Changed PIN-protected vaults so an ordinary refresh of an unlocked tab can remain unlocked through a tab-scoped encrypted refresh envelope, while application launches, manual locks, inactivity locks, expired intervals, and invalid sessions still require the PIN.
- Reorganized administrator account controls under **User management**, separating new-user activation from existing-account actions.

### Fixed

- Removed the off-screen drawer shadows that remained visible along both sides of the mobile editor.

## [0.2.1] - 2026-07-25

### Changed

- Changed PIN-protected vaults to require the local PIN after every refresh or new Crypto Worker instead of reusing browser-session authorization.
- Added an automatic safe upgrade for legacy local PIN credentials after the next successful PIN unlock.

### Security

- Fixed a local lock-screen bypass where refreshing a manually or automatically locked PWA could restore the vault without requesting the PIN.
- Replaced verifier-only local PIN protection with an Argon2id-derived AES-GCM envelope around the device-wrapped vault credential, with user and endpoint binding, wrong-PIN rejection, and tamper detection.

## [0.2.0] - 2026-07-25

### Added

- Added Obsidian-compatible Callouts across Live, Reading, and historical previews, including common aliases, custom titles, nested Callouts, neutral styling for unknown types, and collapsible `+`/`-` markers.
- Added an editable YAML frontmatter properties panel in Live mode and a read-only panel in Reading mode and historical previews, with safe fallbacks for invalid or complex YAML.

### Changed

- Changed line-leading `>` input to remain visible until Enter confirms the line, then continue editing on an empty quoted line.
- Changed Live mode to preserve user-authored Markdown escapes across reloads while never inserting backslash escapes automatically.

### Fixed

- Fixed Callout frames not resizing immediately when body lines were added or removed.
- Fixed empty Callout body deletion losing the caret, corrupting the marker, or preventing undo after the whole block was removed.
- Fixed private highlight/backtick markers and generated backslash escapes leaking into canonical Markdown.

## [0.1.0] - 2026-07-24

### Added

- Added local-first Markdown editing with durable browser saves, background synchronization, and browser-side end-to-end encryption.
- Added responsive note organization with folders, search, sorting, trash, live/source/reading modes, and a generated outline.
- Added multi-user accounts, recovery keys, trusted devices, administrator activation codes, and conflict-safe cross-device synchronization.
- Added encrypted note history, image attachments, and folder-preserving Markdown/ZIP import and export.
- Added installable multilingual PWA layouts for desktop, tablet, and mobile use.
- Added single-service Docker deployment with SQLite storage, health checks, and consistent online backups.
