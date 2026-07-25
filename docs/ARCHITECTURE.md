# Architecture

[Documentation index](README.md)

## Goals

Mint Notes optimizes for a small deployment footprint, responsive editing under high latency, ciphertext-only server storage, multi-user isolation, and recoverable user mistakes.

## Runtime topology

```text
Browser / installed PWA
  - React responsive shell
  - typora-web editor adapter
  - crypto worker
  - encrypted IndexedDB
  - durable synchronization outbox
              |
              | HTTPS, opaque encrypted objects
              v
Single Node.js service
  - static PWA delivery
  - account and session API
  - batched delta API + user-scoped synchronization hints
  - SQLite transactions, synchronization revisions, and independent encrypted note history
              |
              v
Persistent SQLite volume mounted at /data + independent backups
```

No Redis, object store, search server, or background worker service is required. Encrypted attachment chunks live in SQLite so the online backup remains a single consistent artifact.

## Responsive application shell

Desktop uses three panes:

1. A folder/note tree with search, sorting, trash, contextual actions, and settings access.
2. The active note in live-rendered edit, Markdown source, or read-only rendered mode.
3. A right tool panel containing the live H1-H6 outline and encrypted history for the active document.

Tablet collapses the right tool panel into a drawer. Mobile renders the editor as the primary route and exposes the tree and Outline/History panel as left/right drawers. Plaintext outline and historical preview data are derived or decrypted in memory and are not synchronized as plaintext.

## Local-first write path

```text
editor change
  -> immediate in-memory document update
  -> 500 ms idle debounce, with a 5 second durability deadline
  -> encrypt in browser worker
  -> atomic IndexedDB object + outbox transaction
  -> show "saved locally"
  -> 2 second upload debounce, with a 15 second batching deadline
  -> batched conditional upload
  -> show "synced" after acknowledgement
```

Network latency is outside the input and local-save path. Page visibility changes, note switches, and ordinary lock operations request an immediate local flush. Confirmed logout is the deliberate destructive exception: it stops new local writes and synchronization, cancels pending save timers without flushing them, and deletes the current user's encrypted cache and outboxes.

Remote pulls do not replace a document while its current plaintext change is still waiting for the local encryption debounce. The later conditional push either commits that locally saved version or follows the normal conflict-copy path if another device changed the server revision.

After acknowledgement, the server is the durable cross-device copy. The browser store is the low-latency write buffer, offline retry source, and working cache; it is not intended to survive an explicit logout.

After a successful password or recovery-key unlock, the browser creates a non-exportable AES-GCM device key in IndexedDB and stores a user- and endpoint-bound wrapped vault credential beside it. `/api/auth/me` must verify the HttpOnly session and matching trusted endpoint before local restoration. Without a local PIN, refreshes retain a per-tab `sessionStorage` grant; another open authorized tab may grant a new tab through `BroadcastChannel`. Remembered endpoints use a persistent rolling session, while ordinary sessions use a session cookie.

Configuring a PIN replaces the directly device-wrapped credential with a two-layer envelope: the vault key is first wrapped by the non-exportable device key, then that inner envelope is encrypted by an Argon2id-derived, domain-separated PIN key bound to the user and endpoint. IndexedDB retains only the outer PIN ciphertext, salt, KDF version, non-exportable device key, failure count, and local settings. The PIN key and decrypted inner envelope exist only during unlock. A new Worker, including one created by refresh, cannot restore a PIN-protected vault from a session or cross-tab grant and must derive the PIN key again. Legacy version-two PIN-verifier credentials are never auto-restored and migrate to the two-layer envelope after their next successful PIN unlock.

Locking clears decrypted memory but retains the PIN-encrypted local credential and authenticated endpoint. Confirmed logout broadcasts to other same-origin tabs and deletes every current-user IndexedDB record plus the tab authorization grant; invalid-session handling and five failed PIN attempts delete local trust without discarding the encrypted content cache. Cold offline restart remains unsupported.

## Synchronization model

- Each server object is addressed by a random object ID scoped to a user.
- Each accepted mutation increments the object's revision and appends a user-scoped change sequence.
- Clients pull changes after a durable cursor and push with `baseRevision` plus an idempotency key.
- One in-browser coordinator coalesces pull and push reasons and serializes network work. Local edits request only an outbox push; startup, reconnect, and visibility recovery pull before pushing.
- While an unlocked page is visible, one authenticated same-origin SSE connection carries only a latest-cursor hint. The hint wakes the delta pull but is not itself a correctness boundary. A five-minute cursor check remains active while SSE is healthy; unavailable SSE falls back to 60/120/300-second foreground checks.
- Object outbox entries are packed into requests of at most 50 objects and 1.5 MiB. Oversized individual envelopes use the compatible single-object route. Attachment chunks still upload before their manifest and owning note.
- Pull pages scan up to 500 change-log entries and may compact repeated revisions of one object within the page. IndexedDB applies each page with bulk operations, while React receives one indexed merge after the complete pull.
- A stale `baseRevision` produces a conflict response. The client preserves both versions rather than selecting a winner by timestamp.
- Document conflicts become a new local object named with the `（冲突副本）` suffix. Attachment-manifest conflicts preserve the server manifest and leave local encrypted chunks intact for diagnosis.
- The workspace control record is replaceable UI state rather than user content. Remote workspace state restores during startup but never changes an already open note, editor mode, or sidebar during a live session. A concurrent revision is rebased without creating a visible conflict note.
- A remote update or deletion of the actively edited note is committed as ciphertext locally but deferred in the visible editor. Pending local content becomes a conflict copy whose editor session remains mounted; a clean remote version becomes visible after the user leaves the note.
- Deletions are tombstones. The server evaluates each account's non-sensitive retention setting hourly and purges expired opaque objects; `NULL` means permanent retention. Immediate user-requested purge requires an authenticated session and an explicit client-side confirmation.
- Synchronization runs after durable local changes, at startup, on reconnect, when the page becomes visible, from SSE hints, and through the low-frequency safety check. Hidden and locked pages do not poll or reconnect.
- Local startup decrypts objects independently and publishes every readable document before network synchronization. A failed object remains encrypted in IndexedDB, including any durable outbox entry, rather than aborting the entire vault load. Dismissing repeated notification for an exact failed revision stores only an object/revision/nonce fingerprint in local metadata; it does not remove the encrypted object, and a changed fingerprint is reported again.
- Pulled ciphertext is authenticated and decrypted before it replaces the last known-good local object. Failed remote objects are isolated while later revisions may repair them. When the local store is empty or safely repairable, the client resets its cursor and performs a full pull; it creates the initial welcome note only after that pull verifies an empty account.
- Device clocks are display metadata only and never determine conflict winners.

