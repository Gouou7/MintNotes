# Development guide

[Documentation index](README.md)

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
| `docs/` | Task-oriented documentation and its [navigation index](README.md). |

Read [`AGENTS.md`](../AGENTS.md), [Architecture](ARCHITECTURE.md), and the [Security model](SECURITY.md) before changing authentication, encryption, persistence, synchronization, service-worker behavior, or database schemas.

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

## Implementation boundaries

Read [`AGENTS.md`](../AGENTS.md) before changing system behavior. It contains the executable repository constraints and routes each change area to its canonical documentation:

| Change area | Canonical references |
| --- | --- |
| Local-first persistence, synchronization, browser/server storage, or attachments | [Architecture](ARCHITECTURE.md) |
| Authentication, encryption, AAD, account isolation, CSP, or metadata exposure | [Security model](SECURITY.md) |
| Schema compatibility, production configuration, or upgrades | [Production deployment](DEPLOYMENT.md) |
| Online backup, retention, or restoration | [Backup and restore](BACKUP_AND_RESTORE.md) |
| User-visible editor, history, import/export, trash, settings, or PWA behavior | [User guide](USER_GUIDE.md) |

The most common contributor pitfalls are:

- Keep the keystroke path independent of network latency: editor state, browser encryption, atomic IndexedDB object/outbox storage, then background synchronization.
- Preserve the only remaining revision when synchronization conflicts or deletion flows fail.
- Use the existing cryptographic wrappers and session-derived server authorization; do not add custom primitives or request-controlled user scopes.
- Make attachment ciphertext durable before inserting its Markdown reference, and upload chunks before the manifest and owning note.
- Use only documented `typora-web` controller methods. The maintained patch exposes Markdown insertion and coordinate-to-Markdown-offset mapping; application code must not access `editor.view` or package internals.
- Treat Markdown as the canonical portable format. Editor mode changes, frontmatter presentation, and read-only rendering must not silently rewrite it.
- Do not make synchronization correctness depend on Service Worker background execution or SSE delivery.
- Review the security model and Content Security Policy before adding remote assets, analytics, raw HTML, or executable embeds.
