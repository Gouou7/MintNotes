# Changelog

All notable changes to Mint Notes are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
