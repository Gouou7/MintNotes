# Security model

[Documentation index](README.md)

## Protected assets

The application is designed to keep note titles, Markdown, tags, custom history names, note lock state, folder names, folder structure, derived outlines, active/open note identifiers, active editor mode, sidebar visibility state, attachment names, MIME types, attachment keys, and attachment bytes confidential from the server at rest.

The server necessarily observes usernames, display names, roles, account status, a random vault-envelope context and its version, trash/history-retention preferences, history capture frequency and enablement, whether encrypted avatar, legacy workspace, or history records exist, random note/history IDs, history capture times and capture kinds, the history protection bit, protected-history relationships to random attachment UUIDs, avatar/legacy-workspace/history ciphertext sizes and update times, random user/content/session/endpoint IDs, an ephemeral random synchronization-client ID, the reserved legacy workspace object ID, ciphertext sizes, object counts, revisions, synchronization times, browser/device summaries, IP addresses, login counts and activity times, remembered status, and access patterns. These protected attachment references deliberately reveal random-ID relationships so server cleanup can preserve ciphertext without learning attachment names, MIME types, bytes, keys, or the custom history name. SSE notifications expose only a user-scoped change cursor to the authenticated browser and do not carry object IDs or ciphertext. Current clients do not send active/open note identifiers, editor mode, or sidebar state to the server; these fields remain in per-user device-local preferences. Opaque legacy workspace records may remain on the server during rolling upgrades but are ignored by current clients. The server also does not receive historical titles, Markdown, tags, custom history names, note lock state, attachment names or bytes, the avatar image, or avatar MIME type in plaintext. Users can view their own trusted-endpoint and encrypted note-history metadata; administrators can view account identity, status, object count, and aggregate ciphertext storage usage.

## Threats covered by the design

- Theft of the SQLite database or an application backup.
- Direct inspection of stored data by an operator.
- Ciphertext corruption or rebinding to another user/object/revision.
- Cross-account API access using a guessed object ID.
- Accidental overwrite, deletion, interrupted uploads, and ordinary network failure.

## Threats outside the browser-only E2EE boundary

- An actively compromised server can replace the JavaScript application and capture a password or unlocked key.
- Malware, a hostile browser extension, or physical access to an unlocked device can read plaintext.
- Note locking prevents accidental client-side edits and trash operations; it is not authentication, server authorization, or protection against a malicious or outdated client.
- History protection is a retention guard against normal deletion and cleanup paths, not protection from account deletion, deleting a deployment volume, restoring an older backup, or a malicious administrator/client.
- Malware or hostile same-origin JavaScript can use a directly wrapped device credential while its browser profile remains trusted. With a local PIN configured, it can attempt PIN guesses against the stored authenticated ciphertext or use the current unlocked tab's short-lived refresh envelope; a short PIN is not a defense against an attacker who controls the origin or browser profile.
- A user-created plaintext export is outside the encrypted storage boundary.
- Traffic metadata and ciphertext sizes are not hidden.

The UI and documentation must not claim protection against these cases.

## Key hierarchy

The intended key hierarchy is:

```text
master password + per-user salt
  -> Argon2id root key
      -> domain-separated authentication secret
      -> domain-separated vault wrapping key

random vault key
  -> encrypted by vault wrapping key for normal unlock
  -> encrypted by an independent recovery key for recovery
  -> optionally encrypted by a non-exportable browser device key for online refresh recovery
      -> when a PIN exists, the device envelope is encrypted again by an Argon2id-derived PIN wrapping key
  -> encrypts user objects with Web Crypto AES-256-GCM and random nonces
  -> encrypts attachment manifests containing independent random attachment keys

random attachment key
  -> encrypts immutable 1 MiB attachment chunks with per-chunk nonces
```

The server receives an authentication secret but never receives the password, root key, wrapping key, recovery key, device key, device-wrapped vault credential, or plaintext vault key. The server stores a slow hash of the authentication secret.

Vault-key envelope AAD is versioned. Legacy accounts use their normalized username in the v1 AAD until they change that username. New accounts use an independent random v2 envelope context. A username change always requires the current authentication secret. To retain the recovery key, it also requires the current recovery authentication secret; the unlocked browser rewraps both envelopes under v2 AAD without changing either verifier. If the recovery key is unavailable, the browser may instead generate and display a replacement after online master-password reauthentication. Only after the user confirms that replacement is stored does the server atomically change the username, context, both ciphertexts, and recovery verifier; abandoning the dialog does not invalidate the old key. Other sessions and endpoints are revoked so a stale client cannot continue with the previous account identity. Note, history, attachment, and device-unlock encryption stays bound to the immutable user ID and is not rewritten.

