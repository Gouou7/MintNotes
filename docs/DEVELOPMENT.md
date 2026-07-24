# Development guide

This guide is for contributors who need to run, verify, or extend Mint Notes. Product operation belongs in the [user guide](USER_GUIDE.md); production configuration belongs in the [deployment guide](DEPLOYMENT.md).

## Requirements

- Node.js 22 or newer.
- pnpm 11 or newer, matching the `packageManager` field in `package.json` when possible.
- Docker Compose v2 for container validation.

Install dependencies:

```bash
pnpm install
```

The repository maintains a small `pnpm` patch for `typora-web`. A normal install applies `patches/typora-web@0.3.1.patch` through the workspace configuration; do not edit installed package files directly.

## Development servers

```bash
pnpm dev
```

This starts:

- Vite at `http://localhost:5173`.
- The Fastify API at `http://127.0.0.1:8787`.
- A Vite proxy from `/api` to the API server.

The development API creates `./data/notes.sqlite`; this directory is ignored by Git. The production image instead fixes persistent storage at `/data`. The first account in a new database becomes administrator.

Individual processes are also available:

```bash
pnpm dev:web
pnpm dev:server
```

## Project layout

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | Unlocked application state, local persistence orchestration, synchronization, conflicts, trash, and lock lifecycle. |
| `src/components/` | Shared presentation primitives, including the standard icon wrapper. |
| `src/editor/` | `typora-web` adapter, source/live drop handling, read-only rendering, and outline extraction. |
| `src/features/history.ts` and `src/components/HistoryPanel.tsx` | History payload/deduplication policy and right-panel history presentation. |
| `src/i18n/` | Typed English, Simplified Chinese, and Traditional Chinese messages, browser-language resolution, date formatting, and language preference context. |
| `src/crypto/` | Browser Worker key derivation, password/recovery/device envelopes, AES-GCM object encryption, and attachment chunk encryption. |
| `src/storage/` | Dexie schema for encrypted IndexedDB objects, chunks, preferences, cursors, and durable outboxes. |
| `src/features/` | Authentication, settings, administration, file-tree and versioned workspace-state utilities, synchronization coordination and batching, attachments, import/export, and text statistics. |
| `server/` | Fastify routes, session authentication, user-scoped ciphertext storage and synchronization hints, SQLite schema, and online backup. |
| `scripts/` | Crypto Worker integration test and API smoke test. |
| `patches/` | Maintained public-controller extension for `typora-web`. |
| `deploy/` | Reverse-proxy example. |
| `docs/` | User, deployment, architecture, security, backup, and maintenance documentation. |

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, and `docs/SECURITY.md` before changing authentication, encryption, persistence, synchronization, service-worker behavior, or database schemas.

## UI icons and branding

Application controls use `lucide-react`. Import every symbol explicitly so Vite can tree-shake unused icons, then render it through `AppIcon`, which supplies the standard 18 px size, 1.8 stroke width, and decorative accessibility attributes:

```tsx
import { LockKeyhole, Settings } from "lucide-react";
import { AppIcon } from "./components/AppIcon";

<button aria-label="Settings"><AppIcon icon={Settings} /></button>
<button><AppIcon icon={LockKeyhole} size={16} />Lock</button>
```

- Do not use `import * as Icons`, runtime string lookup, or other patterns that can retain the full library in the client bundle.
- Do not use Emoji, Unicode glyphs, remote icon fonts, or CDN-hosted SVGs for application controls. Remote assets would also require a CSP and security review.
- An icon-only button needs `aria-label` or equivalent visible text. `AppIcon` marks the SVG itself as decorative so assistive technology announces the control rather than the drawing.
- Keep the Mint Notes logo, favicon, PWA icons, maskable PWA icons, and Apple touch icon as the project-owned assets under `public/`; third-party UI symbols must not replace the product identity.
- Lucide and inherited Feather license text ships in `public/THIRD_PARTY_NOTICES.txt`. Update that file whenever the icon library or applicable license changes, and confirm the notice is present in `dist/` after a production build.

## Verification

