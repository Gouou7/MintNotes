# AGENTS.md

## Project overview

Mint Notes is a lightweight, self-hosted, multi-user Markdown notes PWA. It uses a local-first write path and browser-side end-to-end encryption so input and durable local saves do not wait for the network and the server stores only opaque encrypted note, folder, and attachment data.

The browser application uses React, TypeScript, Vite, `typora-web`, Web Crypto, and Dexie/IndexedDB. The server uses Fastify and SQLite and is delivered as one non-root Docker service without Redis, MongoDB, object storage, or a separate search service.

## Project invariants

Preserve these invariants in every change:

- Keystrokes and local saves must never wait for a network request.
- The server must not receive plaintext titles, Markdown, tags, folder names, folder structure, outlines, attachment names, MIME types, attachment bytes, or encryption keys.
- Every server query for user-owned objects, revisions, changes, and attachment chunks must bind `user_id` from the authenticated session, never from request input.
- Conflicts and deletions must not silently destroy the only remaining revision.
- Markdown is the canonical portable note format.
- Attachment ciphertext must be durable in IndexedDB before its Markdown reference is inserted and before upload is attempted.
- Service Worker features may improve availability but must not be required for synchronization correctness.

## Documentation routing

Use `docs/README.md` as the human-facing documentation index. For implementation work, read only the documents relevant to the current change and use this table as the routing entrypoint.

| Need or change | Read first | Update when behavior changes |
| --- | --- | --- |
| Product summary, supported features, requirements, or quick start | `README.md` | `README.md`; keep it user-facing and concise. |
| Account setup, editor modes, file-tree actions, attachments, synchronization states, import/export, trash, or PWA usage | `docs/USER_GUIDE.md` | `docs/USER_GUIDE.md` and the matching README feature/limitation if externally significant. |
| Contributor setup, project layout, verification commands, or implementation boundaries | `docs/DEVELOPMENT.md` | `docs/DEVELOPMENT.md` and this file when the long-term maintenance route changes. |
| Runtime topology, local-first write path, synchronization, IndexedDB/SQLite responsibilities, or attachment flow | `docs/ARCHITECTURE.md` | `docs/ARCHITECTURE.md`; also review `docs/SECURITY.md` for boundary changes. |
| Threat model, key hierarchy, AAD, metadata exposure, cookies, CSP, or account isolation | `docs/SECURITY.md` | `docs/SECURITY.md`; security claims must match executable code and tests. |
| Docker, environment variables, reverse proxy, account bootstrap, production checks, or schema upgrade | `docs/DEPLOYMENT.md` | `docs/DEPLOYMENT.md`, `.env.example`, and `docker-compose.yml`; review README quick start when required. |
| Online backup, retention, restore drills, WAL behavior, or disaster recovery | `docs/BACKUP_AND_RESTORE.md` | `docs/BACKUP_AND_RESTORE.md`; schema/storage changes also require deployment and architecture review. |
| Nginx headers, TLS termination, or request-size limits | `deploy/nginx.conf.example` and `docs/DEPLOYMENT.md` | Keep both files aligned. |
| Repository-specific Agent constraints and recurring implementation pitfalls | `AGENTS.md` | Update this file only with durable project knowledge, not one-time task history or general Agent behavior. |

When documents disagree, use this evidence order: implementation code, automated tests, build/deployment configuration, `AGENTS.md`, then user-facing documentation. Do not preserve a stale claim merely because it already appears in README.

## Change-impact routing

