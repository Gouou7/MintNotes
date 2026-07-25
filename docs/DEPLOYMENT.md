# Production deployment

[Documentation index](README.md)

Mint Notes runs as one non-root application container plus one persistent SQLite volume. Production access must use HTTPS because the browser handles passwords, recovery keys, vault keys, and plaintext notes while unlocked.

## Prerequisites

- A server with Docker Engine and Docker Compose v2.
- A DNS name pointing to the server.
- An HTTPS reverse proxy with a valid certificate.
- A protected location outside the application volume for backup copies.

The default Compose file publishes `127.0.0.1:8787` only. Keep this loopback binding and let the reverse proxy provide public access.

## Configuration

Copy the example and edit it before the first start:

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID` | `1000` | Non-zero numeric Linux user ID used to run the Compose container. Match the owner of the host-side data directory. |
| `PGID` | `1000` | Non-zero numeric Linux group ID used to run the Compose container. Match the owner of the host-side data directory. |
| `HOST` | `0.0.0.0` | Address used inside the container. Keep the default for Compose. |
| `PORT` | `8787` | HTTP port used inside the container. The supplied Compose mapping expects `8787`. |
| `APP_ORIGIN` | none | Exact browser origin allowed for state-changing requests, including scheme and non-default port. Required in production. |
| `ALLOW_REGISTRATION` | `false` | Enables public registration after the first account. Administrator-created activation codes are unaffected. |
| `MAX_ATTACHMENT_SIZE_MB` | `25` | Server-side encrypted attachment limit. The bundled browser client also has a 25 MiB limit; raising only this variable does not raise the client limit. |
| `USER_STORAGE_QUOTA_MB` | `2048` | Per-user quota for encrypted attachment chunks. |
| `USER_HISTORY_QUOTA_MB` | `256` | Independent per-user quota for encrypted note-history ciphertext. |
| `SESSION_TTL_HOURS` | `168` | Server lifetime of an ordinary, non-remembered login. Remembered endpoints use the application's rolling long-lived window. |
| `TRUST_PROXY` | `false` | Trusts forwarded proxy information. Set to `true` only behind the controlled reverse proxy described below. |

Recommended production values:

```env
PUID=1000
PGID=1000
APP_ORIGIN=https://notes.example.com
ALLOW_REGISTRATION=false
MAX_ATTACHMENT_SIZE_MB=25
USER_STORAGE_QUOTA_MB=2048
USER_HISTORY_QUOTA_MB=256
SESSION_TTL_HOURS=168
TRUST_PROXY=true
```

Do not put passwords, recovery keys, or encryption keys in `.env`; the service does not need them.

The production image always stores the SQLite database, WAL files, and online
backups under `/data`. Keep the container side of the volume mapping fixed at
`/data`; change only its host-side path when selecting another storage location.
The supplied Compose file runs the service as `${PUID}:${PGID}` and bind-mounts
`./notes-data`. On Linux, create that directory with matching ownership before
the first start:

```bash
mkdir -p notes-data
sudo chown -R "$(id -u):$(id -g)" notes-data
```

Set `PUID` to the output of `id -u` and `PGID` to the output of `id -g`. Existing
deployments may use another dedicated account; in that case keep the directory
and both variables aligned with that account. Do not make the directory
world-writable or set either ID to `0`. On SELinux hosts, add the appropriate
bind-mount relabel option such as `:Z` according to the host policy.

## Start and verify the container

```bash
docker compose config
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 notes
```

The supplied Compose file builds the current source checkout and tags the image with the name configured in `docker-compose.yml`.

The health endpoint is available to the host at `http://127.0.0.1:8787/api/health`. A healthy response is:

```json
{"ok":true}
```

## Reverse proxy

The repository includes [`deploy/nginx.conf.example`](../deploy/nginx.conf.example). Replace the domain and certificate paths, then test Nginx before reloading it.

