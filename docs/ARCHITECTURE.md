# Architecture

[Documentation index](README.md)

## Goals

Mint Notes optimizes for a small deployment footprint, responsive editing under high latency, ciphertext-only server storage, multi-user isolation, and recoverable user mistakes.

## Runtime topology

```text
Browser / installed PWA
  - React responsive shell
  - in-repository ProseMirror editor core with injected Callout and Math/Mermaid/WikiLink extensions
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
2. The active note in live-rendered edit, Markdown source, or read-only rendered mode, with an encrypted client-side note-lock toggle.
3. A right tool panel containing the live H1-H6 outline and encrypted history for the active document.

Tablet collapses the right tool panel into a drawer. Mobile renders the editor as the primary route and exposes the tree and Outline/History panel as left/right drawers. Plaintext outline and historical preview data are derived or decrypted in memory and are not synchronized as plaintext.

## Local-first write path

```text
editor change
  -> immediate in-memory document update
  -> 500 ms idle debounce, with a 5 second durability deadline
  -> enqueue in the per-user, per-object persistence lane
  -> encrypt in browser worker
  -> atomic IndexedDB object + outbox transaction
  -> show "syncing" while the durable outbox awaits acknowledgement
  -> 2 second upload debounce, with a 15 second batching deadline
  -> batched conditional upload
  -> show "synced" after acknowledgement