Run the normal checks:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:crypto-worker
pnpm test:smoke
docker compose config
```

The order matters:

- `pnpm test` runs the Vitest unit and server tests directly from source.
- `pnpm build` produces `dist/` and `server-dist/`.
- `pnpm test:crypto-worker` loads the built Worker bundle from `dist/assets`.
- `pnpm test:smoke` starts `server-dist/index.js` against a temporary database and removes it afterward.

The smoke test covers account bootstrap, cross-user object, attachment, avatar, note-history and SSE isolation, source-client notification suppression, batch object writes and conflicts, compact delta pulls, history settings/clear barriers/purge, password and recovery-key changes, administrator activation and deletion, authenticated purge propagation, and trash-retention settings. The Worker test covers registration/login/recovery compatibility, recovery-key rotation, object, avatar, history and attachment round trips, nonce uniqueness, AAD binding, and tamper rejection.

## Local-first invariant

The keystroke path must remain independent of network latency:

```text
editor state -> browser encryption -> IndexedDB object + outbox transaction -> background network sync
```

Do not move `fetch` calls into the editor `onChange` path. A network failure must leave the latest encrypted local object and its outbox entry intact. Confirmed logout is the only intentional destructive exception: cancel pending local saves, prevent in-flight work from repopulating IndexedDB, and delete every current-user row from all object, attachment, metadata, credential, and revocation stores without affecting another user.

Synchronization uses `baseRevision` and an idempotency key. A `409` response must preserve a conflict copy or otherwise retain the only local revision; never resolve conflicts solely from wall-clock timestamps.

Keep push and pull triggers separate. Editor persistence may request an outbox push, but must not append an unconditional delta pull. SSE carries only a wake-up hint; durable cursors, outboxes, startup/reconnect/visibility pulls, and the foreground safety check remain responsible for correctness. Apply remote pages to IndexedDB in bulk and publish one indexed UI merge after the pull instead of setting React state per object.

## Encryption and attachment rules

- Use the existing crypto Worker wrappers; do not introduce custom cryptographic primitives.
- Generate a fresh 96-bit AES-GCM nonce for every encryption under a key.
- Bind ciphertext to its user, object/attachment ID, type or chunk position, schema/encryption version, and revision through AAD.
- Never persist plaintext notes or the unlocked vault key in Local Storage, Cache Storage, URLs, logs, or server data.
- Device unlock may persist only the non-exportable IndexedDB `CryptoKey`, its user- and endpoint-bound wrapped vault credential, local PIN verifier/failure count, auto-lock preference, and pending endpoint revocation. Never export these records or restore the vault before `/api/auth/me` confirms the matching endpoint session.
- Keep attachment chunks encrypted in IndexedDB before inserting the Markdown reference and before scheduling upload.
- Upload attachment chunks before the encrypted attachment manifest and owning note.
- Preserve the one-note-per-attachment ownership rule; duplication must create a new UUID and key.

The application may use only documented `typora-web` controller methods. The maintained patch exposes Markdown insertion and coordinate-to-Markdown-offset mapping; application code must not access `editor.view` or other package internals.

## Database and compatibility

The server requires SQLite schema v2. `openDatabase` rejects unknown versions and a legacy database with tables but no supported `user_version`. Within schema v2 it additively creates trusted endpoints, session endpoint linkage, and the user-scoped `profile_assets` ciphertext table without modifying encrypted note objects. Because old session rows cannot be reliably merged into browser endpoints, that one-time extension revokes all existing sessions. The browser keeps the `webmd-notes-v2` database name; Dexie v4 adds endpoint-bound credentials and durable pending revocation without changing ciphertext formats.

The browser intentionally uses the separate IndexedDB name `webmd-notes-v2`. Dexie v5 adds encrypted history snapshots and their durable outbox without changing the database name or encrypted object formats. Changes to either schema require updates to architecture, security, deployment, backup, and migration documentation.

All SQL access to owned objects, revisions, changes, attachment chunks, history snapshots, settings, clear markers, and usage must derive `user_id` from the authenticated session. Never accept an authorization scope from a request body or query parameter. Keep `note_history` separate from `object_revisions`; arbitrary deletion from the latter breaks incremental synchronization.

Trusted-endpoint listing and revocation follow the same rule. The 24-hour gate uses the current endpoint's server-side `first_seen_at`, never client input, session creation, or a device timestamp. Login preserves this value while replacing the endpoint's old sessions. Activity tracking is throttled to one SQLite update per session and endpoint per minute.

Use the online backup implementation in `server/backup.ts`; copying a live WAL-mode SQLite file is not a consistent backup.

## PWA and content security

The service worker precaches only local build assets and activates new builds through a user confirmation prompt. Synchronization correctness must not depend solely on Service Worker background sync or SSE delivery; startup, online, low-frequency safety, and visibility triggers remain required.

The production Content Security Policy allows same-origin assets, local workers, data/blob images, and WebAssembly compilation for Argon2id. Adding a remote script, font, analytics endpoint, frame, or executable Markdown embed requires a security review and CSP change.
