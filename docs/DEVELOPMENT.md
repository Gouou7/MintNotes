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

The repository owns its live Markdown editor core under `src/editor/core/`. It was derived from the `typora-web` 0.3.1 release source; `src/editor/core/UPSTREAM.md` records the exact commit and license. The imported behavior specs and test harness live beside the core and run through the repository's Vitest command. Change the TypeScript source directly and cover parser, serializer, input-transaction, extension, decoration, and controller changes with direct round-trip and DOM transaction tests.

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

The development server formats logs as colored, readable single lines. It logs
one completion record per API request except health checks and static assets,
plus important authentication, conflict, quota, administration, and maintenance
events. Use `LOG_LEVEL=debug pnpm dev:server` when detailed synchronization
batch summaries are required. Production uses the same event fields as JSON.

Every API response includes a server-generated `X-Request-ID` for correlation.
Log only through the typed helpers in `server/logging.ts`: never pass a request,
headers, cookies, body, response, username, complete internal ID, ciphertext,
nonce, or secret to a logger. User, object, endpoint, and account-setup IDs must
first be converted to process-local anonymous references.

## Project layout

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | Top-level routing between authentication, device lock, and the unlocked vault. |
| `src/components/` | Shared presentation primitives, including the standard icon wrapper. |
| `src/editor/core/` | ProseMirror/Markdown core, canonical parser and serializer, input transactions, generic declaration-only presentation host and extension contract, stable controller, imported behavior specs, and provenance. |
| `src/editor/extensions/` | Separate product-specific Callout, Comment, Math, Mermaid, and WikiLink/Embed Live presentations; the core does not import these modules. New renderers declare source matches and renderer callbacks instead of creating raw ProseMirror plugins. |
| Other `src/editor/` modules | React Live/Source adapter, source/live drop handling, Markdown presentation codecs, read-only rendering, and outline extraction. |
| `src/features/history.ts`, `src/features/vault/historyController.ts`, and `src/components/HistoryPanel.tsx` | History payload/deduplication policy, typed encrypted local persistence/metadata queue, and right-panel history presentation. |
| `src/features/session/` | Session restoration, trusted-device state, cross-tab invalidation, and locked-session commands. |
| `src/features/vault/` | Unlocked-vault composition, typed state/controller hooks, serialized object persistence, retrying document saves, page-based pull/cursor application, local purge, atomic outbox acknowledgement, and vault-specific presentation such as the document tree. |
| `src/i18n/` | Typed English, Simplified Chinese, and Traditional Chinese messages, browser-language resolution, date formatting, and language preference context. |
| `src/crypto/` | Browser Worker key derivation, password/recovery/device envelopes, AES-GCM object encryption, and attachment chunk encryption. |
| `src/storage/` | Dexie schema for encrypted IndexedDB objects, chunks, preferences, cursors, and durable outboxes. |
| `src/features/` | Authentication, settings, administration, file-tree and device-local workspace-state utilities, legacy workspace migration, synchronization coordination and batching, attachments, import/export, and text statistics. |
| `server/index.ts` and `server/app.ts` | Process startup and dependency composition; neither file owns route or SQL behavior. |
| `server/auth/`, `server/account/`, `server/admin/`, `server/attachments/`, `server/history/`, and `server/sync/` | Session-derived guards, account endpoint lifecycle, domain routes, validation, and repositories. User-owned operations receive authenticated scope rather than a request-supplied user ID. |
| `src/features/vault/VaultWorkspace.tsx` and `server/routes.ts` | Integration coordinators retained while remaining account/document workflows are extracted. Document-save scheduling, pull/cursor application, purge storage, outbox acknowledgement, history persistence, and history/attachment server routes are delegated to focused modules. They are not extension points. |
| Other `server/` modules | Structured logging, SQLite schema, history/trash policies, synchronization events, maintenance jobs, and online backup. |
| `scripts/` | Crypto Worker integration test and API smoke test. |
| `deploy/` | Reverse-proxy example. |
| `docs/` | Task-oriented documentation and its [navigation index](README.md). |

