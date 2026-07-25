# Changelog

All notable changes to Mint Notes are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
