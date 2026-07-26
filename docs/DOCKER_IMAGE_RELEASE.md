# Build and publish Docker images locally

[Documentation index](README.md)

This guide is for Mint Notes maintainers who manually build and publish the
official `gouou7/mint-notes` image from a local workstation. It builds one
multi-platform image for `linux/amd64` and `linux/arm64`, tags it with the
version derived from the current Git tag and with `latest`, and pushes both
tags to Docker Hub.

This workflow publishes an image; it does not replace the
[production deployment](DEPLOYMENT.md), upgrade, backup, or restore
procedures. Build only from a clean, reviewed release commit.

> The repository also contains a Tag-triggered GitHub Actions publisher at
> `.github/workflows/release-docker.yml`. Do not use both publication paths for
> the same release. This guide assumes that automated publisher is not enabled
> or configured for the release being published manually.

## Version source

The current exact Git tag is the sole application release version. For a tag
such as `v0.4.0`, the local build derives `0.4.0` and uses it for:

- the version shown under **Settings > About**;
- the OCI `org.opencontainers.image.version` label;
- the immutable Docker tag `gouou7/mint-notes:0.4.0`;
- the floating Docker tag `gouou7/mint-notes:latest`.

`package.json` intentionally keeps the private-package placeholder version
`0.0.0`; it is not an application release record. An ordinary source build
displays `development` unless `APP_VERSION` is provided explicitly.

Do not change any of the following merely because the application version
increases:

- `server/database.ts` database schema version;
- IndexedDB/Dexie versions under `src/storage/`;
- object, history, attachment, key-envelope, or encryption versions;
- workspace, import/export, or portable payload schema versions;
- the `typora-web` dependency version or its patch filename;
- `docker-compose.yml` or the `/data` layout.

Those values describe compatibility or data formats and require their own
implementation, migration, security review, tests, and documentation.

## Local prerequisites

Install or provide:

- Node.js 22 or newer;
- the pnpm version declared by `package.json`;
- Docker Engine or Docker Desktop;
- Docker Buildx with QEMU/binfmt support for `linux/amd64` and `linux/arm64`;
- a Docker Hub account with write access to `gouou7/mint-notes`.

Confirm the local tools and daemon:

```bash
node --version
pnpm --version
docker version
docker buildx version
```

On macOS, Docker Desktop normally includes Buildx and emulation support. A
Colima installation should be started with binfmt enabled:

```bash
colima start --runtime docker --cpus 4 --memory 8 --disk 100 --binfmt
docker context use colima
```

Create a container-backed builder once:

```bash
MINT_BUILDER="mint-notes-release"

docker buildx create \
  --name "$MINT_BUILDER" \
  --driver docker-container \
  --bootstrap \
  --use
docker buildx inspect --bootstrap
```

For later releases, select the existing builder:

```bash
MINT_BUILDER="mint-notes-release"

docker buildx use "$MINT_BUILDER"
docker buildx inspect --bootstrap
```

The inspection output must list both `linux/amd64` and `linux/arm64`. Do not
publish a partial `latest` image if either platform is unavailable.

## Prepare the release commit and tag

Use a stable semantic version such as `0.4.0`. Move the relevant entries from
`[Unreleased]` in `CHANGELOG.md` into a dated heading, leaving `[Unreleased]`
at the top:

```markdown
## [Unreleased]

## [0.4.0] - 2026-07-26
```

Commit all reviewed release contents and the CHANGELOG, then create an
annotated local tag:

```bash
MINT_VERSION="0.4.0"

git status --short
git diff --check
git add CHANGELOG.md
git commit -m "chore(release): prepare ${MINT_VERSION}"
git tag -a "v${MINT_VERSION}" -m "Release Mint Notes ${MINT_VERSION}"
```

If the release includes other reviewed files, stage them deliberately. The
tagged commit must already contain the CHANGELOG entry; changes committed after
the tag are not part of that release.

Resolve the build values from the exact tag rather than typing the version into
the build commands:

```bash
MINT_TAG="$(git describe --tags --exact-match)"
MINT_VERSION="$(node scripts/release-version.mjs "$MINT_TAG")"
MINT_REVISION="$(git rev-parse HEAD)"
MINT_IMAGE="gouou7/mint-notes"
MINT_BUILDER="mint-notes-release"

test -z "$(git status --short)"
test "$MINT_TAG" = "v${MINT_VERSION}"
```

The validation script accepts stable `vMAJOR.MINOR.PATCH` tags only and
requires the matching dated CHANGELOG heading.

## Run the release checks

