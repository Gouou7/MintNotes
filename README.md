# Mint Notes

English | [简体中文](README_zh.md)

Mint Notes is a toy-grade project developed with AI. It aims to provide a note-taking experience that is lightweight to deploy, secure to store, and simple to use. It supports responsive PWA layouts and end-to-end encryption, so you can self-host your notes on a remote server and edit them with familiar Markdown syntax.

If you find a bug or have a feature suggestion, please submit an issue—or ask your AI agent to make the changes!


## Features

- **Local-first and end-to-end encrypted:** Input and local saves never wait for the network; titles, content, folders, and attachments are encrypted in the browser before synchronization.
- **Markdown editing:** Typora-style live editing, source mode, reading mode, KaTeX math, Mermaid diagrams, WikiLinks, extensible Obsidian-style callouts, YAML properties, a live outline, and text statistics.
- **Organization and history:** Folders, search, sorting, drag-and-drop, note locking, trash, and encrypted cross-device version history with preview and restore.
- **Multi-user and device security:** Multi-user accounts, recovery keys, activation codes, remembered devices with offline cold-start access, optional PIN-encrypted local unlock credentials, automatic locking, and remote sign-out.
- **Attachments and data migration:** Encrypted image attachments plus Markdown/ZIP import and export that preserve folder structure and attachment paths.
- **PWA and multi-device synchronization:** Installable desktop, tablet, and mobile layouts with remembered-device offline startup and editing, deferred synchronization, themes, and multilingual interfaces.
- **Lightweight self-hosting:** One Docker service backed by SQLite, with a consistent online-backup workflow.

## Technology

The browser application uses React, TypeScript, Vite, `typora-web`, Web Crypto, and Dexie/IndexedDB.

The server uses Fastify and SQLite.

## Development

Requirements:

- Node.js 22 or newer
- pnpm 11 or newer

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`. Vite proxies `/api` to the API server at `http://127.0.0.1:8787`. The first account becomes the administrator and receives a recovery key during registration.

See the [development guide](docs/DEVELOPMENT.md) for the project layout, verification commands, and test dependencies.

## Docker quick start

```bash
cp .env.example .env
mkdir -p notes-data
docker compose config
docker compose up --build -d
docker compose ps
```

Before starting, set `APP_ORIGIN` in `.env` to the exact HTTPS origin users will open, such as `https://notes.example.com`.

On Linux, set `PUID` and `PGID` to the non-zero numeric user and group IDs that own `./notes-data`—normally the output of `id -u` and `id -g`—so the non-root container can write its SQLite files.

## First use

1. Open the application and create the first account. It is always assigned the administrator role.
2. Store the displayed recovery key in a password manager or a protected offline location. It is shown only during account creation.
3. Keep public registration disabled unless it is intentionally required. Administrators can create activation codes under **Settings > Administrator settings**.
4. Create and test both a plaintext Markdown ZIP export and an encrypted server backup before relying on the service.

The [user guide](docs/USER_GUIDE.md) covers editor modes, file-tree operations, attachments, synchronization states, account recovery, import/export, and safe deletion.

## Documentation

See the [documentation index](docs/README.md) to choose a guide by task.

- **Using Mint Notes:** [User guide](docs/USER_GUIDE.md)
- **Operating Mint Notes:** [Production deployment](docs/DEPLOYMENT.md) and [backup and restore](docs/BACKUP_AND_RESTORE.md)
- **Contributing:** [Development guide](docs/DEVELOPMENT.md), with architecture and security references linked from the documentation index

## Acknowledgements

Thanks to the following open-source projects:

- Markdown editor: [typora-web](https://github.com/Yuyz0112/typora-web)
- Math renderer: [KaTeX](https://katex.org/)
- Diagram renderer: [Mermaid](https://mermaid.js.org/)
- Icon library: [Lucide React](https://lucide.dev/)

## License

Mint Notes is available under the [MIT License](LICENSE).