The proxy must preserve the original host and scheme. `APP_ORIGIN` must equal the public URL users open. The supplied `client_max_body_size 4m` is sufficient because encrypted attachments are uploaded in approximately 1 MiB chunks rather than one large request.

`/api/sync/events` is a long-lived Server-Sent Events response. The supplied Nginx example disables buffering and caching for that exact path and uses a one-hour read/send timeout. Preserve those directives when adapting another reverse proxy; clients remain correct if the stream disconnects, but will use slower safety pulls until it reconnects.

Do not add runtime CDN scripts, analytics, remote fonts, or additional origins without reviewing the [security model](SECURITY.md) and updating the Content Security Policy.

## Initialize accounts

1. Open the public HTTPS URL.
2. Create the first account. It becomes the sole bootstrap administrator even when `ALLOW_REGISTRATION=false`; concurrent registration requests cannot receive a second bootstrap administrator role.
3. Save the displayed recovery key before continuing.
4. Leave public registration disabled unless it is intentionally required.
5. To add users, open **Settings > Administrator settings**, create a 72-hour activation code, and send it to the intended user through a trusted channel. The user chooses their password and generates keys in their own browser.

An administrator can disable an account and revoke its access without erasing data. Permanent deletion additionally requires the administrator's master password and exact target username, and removes only that user's records from the current server database.

## Deployment acceptance checks

- HTTP redirects to HTTPS and the application origin matches `APP_ORIGIN`.
- Registration bootstrap, login, lock, recovery-key reset, and password change work.
- An uploaded profile avatar appears on another device only after browser-side decryption; the database contains only its opaque ciphertext envelope.
- An ordinary login survives refresh but normally ends with the browser session; **Remember this device** survives restart subject to browser storage policy. Logout and remote revocation prevent restoration.
- Trusted-endpoint history keeps one row per user/browser profile across repeated logins, updates login count and last-online time, enforces the 24-hour gate from first trust, and revokes all endpoint sessions remotely.
- Local PIN setup/change/removal requires the master password; all inactivity-lock choices work, master-password fallback unlocks, and five failed PIN attempts remove local trust.
- Trash defaults to 30-day retention, supports permanent retention, and requires explicit confirmation for immediate purge.
- Note history defaults to 10-minute active checkpoints and 90-day retention, enforces the independent history quota, decrypts across devices, and preserves synchronization after individual or bulk history deletion.
- A second administrator-created account cannot access the first account's opaque objects or attachment chunks.
- Administrator deletion rejects an incorrect master password, self-deletion, and the last administrator; deleting a test user cascades only that user's records.
- A note edited after network disconnection shows a local-save state and synchronizes after reconnection.
- Two unlocked foreground clients receive remote changes through one SSE connection each; an idle client does not issue five-second synchronization requests, and the stream reconnects after a proxy or network interruption.
- An encrypted image added on one device can be downloaded and verified on another device.
- The PWA installs and its static shell opens without a network connection. Cold offline vault unlock is not yet supported.
- `docker compose exec notes pnpm backup` completes and the copied database passes a restore drill.

## Upgrade and schema compatibility

The current application requires server schema v2 and the browser database `webmd-notes-v2`. It does not migrate the legacy pre-v2 schema.

Before replacing an older deployment:

1. Export a complete Markdown ZIP from every account that must be preserved.
2. Create and copy out a consistent SQLite online backup.
3. Keep the old deployment and its backup unchanged until the new deployment is verified.
4. Start this build with a fresh `/data` volume and import the portable exports.

The service refuses to overwrite a detected legacy database automatically. Existing supported schema v2 databases receive additive trusted-endpoint, session-linkage, encrypted `profile_assets`, encrypted `note_history`, clear-marker tables, and account history-setting columns. The endpoint migration deliberately revokes all pre-upgrade sessions once because historical rows cannot be reliably merged into browser profiles; users must log in again. User records, encrypted note objects, synchronization revisions, and attachments are unchanged. Create an online backup before upgrading as usual.