- Before changing encryption, authentication, persistence, synchronization, database schemas, attachment ownership, purge behavior, or service-worker lifecycle, read `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, and the relevant sections of `docs/DEVELOPMENT.md`.
- Changes to a public API route, environment variable, deployment command, data directory, or port require a documentation synchronization check across `.env.example`, `docker-compose.yml`, `README.md`, and `docs/DEPLOYMENT.md` according to actual impact.
- Changes to portable import/export formats require `docs/USER_GUIDE.md`, `docs/ARCHITECTURE.md`, backup guidance, and compatibility notes to be checked together.
- Changes to user-visible behavior require the user guide to be updated in the same change. Internal algorithms that do not alter behavior belong in architecture or development documentation, not README.
- New server-visible metadata, network origins, analytics, CDN scripts, remote fonts, raw HTML, or executable embeds require an explicit security-model and CSP review.

## Module responsibilities

- `src/App.tsx`: unlocked application orchestration, in-memory documents, local-save scheduling, synchronization, conflict copies, tree operations, trash/purge coordination, and lock lifecycle.
- `src/components/`: shared presentation primitives, including the standard Lucide icon wrapper.
- `src/editor/`: the `typora-web` adapter, source/live image-drop handling, read-only Markdown rendering, and outline extraction.
- `src/crypto/`: browser-only Argon2id/HMAC key derivation, key envelopes, authenticated object encryption, and attachment-chunk encryption. Do not move plaintext cryptographic work to the server.
- `src/storage/`: Dexie schema for encrypted IndexedDB objects, attachment chunks, per-user preferences/cursors, and durable outboxes.
- `src/features/`: authentication, settings, administration, attachments, import/export, tree utilities, and language-aware text statistics.
- `server/`: Fastify authentication, session-derived authorization, opaque encrypted-object storage, SQLite revisions/changes, attachment chunks, account activation, and static PWA delivery.
- `scripts/`: built crypto Worker integration and API smoke tests.
- `patches/`: the minimal public-controller extension maintained for `typora-web`.
- `deploy/`: production reverse-proxy example.
- `docs/`: task-oriented user, development, architecture, security, deployment, and backup documentation, with navigation in `docs/README.md`.

## Security constraints

- Do not implement new cryptographic primitives. Use the existing crypto Worker wrappers and Web Crypto operations.
- Do not reuse an AES-GCM nonce with the same key; every encryption uses a fresh random 96-bit nonce.
- Bind object ciphertext to user ID, object ID, object type, schema/encryption version, and intended revision through AAD.
- Bind attachment chunks to user ID, attachment UUID, chunk index, total chunk count, and encryption version through AAD.
- Do not persist plaintext notes, decrypted attachment data, recovery keys, or the unlocked vault key in Local Storage, Cache Storage, logs, URLs, server responses, or SQLite.
- Authentication tokens belong in production `Secure`, `HttpOnly`, `SameSite=Strict` cookies. Only token hashes are stored server-side.
- Persistent endpoint cookies identify a user/browser profile but never authenticate by themselves; endpoint and session hashes remain separate and all endpoint queries use the authenticated session's user ID.
- Local PIN data, device keys, auto-lock preferences, and pending endpoint revocations stay browser-only and must be excluded from diagnostics. Locking clears decrypted memory; logout and invalid sessions also delete local trust.
- Raw HTML and remote executable embeds remain disabled in Markdown.
- Do not weaken exact-origin checks or CSP to work around a deployment error; fix `APP_ORIGIN` and reverse-proxy forwarding instead.

## Local-first and synchronization constraints

- The write order is in-memory update, browser encryption, atomic IndexedDB object/outbox transaction, then background upload.
- Network failures must leave the newest encrypted local object and retry entry intact.
- Attachment chunks upload before the encrypted attachment manifest and owning note revision.
- Conditional pushes use `baseRevision` and idempotency keys. Device timestamps are display metadata and must not resolve conflicts.
- A document conflict becomes a separate conflict copy. Do not replace this with last-write-wins unless the data-loss model and documentation are deliberately redesigned.
- Synchronization must continue to run after local changes, on startup after unlock, on reconnect, periodically while unlocked, and on visibility changes.

## Data, attachment, and compatibility constraints

- Server schema v2 and IndexedDB database `webmd-notes-v2` intentionally do not migrate the legacy pre-v2 format. Never delete or overwrite a legacy database automatically.
- The `webmd-*` IndexedDB, Local Storage, cookie, HTTP-header, encryption-AAD, attachment-URL, and export-format identifiers are compatibility namespaces from the earlier product name. Do not rename them without a deliberate migration that preserves existing vaults, sessions, Markdown, and exports.
- SQLite uses WAL mode. Backups must use `server/backup.ts` and SQLite's online-backup mechanism rather than copying a live `notes.sqlite` file.
- One attachment belongs to exactly one note. Duplicating a note must generate a new attachment UUID and key so deleting the original cannot break the copy.
- Moving a note to trash tombstones its attachments; physical chunk deletion occurs only after the explicit synchronized purge flow.
- The bundled browser client enforces a 25 MiB raster-image limit. Raising only `MAX_ATTACHMENT_SIZE_MB` does not increase the client limit.
- PNG, JPEG, GIF, WebP, and AVIF are detected by file signatures. SVG must not be rendered directly.
- The current offline boundary begins after vault unlock. Do not document cold offline restart/unlock as supported until the authentication and key-envelope flow implements it.

## Editor and PWA constraints

- Use only the documented `typora-web` controller API. Its underlying `editor.view` is not a stable integration surface.
- Keep `patches/typora-web@0.3.1.patch` limited to public controller methods for Markdown insertion and coordinate-to-Markdown-offset mapping. Application code must not import package internals.
- Markdown remains canonical across live, source, and read-only modes; switching modes must not silently rewrite content.
- Decrypted attachment Blob URLs exist only in memory and must be revoked when the note changes or the vault locks.
- PWA updates require the existing user confirmation path so a new bundle is not activated in the middle of an unsaved editing transition.
- Interface symbols use explicit named imports from `lucide-react` and render through `src/components/AppIcon.tsx`. Do not use namespace/dynamic icon lookup, icon fonts, CDN assets, Emoji, or text glyphs as substitutes for application controls.
- Keep the product logo and install icons in `public/` as project-owned assets; Lucide symbols are interface controls, not Mint Notes branding. Icon-only buttons require an accessible name, and changes to icon licensing must keep `public/THIRD_PARTY_NOTICES.txt` aligned with the distributed build.

## Commands and verification

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm test:crypto-worker
pnpm test:smoke
docker compose config
```

`test:crypto-worker` loads the built Worker from `dist/assets`, and `test:smoke` runs `server-dist/index.js`; run `pnpm build` before both.

At minimum:

- Run `pnpm typecheck` and `pnpm test` after TypeScript behavior changes.
- Also run `pnpm test:crypto-worker` after encryption, key-envelope, Worker, or attachment-crypto changes.
- Also run `pnpm test:smoke` after authentication, authorization, API, SQLite, activation, password, quota, or purge changes.
- Run `docker compose config` after Docker, environment, port, volume, or reverse-proxy-related configuration changes.
- Verify production build and relevant desktop/tablet/mobile flows after editor lifecycle, service-worker, theme, pane, drag/drop, or responsive-layout changes.