Read [`AGENTS.md`](../AGENTS.md) before changing system behavior. Follow its routing table to the relevant architecture, editor, security, deployment, or recovery guide instead of treating every document as required background.

## Module boundaries

`App.tsx`, `VaultApp.tsx`, `server/index.ts`, and `server/app.ts` are composition boundaries. They may select a surface, construct dependencies, register modules, and own shutdown wiring, but they must not accumulate encryption, persistence, synchronization, route-handler, or SQL algorithms.

Client state stays in focused hooks and controllers with explicit dependency objects. Views receive typed state and commands and do not call Dexie, the Crypto Worker, or synchronization APIs directly. Same-object durable writes go through the object persistence controller; attachment-bearing copies go through the shared attachment clone service.

Server HTTP modules validate input and obtain user scope from the authenticated request. Repositories and services receive that scope explicitly. A body, parameter, or query field must never select the owning user. New route families belong in a domain route module instead of the startup or application-composition files.

When a change crosses domains, keep orchestration in the narrowest controller that owns the workflow and expose small typed ports to collaborators. If related behavior is still embedded in a broad module, extract that cohesive behavior and its tests as part of the change rather than growing the broad module.

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

The smoke test covers account bootstrap, cross-user object, attachment, avatar, note-history and SSE isolation, source-client notification suppression, batch object writes and conflicts, compact delta pulls, history settings/clear barriers/purge, password and recovery-key changes, administrator activation and deletion, authenticated purge propagation, and trash-retention settings. The Worker test covers registration/login/recovery compatibility, recovery-key rotation, PIN-encrypted device credentials, wrong-PIN rejection, object, avatar, history and attachment round trips, nonce uniqueness, AAD binding, and tamper rejection.

Maintainers building and publishing the official tag-derived multi-platform
container locally should follow the
[Docker image release guide](DOCKER_IMAGE_RELEASE.md).

## Implementation boundaries

Read [`AGENTS.md`](../AGENTS.md) before changing system behavior. It contains the executable repository constraints and routes each change area to its canonical documentation:

| Change area | Canonical references |
| --- | --- |
| Local-first persistence, synchronization, browser/server storage, or attachments | [Architecture](ARCHITECTURE.md) |
| Canonical Markdown, parsing, serialization, Live rendering, source coordinates, or editor extensions | [Editor architecture](EDITOR_ARCHITECTURE.md) |
| Authentication, encryption, AAD, account isolation, CSP, or metadata exposure | [Security model](SECURITY.md) |
| Schema compatibility, production configuration, or upgrades | [Production deployment](DEPLOYMENT.md) |
| Application releases or Docker image publishing | [Docker image release](DOCKER_IMAGE_RELEASE.md) |
| Online backup, retention, or restoration | [Backup and restore](BACKUP_AND_RESTORE.md) |
| User-visible editor, history, import/export, trash, settings, or PWA behavior | [User guide](USER_GUIDE.md) |

### Data durability and synchronization

- Keep the keystroke path independent of network latency: editor state, browser encryption, atomic IndexedDB object/outbox storage, then background synchronization.
- Preserve the only remaining revision when synchronization conflicts or deletion flows fail.
- Make attachment ciphertext durable before inserting its Markdown reference, and upload chunks before the manifest and owning note.
- Do not make synchronization correctness depend on Service Worker background execution or SSE delivery.

### Editor changes

The canonical Markdown source is the sole editable document model. Live rendering is presentation only, and violating source-backed positions or authored delimiters is a release blocker. The complete rules—including source-coordinate editing, allowed temporary representations, ownership boundaries, and mandatory regressions—live in [Editor architecture](EDITOR_ARCHITECTURE.md); do not reproduce partial variants of those rules in feature documentation.

### Security and platform boundaries

- Use the existing cryptographic wrappers and session-derived server authorization; do not add custom primitives or request-controlled user scopes.
- Review the security model and Content Security Policy before adding remote assets, analytics, raw HTML, or executable embeds.