Run the full checks with the derived version injected into the browser build:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
APP_VERSION="$MINT_VERSION" pnpm build
pnpm test:crypto-worker
pnpm test:smoke
docker compose config
```

Do not continue if any command fails.

## Build and smoke-test the local image

Build the workstation's native platform and load it into the local Docker image
store:

```bash
docker buildx build \
  --builder "$MINT_BUILDER" \
  --pull \
  --load \
  --build-arg "APP_VERSION=$MINT_VERSION" \
  --build-arg "VCS_REF=$MINT_REVISION" \
  --tag "$MINT_IMAGE:${MINT_VERSION}-local" \
  .
```

Run the image on a disposable local port:

```bash
docker run --rm --detach \
  --name mint-notes-release-check \
  --publish 127.0.0.1:18787:8787 \
  --env HOST=0.0.0.0 \
  --env PORT=8787 \
  --env APP_ORIGIN=http://localhost:18787 \
  "$MINT_IMAGE:${MINT_VERSION}-local"

curl --fail --retry 20 --retry-delay 1 --retry-connrefused \
  http://127.0.0.1:18787/api/health
docker logs mint-notes-release-check
docker rm --force mint-notes-release-check
```

The expected health response is `{"ok":true}`. Also open
`http://localhost:18787` and complete a short browser smoke test covering
registration or login, vault unlock, note editing, refresh, and an image
attachment.

Confirm the local image labels:

```bash
docker image inspect "$MINT_IMAGE:${MINT_VERSION}-local" \
  --format '{{ index .Config.Labels "org.opencontainers.image.version" }}'
docker image inspect "$MINT_IMAGE:${MINT_VERSION}-local" \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

The outputs must equal `$MINT_VERSION` and `$MINT_REVISION`.

## Push the source commit and Git tag

Make the exact source used for the image available before publishing the
container:

```bash
git push origin main
git push origin "$MINT_TAG"
```

If the Tag-triggered GitHub Actions publisher remains enabled and configured,
the second command starts it. In that case, stop here and let automation own
the registry publication instead of running the manual push below.

## Build and push the multi-platform image

Authenticate interactively. Prefer a Docker Hub access token or browser/device
flow instead of entering a password directly in shell history:

```bash
docker login
```

Build both target platforms and push the exact version and `latest` tags:

```bash
docker buildx build \
  --builder "$MINT_BUILDER" \
  --platform linux/amd64,linux/arm64 \
  --pull \
  --build-arg "APP_VERSION=$MINT_VERSION" \
  --build-arg "VCS_REF=$MINT_REVISION" \
  --tag "$MINT_IMAGE:$MINT_VERSION" \
  --tag "$MINT_IMAGE:latest" \
  --push \
  .
```

Do not combine a multi-platform build with `--load`; the local Docker image
store can load only one platform at a time. `--push` publishes the manifest and
both platform-specific images directly from the Buildx builder.

## Verify the published image

Inspect both registry tags:

```bash
docker buildx imagetools inspect "$MINT_IMAGE:$MINT_VERSION"
docker buildx imagetools inspect "$MINT_IMAGE:latest"
```

Both outputs must list `linux/amd64` and `linux/arm64`, and both tags must
resolve to the image just built. Record the Git commit, Git tag, image version
tag, and registry digest in the release notes.

Deploy the immutable version tag to a test environment and follow the
[deployment acceptance checks](DEPLOYMENT.md#deployment-acceptance-checks).
Production deployments should pin the exact version or registry digest rather
than relying on `latest`.

## Recover from a failed publication

- If the build fails before publication completes, fix the cause and rerun the
  same build only when no public version image was created.
- Do not move an already pushed Git tag to another commit.
- If a version tag is already public but contains invalid application code, do
  not silently replace or delete it. Publish a corrected patch version so
  existing deployments remain traceable.
- If only `latest` must be moved back urgently, repoint it to a previously
  verified immutable image without rebuilding:

```bash
MINT_IMAGE="gouou7/mint-notes"
MINT_PREVIOUS_VERSION="0.3.0"

docker buildx imagetools create \
  --tag "$MINT_IMAGE:latest" \
  "$MINT_IMAGE:$MINT_PREVIOUS_VERSION"
docker buildx imagetools inspect "$MINT_IMAGE:latest"
```

Moving `latest` does not roll back a running deployment automatically. Follow
the backup and upgrade boundaries in the [deployment guide](DEPLOYMENT.md) and
[backup and restore guide](BACKUP_AND_RESTORE.md).

## Official tool references

- [Docker multi-platform builds](https://docs.docker.com/build/building/multi-platform/)
- [`docker buildx build` reference](https://docs.docker.com/reference/cli/docker/buildx/build/)
- [`docker buildx imagetools` reference](https://docs.docker.com/reference/cli/docker/buildx/imagetools/)
- [`docker login` reference](https://docs.docker.com/reference/cli/docker/login/)
