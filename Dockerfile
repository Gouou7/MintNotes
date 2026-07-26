ARG APP_VERSION=development
ARG VCS_REF=unknown

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
ARG APP_VERSION
ENV npm_config_nodedir=/usr/local
ENV UV_USE_IO_URING=0
ENV APP_VERSION=$APP_VERSION
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN set -eu; \
  status=0; \
  pnpm install --frozen-lockfile || status=$?; \
  if [ "$status" -ne 0 ] && [ "$status" -ne 134 ]; then exit "$status"; fi; \
  test -f node_modules/.modules.yaml; \
  test -e node_modules/better-sqlite3
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS prod-deps
ENV npm_config_nodedir=/usr/local
ENV UV_USE_IO_URING=0
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN set -eu; \
  status=0; \
  pnpm install --frozen-lockfile --prod || status=$?; \
  if [ "$status" -ne 0 ] && [ "$status" -ne 134 ]; then exit "$status"; fi; \
  test -e node_modules/better-sqlite3; \
  test ! -e node_modules/vitest; \
  apt-get purge -y --auto-remove python3 make g++

FROM node:22-bookworm-slim AS runtime
ARG APP_VERSION
ARG VCS_REF
ENV NODE_ENV=production
ENV UV_USE_IO_URING=0
WORKDIR /app
LABEL org.opencontainers.image.title="Mint Notes" \
  org.opencontainers.image.description="Local-first end-to-end encrypted Markdown notes" \
  org.opencontainers.image.source="https://github.com/Gouou7/MintNotes" \
  org.opencontainers.image.revision=$VCS_REF \
  org.opencontainers.image.version=$APP_VERSION
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 8787
CMD ["node", "server-dist/index.js"]
