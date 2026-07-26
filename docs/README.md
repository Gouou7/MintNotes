# Documentation

Mint Notes documentation is organized by the task you are trying to complete. Start with the guide for your role instead of reading every document in order.

## Choose a guide

| Goal | Canonical guide | Scope |
| --- | --- | --- |
| Use the application | [User guide](USER_GUIDE.md) | Accounts, editor modes, math, Mermaid, WikiLinks, Callouts, YAML properties, organization, history, attachments, synchronization, import/export, trash, settings, and PWA behavior. |
| Deploy or upgrade a server | [Production deployment](DEPLOYMENT.md) | Environment variables, Docker, reverse proxy, account bootstrap, acceptance checks, and schema compatibility. |
| Back up or restore data | [Backup and restore](BACKUP_AND_RESTORE.md) | Online SQLite backups, retention, restore drills, and production replacement. |
| Set up or verify development | [Development guide](DEVELOPMENT.md) | Contributor requirements, project layout, local servers, implementation boundaries, and verification commands. |
| Understand the system design | [Architecture](ARCHITECTURE.md) | Runtime topology, local-first persistence, synchronization, browser/server storage, attachments, and portable data. |
| Review trust and security boundaries | [Security model](SECURITY.md) | Threat model, key hierarchy, browser security, account isolation, data-loss controls, and operational requirements. |

## Repository-level documents

- [Project overview and quick start](../README.md)
- [简体中文项目说明](../README_zh.md)
- [Changelog](../CHANGELOG.md)
- [Repository instructions for coding agents](../AGENTS.md)

## Documentation boundaries

- `README.md` is the concise product entry point; detailed behavior belongs in the task guides above.
- User-visible behavior belongs in the user guide. Deployment procedures, backup drills, architecture, and security claims stay in their respective canonical guides.
- Cross-link to a canonical guide instead of copying long procedures into multiple files.
- Keep commands, configuration names, limits, and compatibility claims aligned with the implementation and checked-in configuration.
