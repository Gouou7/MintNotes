# Documentation

Mint Notes documentation is organized by the task you are trying to complete. Start with the guide for your role instead of reading every document in order.

## Product and usage

| Goal | Canonical guide | Scope |
| --- | --- | --- |
| Use the application | [User guide](USER_GUIDE.md) | Accounts, editor modes, math, Mermaid, WikiLinks, Callouts, YAML properties, organization, history, attachments, synchronization, import/export, trash, settings, and PWA behavior. |

## Engineering

| Goal | Canonical guide | Scope |
| --- | --- | --- |
| Understand the system design | [Architecture](ARCHITECTURE.md) | Runtime topology, local-first persistence, synchronization, browser/server storage, attachments, and portable data. |
| Change the editor | [Editor architecture](EDITOR_ARCHITECTURE.md) | Canonical Markdown, one-way rendering, source coordinates, editor ownership, presentation-only state, and required regressions. |
| Audit editor source fidelity | [Editor source-fidelity audit](EDITOR_SOURCE_FIDELITY_AUDIT.md) | Current compliance evidence, confirmed source-loss risks, target behavior, and the exact-string verification matrix. |
| Set up or verify development | [Development guide](DEVELOPMENT.md) | Contributor requirements, project layout, module boundaries, local servers, and verification commands. |
| Review trust and security boundaries | [Security model](SECURITY.md) | Threat model, key hierarchy, browser security, account isolation, data-loss controls, and operational requirements. |

## Operations and releases

| Goal | Canonical guide | Scope |
| --- | --- | --- |
| Deploy or upgrade a server | [Production deployment](DEPLOYMENT.md) | Environment variables, Docker, reverse proxy, account bootstrap, acceptance checks, and schema compatibility. |
| Build and publish a Docker image | [Docker image release](DOCKER_IMAGE_RELEASE.md) | Tag-derived application versions, local release checks, manual multi-platform Buildx publishing, and registry verification. |
| Back up or restore data | [Backup and restore](BACKUP_AND_RESTORE.md) | Online SQLite backups, retention, restore drills, and production replacement. |

## Repository-level documents

- [Project overview and quick start](../README.md)
- [简体中文项目说明](../README_zh.md)
- [Changelog](../CHANGELOG.md)
- [Repository instructions for coding agents](../AGENTS.md)

## Documentation boundaries

- `README.md` is the concise product entry point; detailed behavior belongs in the task guides above.
- User-visible behavior belongs in the user guide. Editor invariants belong in the editor architecture guide; system topology, security, deployment, releases, and recovery stay in their respective canonical guides.
- Cross-link to a canonical guide instead of copying long procedures into multiple files.
- Keep commands, configuration names, limits, and compatibility claims aligned with the implementation and checked-in configuration.