```

Network latency is outside the input and local-save path. The status bar keeps its previous main synchronization state while encryption and the atomic local write are in progress; its tooltip exposes that local-save phase. After the encrypted object and durable outbox entry commit, the main state becomes `syncing`. A browser-reported offline condition is distinct from an online request failure: both retain durable local changes, but the former is shown as `offline` and the latter as `error`. A local encryption or IndexedDB failure is not classified as a synchronization error and triggers a persistent critical warning without claiming local durability. Encryption and IndexedDB commits for one object are serialized even when an earlier Worker request finishes after a newer edit was queued; unrelated objects may still persist concurrently. Completion checks prevent an older durable write from replacing newer in-memory state, including edits that are still inside the debounce window and have not entered the persistence lane yet. A flush waits for both the debounce timer and any in-flight write for that object. Page visibility changes, note switches, and ordinary lock operations request an immediate local flush. Confirmed logout is the deliberate destructive exception: it stops new local writes and synchronization, waits for in-flight local transactions, cancels pending save timers without flushing them, and then deletes the current user's encrypted cache and outboxes.

Remote pulls do not replace a document while its current plaintext change is still waiting for the local encryption debounce. The later conditional push either commits that locally saved version or follows the normal conflict-copy path if another device changed the server revision.

The note lock is a boolean inside the encrypted schema-v2 document payload. Toggling it from the editor toolbar or a single note's contextual menu flushes pending title and editor changes through the same local-first object/outbox path. The lock-only revision preserves the document payload's existing `updatedAt`, so lock metadata synchronization does not alter the user-visible modification time or modification-time sorting. A locked note derives an effective read-only editor mode without changing the device-local workspace preference's remembered editor mode. Missing lock fields from older schema-v2 ciphertext normalize to `false`; no IndexedDB or server migration is required.

After acknowledgement, the server is the durable cross-device copy. The browser store is the low-latency write buffer, offline retry source, and working cache; it is not intended to survive an explicit logout.

After a successful password or recovery-key unlock, the browser creates a non-exportable AES-GCM device key in IndexedDB and stores a user- and endpoint-bound wrapped vault credential beside it. The credential optionally includes a versioned snapshot of the most recently server-verified `User`, remembered `AuthEndpoint`, and verification time. The snapshot is eligible for offline restoration only when the credential mode and endpoint are both remembered and both IDs match the credential. It grants local routing and display context, never server authorization. Online startup verifies `/api/auth/me` first; only a timeout or transport/server failure may fall back to that snapshot, while a `401` is authoritative. A non-remembered session still requires the per-tab `sessionStorage` grant or another authorized tab's `BroadcastChannel` grant and cannot cold-start offline. Remembered endpoints use a persistent rolling session, while ordinary sessions use a session cookie.

Configuring a PIN replaces the persistent directly device-wrapped credential with a two-layer envelope: the vault key is first wrapped by the non-exportable device key, then that inner envelope is encrypted by an Argon2id-derived, domain-separated PIN key bound to the user and endpoint. IndexedDB retains only the outer PIN ciphertext, salt, KDF version, non-exportable device key, failure count, and local settings. The PIN key and decrypted inner envelope exist only during unlock. While the vault remains unlocked, the current tab keeps a separate directly device-wrapped refresh envelope and last-activity timestamp in `sessionStorage`; a navigation explicitly reported as a reload may use it after `/api/auth/me` verifies the session and endpoint and the configured inactivity interval has not elapsed. Manual or inactivity locking clears this short-lived envelope before erasing memory. A non-reload launch rejects and clears it, and cross-tab session grants never carry it. Legacy version-two PIN-verifier credentials are never auto-restored and migrate to the two-layer envelope after their next successful PIN unlock.

Locking clears decrypted memory and the tab's refresh envelope but retains the PIN-encrypted local credential and remembered endpoint snapshot. On an eligible offline cold start, a direct credential unlocks automatically; a PIN credential establishes only the lock-screen session and cannot use the refresh envelope or a cross-tab grant to bypass PIN entry. Local restoration sets `serverSessionVerified` to false. Until `/api/auth/me` revalidates the same remembered user and endpoint, synchronization, SSE, remote attachment reads, and account, device, administrator, history-policy, and retention requests remain disabled. The vault loads local ciphertext first, skips its initial pull, and never interprets an unverified empty cache as a new account requiring a welcome note. Revalidation runs on reconnect, foreground visibility, and a 30-second visible-page interval with concurrent attempts deduplicated; success starts pull-before-push synchronization and SSE.

Confirmed logout broadcasts to other same-origin tabs and deletes every current-user IndexedDB record plus the tab authorization grant. If server logout fails, it then recreates a browser-local pending endpoint revocation for the next online startup. Invalid-session handling, an endpoint no longer marked remembered, an identity mismatch, credential corruption, and five failed PIN attempts delete local trust without discarding the encrypted content cache and outboxes. Remote revocation is therefore delayed while a device remains offline. Browser restart detection is best effort because browsers may restore tabs and session state, but only a Navigation Timing `reload` is eligible for PIN refresh restoration after online verification; ordinary PIN-protected launches require the PIN.

## Synchronization model

- Each server object is addressed by a random object ID scoped to a user.
- Each accepted mutation increments the object's revision and appends a user-scoped change sequence.
- Clients pull changes after a durable cursor and push with `baseRevision` plus an idempotency key.
- One in-browser coordinator coalesces pull and push reasons and serializes network work. Local edits request only an outbox push; startup, reconnect, and visibility recovery pull before pushing.
- While an unlocked page is visible, one authenticated same-origin SSE connection carries only a latest-cursor hint. The hint wakes the delta pull but is not itself a correctness boundary. A five-minute cursor check remains active while SSE is healthy; unavailable SSE falls back to 60/120/300-second foreground checks.
- Object outbox entries are packed into requests of at most 50 objects and 1.5 MiB. Oversized individual envelopes use the compatible single-object route. Attachment chunks still upload before their manifest and owning note.
- Pull pages scan up to 500 change-log entries and may compact repeated revisions of one object within the page. IndexedDB applies each page with bulk operations, while React receives one indexed merge after the complete pull.
- Source-client SSE suppression means a client can later encounter its own accepted change during a cursor check. An exact match of object type, revision, ciphertext, nonce, encryption version, and deletion state advances the cursor silently; only a different encrypted version is treated as a remote update.
- A stale `baseRevision` produces a conflict response. The client preserves both versions rather than selecting a winner by timestamp.
- Document conflicts become a new local object named with the `（冲突副本）` suffix. Before the remote version replaces the source, every attachment referenced by either encrypted document metadata or Markdown is recovered and copied to a new UUID, key, and target-note ownership. If the complete attachment graph cannot be recovered, the original pending object and synchronization cursor are retained for retry rather than creating an incomplete conflict copy. Attachment-manifest conflicts preserve the server manifest and leave local encrypted chunks intact for diagnosis.
- Explicit note and history copies start unlocked; conflict copies preserve the local source's lock state.
- Active/open note IDs, editor mode, and sidebar state are device-local preferences and never enter the object outbox. Updated clients ignore the reserved legacy workspace object during pulls and discard any local pending legacy write; a pre-upgrade device may migrate only the legacy record already present before its first network pull.
- A remote update, lock-state change, or deletion of the actively edited note is committed as ciphertext locally but deferred in the visible editor. Pending local content becomes a conflict copy whose editor session remains mounted; a clean remote version becomes visible after the user leaves the note.
- Deletions are tombstones. The server evaluates each account's non-sensitive retention setting hourly and purges expired opaque objects; `NULL` means permanent retention. Immediate user-requested purge requires an authenticated session and an explicit client-side confirmation.
- Synchronization runs after durable local changes, at verified startup, after a locally restored session is revalidated, on reconnect, when the page becomes visible, from SSE hints, and through the low-frequency safety check. Hidden, locked, and locally unlocked but server-unverified pages do not synchronize, poll object APIs, or open SSE.
- Local startup decrypts objects independently and publishes every readable document before network synchronization. A failed object remains encrypted in IndexedDB, including any durable outbox entry, rather than aborting the entire vault load. Dismissing repeated notification for an exact failed revision stores only an object/revision/nonce fingerprint in local metadata; it does not remove the encrypted object, and a changed fingerprint is reported again.
- Pulled ciphertext is authenticated and decrypted before it replaces the last known-good local object. Failed remote objects are isolated while later revisions may repair them. When the local store is empty or safely repairable, the client resets its cursor and performs a full pull; it creates the initial welcome note only after that pull verifies an empty account.
- Device clocks are display metadata only and never determine conflict winners.

The generated Service Worker is updated only when its precache script changes. When a waiting worker is detected, the browser fingerprints the currently deployed `sw.js` before prompting. Duplicate lifecycle callbacks and reopen/refresh cycles for the same fingerprint are suppressed for 24 hours; a different fingerprint prompts immediately. Confirming activates the waiting worker and reloads the application through the existing update path.

## Data storage

### Browser

IndexedDB database `webmd-notes-v2` stores encrypted objects, encrypted attachment chunks, encrypted history snapshots, server revisions, a per-user synchronization cursor, per-user device-local UI preferences, durable object/chunk/history outboxes, and an optional endpoint-bound device credential. Note lock state remains inside each encrypted document object and is never indexed separately. Dexie v5 adds `historySnapshots` and `historyOutbox` without renaming the compatibility database; the optional verified-session snapshot is an additive value field and needs no Dexie schema upgrade. History follows the same local-first boundary: the current note is durable first, then the browser encrypts the snapshot and atomically records it with its retry entry; network failure never blocks editing. The versioned device-local preferences include the active/open-note list, editor mode, collapsed state and widths of both sidebars, selected right-panel tab, language, theme, font size, and sorting. A browser profile with no local workspace preference starts with an empty editor even after it downloads existing notes; the initial welcome note for an empty account is created without opening it and only after a verified pull confirms emptiness. The reserved encrypted workspace control object is a legacy compatibility record: an upgraded device may migrate a locally cached version once, then deletes its local object and outbox entry, while records received from the server are ignored without being decrypted or persisted. Existing opaque server records are not automatically purged, so older clients can coexist during a rolling upgrade. The non-sensitive language preference is also mirrored to Local Storage so browser-language following and the selected login-page language work before a user unlocks a vault; it is never synchronized to the server. The device credential contains the non-exportable `CryptoKey`, remembered/session mode, failure count, auto-lock preference, optional last-verified identity snapshot, and either a direct device envelope when no PIN exists or a PIN-encrypted outer envelope, salt, and KDF version when one does. A PIN-unlocked tab may additionally hold a directly device-wrapped refresh envelope in `sessionStorage`; it is not copied to IndexedDB or granted to another tab. A pending endpoint-revocation record survives offline PIN-exhaustion or logout handling. Confirmed logout atomically removes the current user's objects, object and attachment outboxes, attachment chunks, history snapshots/outbox, cursor, preferences, ignored-integrity fingerprints, credential, and prior pending revocations without touching another user's rows; if the server request then fails, a new pending revocation record is written. The shared pre-login language preference and PWA shell cache are not account data and remain. Unlocked documents, decrypted history previews, avatar Blob URLs, attachment keys, attachment Blob URLs, PIN-derived keys, and search indexes remain in memory.

### Server

SQLite schema v2 additively stores per-account history settings, opaque encrypted `note_history`, and note/account clear markers alongside users, hashed authentication material, trusted endpoints, sessions, trash retention, encrypted profile avatars, encrypted objects, synchronization revisions, attachment chunks, purge events, activation records, and the change log. `object_revisions` remains independent and is never user-deleted because it is required for incremental synchronization. History cleanup runs hourly and before settings/quota operations: automatic snapshots remain dense for 24 hours, then one per UTC hour through day 7 and one per UTC day afterward; all snapshots follow account retention. Profile, history, object, revision, change, attachment, retention, and purge queries use the authenticated session's `user_id`.

## Attachments

Each attachment has a random UUID and an independently generated AES key stored only inside its vault-key-encrypted manifest. The browser validates supported image signatures, encrypts 1 MiB chunks with unique nonces, commits them to IndexedDB, and then inserts a `webmd-attachment:<uuid>` Markdown reference. Synchronization uploads chunks before the manifest and note revision. Other devices fetch ciphertext chunks lazily and create short-lived Blob URLs only after authenticated decryption and a full SHA-256 check.

Attachment ownership is one note to many attachments. Duplicating a note creates new attachment UUIDs and keys. Moving a note to trash tombstones its manifests without deleting chunks; confirmed manual purge or expiry under the account retention policy removes manifest history and chunks.

The browser entrypoint routes session state only. Session restoration and cross-tab trust live in the session controller; the unlocked vault composes dedicated in-memory model, object-persistence, attachment-copy, tree-view, synchronization, history, and lifecycle responsibilities. On the server, `index.ts` starts the process and `app.ts` composes dependencies. Session authentication, object storage, attachment/admin routes, maintenance, history/trash policy, and synchronization events remain independently owned modules. These boundaries do not change the wire protocol or the browser/server plaintext boundary.

## Import and export

Import parsing occurs in the browser. Markdown and ZIP inputs have no application-level archive, entry, or expanded-total size cap; available browser memory and storage provide the practical boundary. Entries are path-normalized, converted into application objects, encrypted, and committed locally before synchronization. ZIP input rejects more than 4,000 files, duplicate case-folded paths, and traversal outside the archive root. Referenced images are converted into attachments only when they satisfy the separate client attachment format and 25 MiB per-image limit.

Plaintext Markdown exports are built entirely in the browser. ZIP exports retain folders and empty directories, place images under `_attachments/<uuid>.<ext>`, and rewrite note links to portable relative paths. Export aborts rather than silently omit an attachment that cannot be recovered locally or from the server.

## Markdown presentation

Math, Mermaid, WikiLink, and Callout appearance rendering is browser-only presentation over canonical Markdown. The ProseMirror/Markdown core owns canonical parsing, serialization, authored-escape presentation, input transactions, and a generic extension contract. Sibling modules under `src/editor/extensions/` inject Callout plugins/commands and cursor-aware Math/Mermaid/WikiLink decorations; the core never imports them. React uses the stable controller and typed extension helpers, so its private ProseMirror view does not cross the editor boundary. Multiline display math temporarily uses a reserved `mint-math` fenced block only inside the mounted Live editor and is converted back before `onChange` reaches application state, encryption, IndexedDB, history, synchronization, or export. Reading mode parses the canonical syntax directly.

Mermaid is loaded lazily, runs with strict security settings, and produces a sanitized SVG displayed through a short-lived Blob URL; no diagram source or rendering output is sent to the server. WikiLink lookup uses only the decrypted in-memory document tree and routes to an existing note or heading without a server-side plaintext lookup. Callout colors and icons are derived from their canonical marker text, including the optional Mint Notes `{color=... icon=...}` title suffix; incomplete markers remain ordinary portable blockquotes.