The device-unlock key is a non-exportable AES-256-GCM `CryptoKey` stored by the browser in IndexedDB. The inner device ciphertext is authenticated with the user ID. A remembered credential may also hold a versioned last-server-verified user and endpoint snapshot whose IDs must match the credential and whose endpoint must still be marked remembered. This cached identity exists only to route and label local restoration; it cannot authorize a server request. Without a PIN, eligible remembered devices use the stored key to unlock during offline cold startup. This is a convenience boundary rather than hardware-backed authentication: anyone controlling the trusted browser profile or malicious same-origin code can ask the stored key to decrypt.

When a PIN is configured, the browser derives a separate wrapping key with Argon2id and HMAC domain separation, then AES-GCM encrypts the complete inner device envelope with AAD binding it to the user, endpoint, and PIN-envelope version. IndexedDB does not retain directly device-decryptable PIN-protected ciphertext. An eligible offline cold start may route to the PIN lock screen from the cached verified identity, but neither the tab refresh envelope nor a cross-tab session grant may unlock it; only the correct local PIN can. After a successful PIN or master-password unlock, the current tab may keep a second device-wrapped vault envelope and last-activity timestamp in `sessionStorage`; it contains no plaintext vault key or PIN-derived key and is accepted only after server-session verification on a navigation reported as `reload` before the configured inactivity interval expires. Manual lock, inactivity lock, logout, invalid-session handling, and non-reload startup clear or reject that envelope. This preserves an unlocked state across an ordinary verified refresh while requiring PIN entry on ordinary application startup. Browser session restoration is implementation-dependent, so restart detection remains best effort. AES-GCM authentication replaces the former standalone verifier for new credentials. Legacy verifier records are blocked from automatic restoration and upgrade only after the entered PIN is verified.

The PIN envelope improves the application lock boundary but does not turn a short PIN into a high-entropy secret. Anyone able to copy or repeatedly operate on browser storage can attempt guesses offline, and client-side failure counters can be rolled back. Five failed attempts delete local trust and request endpoint revocation as an online damage-control measure, not as a cryptographic brute-force guarantee. Locally restored trust has no additional expiry. A confirmed `401`, endpoint mode downgrade, identity mismatch, or damaged credential deletes local trust and locks the vault; encrypted objects and pending outboxes remain so the same account can recover them after signing in. Confirmed logout additionally deletes all current-user encrypted objects, attachment chunks, outboxes, cursors, and preferences from the browser. If its server request fails, only the pending endpoint-revocation record is recreated.

The browser derives a 32-byte Argon2id root through the bundled `hash-wasm` implementation. The current KDF profile uses three iterations, 64 MiB of memory, and one lane; its parameters and random salt are stored per account so a future profile can be versioned. Purpose-specific keys are then derived with Web Crypto HMAC-SHA-256. A cross-worker integration test verifies that registration, normal unlock, recovery unlock, and encrypted document round-trips remain stable across fresh Worker instances.

Every encrypted object uses a fresh 96-bit nonce and authenticates the user ID, object ID, object type, encryption version, and intended revision as AES-GCM additional data.

Every note-history snapshot also uses a fresh 96-bit nonce in a separate AAD domain. It authenticates the user ID, note ID, history ID, capture time, capture kind, history schema, and encryption version. The encrypted payload contains the title, Markdown, tags, attachment IDs, and source update time. Rebinding any server-visible history field causes decryption to fail.

History metadata uses a second fresh 96-bit nonce and a distinct AAD domain binding the user ID, note ID, history ID, capture time, metadata schema, and encryption version. Its payload contains the optional custom name and complete attachment-ID set. This allows rename and protection changes without re-encrypting the full snapshot. Cross-user, cross-note, cross-history, cross-time rebinding and ciphertext tampering fail authentication.

Every attachment chunk uses a fresh 96-bit nonce and authenticates the user ID, attachment UUID, chunk index, total chunk count, and encryption version. A plaintext SHA-256 digest is kept only inside encrypted metadata and is checked after reassembly. SVG is not rendered; supported raster formats are detected from file signatures rather than filename extensions.

## Web security