## Data storage

### Browser

IndexedDB database `webmd-notes-v2` stores encrypted objects, encrypted attachment chunks, encrypted history snapshots, server revisions, a per-user synchronization cursor, per-user device-local UI preferences, durable object/chunk/history outboxes, and an optional endpoint-bound device credential. Dexie v5 adds `historySnapshots` and `historyOutbox` without renaming the compatibility database. History follows the same local-first boundary: the current note is durable first, then the browser encrypts the snapshot and atomically records it with its retry entry; network failure never blocks editing. A reserved encrypted workspace control object stores a versioned active/open-note list, the active editor mode, and the collapsed state of both sidebars. It uses the existing schema-v2 note-object transport for compatibility, is excluded from the visible note tree and portable exports, and follows the same local-first object/outbox flow. The current format stores one open note while leaving the list field available for a future tab interface. Version-one records created before editor-mode synchronization remain compatible and default to Live mode. Sidebar widths, selected right-panel tab, language, theme, font size, sorting, search text, and folder expansion remain device-local UI state. The non-sensitive language preference is also mirrored to Local Storage so browser-language following and the selected login-page language work before a user unlocks a vault; it is never synchronized to the server. The device credential contains the non-exportable `CryptoKey`, remembered/session mode, failure count, auto-lock preference, and either a direct device envelope when no PIN exists or a PIN-encrypted outer envelope, salt, and KDF version when one does. A pending endpoint-revocation record survives offline PIN-exhaustion handling. Confirmed logout atomically removes the current user's objects, object and attachment outboxes, attachment chunks, history snapshots/outbox, cursor, preferences, ignored-integrity fingerprints, credential, and pending revocations without touching another user's rows. The shared pre-login language preference and PWA shell cache are not account data and remain. Unlocked documents, decrypted history previews, decrypted workspace state, avatar Blob URLs, attachment keys, attachment Blob URLs, PIN-derived keys, and search indexes remain in memory.

### Server

SQLite schema v2 additively stores per-account history settings, opaque encrypted `note_history`, and note/account clear markers alongside users, hashed authentication material, trusted endpoints, sessions, trash retention, encrypted profile avatars, encrypted objects, synchronization revisions, attachment chunks, purge events, activation records, and the change log. `object_revisions` remains independent and is never user-deleted because it is required for incremental synchronization. History cleanup runs hourly and before settings/quota operations: automatic snapshots remain dense for 24 hours, then one per UTC hour through day 7 and one per UTC day afterward; all snapshots follow account retention. Profile, history, object, revision, change, attachment, retention, and purge queries use the authenticated session's `user_id`.

## Attachments

Each attachment has a random UUID and an independently generated AES key stored only inside its vault-key-encrypted manifest. The browser validates supported image signatures, encrypts 1 MiB chunks with unique nonces, commits them to IndexedDB, and then inserts a `webmd-attachment:<uuid>` Markdown reference. Synchronization uploads chunks before the manifest and note revision. Other devices fetch ciphertext chunks lazily and create short-lived Blob URLs only after authenticated decryption and a full SHA-256 check.

Attachment ownership is one note to many attachments. Duplicating a note creates new attachment UUIDs and keys. Moving a note to trash tombstones its manifests without deleting chunks; confirmed manual purge or expiry under the account retention policy removes manifest history and chunks.

## Import and export

Import parsing occurs in the browser. Markdown and ZIP inputs have no application-level archive, entry, or expanded-total size cap; available browser memory and storage provide the practical boundary. Entries are path-normalized, converted into application objects, encrypted, and committed locally before synchronization. ZIP input rejects more than 4,000 files, duplicate case-folded paths, and traversal outside the archive root. Referenced images are converted into attachments only when they satisfy the separate client attachment format and 25 MiB per-image limit.

Plaintext Markdown exports are built entirely in the browser. ZIP exports retain folders and empty directories, place images under `_attachments/<uuid>.<ext>`, and rewrite note links to portable relative paths. Export aborts rather than silently omit an attachment that cannot be recovered locally or from the server.