- Production requires HTTPS.
- Production sessions and endpoint identifiers use separate opaque random values in `Secure`, `HttpOnly`, `SameSite=Strict` cookies. Only their hashes are stored in SQLite. An endpoint identifier cannot authenticate a request by itself.
- Logging out revokes all sessions for the current endpoint and, after an explicit confirmation, discards every current-account browser record including unsynchronized changes. It does not delete server-synchronized content or another local user's rows. Password recovery and account disabling revoke every endpoint; password changes revoke other endpoints. Remote logout is scoped to the authenticated user, cannot target the current endpoint, and is allowed only after its server-recorded first-trusted time is 24 hours old. Repeated login does not reset that time.
- Remembered sessions have a rolling long-lived cookie; ordinary sessions use a session cookie and the configured server TTL. An eligible remembered credential may unlock its local cache while the server is unreachable, but all network capabilities remain disabled until `/api/auth/me` confirms the same remembered endpoint. Remote revocation and cookie loss therefore take effect on the next successful connection attempt, not while the device remains offline. Browser storage cleanup terminates local trust immediately.
- Immediate permanent deletion requires an authenticated session, an explicit client-side confirmation, a synchronized tombstone, and the server-side user scope derived from that session.
- Browser CSRF resistance relies on `SameSite=Strict` cookies plus exact `Origin` validation when an `Origin` header is present. `APP_ORIGIN` must therefore match the public browser origin exactly.
- Markdown does not execute raw HTML or scriptable embeds.
- KaTeX and Mermaid execute only from the reviewed local application bundle. Mermaid uses strict rendering, removes event handlers and external resource references from generated SVG, and displays the result as a non-interactive Blob image. It does not add a CDN, remote font, frame, or new network origin.
- The application uses a restrictive Content Security Policy and no runtime CDN scripts.
- The CSP allows `'wasm-unsafe-eval'` only so the bundled Argon2id module can compile; JavaScript `'unsafe-eval'` remains disabled.
- Login, registration, invitation, and recovery endpoints are rate limited.
- Sensitive material is excluded from logs and error reports.
- Synchronization event streams are bound to the authenticated user and session, are closed on revocation or account disabling, and are periodically revalidated while open.

## Account isolation

Authorization derives user identity exclusively from the server session. Request bodies and URLs never choose the authorization scope. Unknown and cross-user object IDs return indistinguishable not-found responses.

The first account bootstraps the administrator role. The empty-database check and account insert run in one SQLite `BEGIN IMMEDIATE` transaction, so concurrent registration requests can assign this bootstrap role only once. Administrators may create one-time account activations, disable accounts, permanently delete another account after master-password and username confirmation, or inspect ciphertext storage usage, but cannot decrypt user data. Deletion is scoped to the exact target user and cascades through that user's server records; self-deletion and deletion of the last administrator are rejected. Each invited user creates their password, recovery key, and vault key in their own browser. Account disabling is reversible and does not erase ciphertext.

## Data-loss controls

- Local encrypted copy before network upload.
- Durable retry outbox.
- Per-object decryption failure isolation: one invalid ciphertext cannot hide other readable notes. Failed local ciphertext and pending edits remain untouched, and remote ciphertext must authenticate before replacing a known-good local copy. Suppressing a repeated warning stores only a local fingerprint for that exact failed revision and does not delete the ciphertext.
- Append-only server revisions.
- Independent encrypted note history with retention, quota, clear markers, generation-safe local-first creation/metadata retry storage, and protected-row/attachment retention. Protected history blocks individual deletion, bulk history clearing, scheduled history cleanup, and physical purge of its owning note and referenced attachments. User-visible history deletion never removes synchronization revisions.
- Tombstone deletion and trash restoration.
- Encrypted note-lock metadata blocks current clients from editing a protected note or trashing a selection containing it, including recursive folder selections.
- Attachment tombstones follow their owning note. Physical removal occurs after the configured retention period or after an explicit confirmation for a manual purge.
- Exportable plaintext Markdown and consistent server backups.
- Consistent SQLite online backups and documented restore drills.

Recovery-key rotation creates a fresh random recovery key in the Crypto Worker, updates only its server-side verifier and vault-key envelope after master-password verification, and invalidates the previous recovery key. The plaintext recovery key is displayed once and is not persisted.

## Operational requirements

- Serve a reviewed, pinned build over HTTPS and protect the host and reverse proxy from unauthorized code changes.
- Keep `.env`, SQLite backups, reverse-proxy logs, and host snapshots access-controlled even though note payloads are encrypted.
- Test account recovery and backup restoration on a separate deployment; the existence of a backup file is not proof that users can decrypt it.
- Treat Markdown ZIP exports as plaintext. They must not be uploaded to an untrusted backup target without independent encryption.
- Do not add analytics, remote fonts, CDN scripts, new network origins, raw HTML, or scriptable embeds without revisiting this threat model and the Content Security Policy.
