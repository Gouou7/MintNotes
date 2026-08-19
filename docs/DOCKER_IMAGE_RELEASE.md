# 在本地构建并发布 Docker 镜像

[文档索引](README.md)

本指南面向从本地工作站手动构建并发布官方 `gouou7/mint-notes` 镜像的 Mint Notes 维护者。流程会构建一个同时支持 `linux/amd64` 和 `linux/arm64` 的多平台镜像，使用从当前 Git 标签派生的版本和 `latest` 标记，并把两个标签推送到 Docker Hub。

该工作流用于发布镜像，不能替代[生产部署](DEPLOYMENT.md)、升级、备份或恢复流程。只能从干净、已审查的发布提交构建。

> 仓库还包含由标签触发的 GitHub Actions 发布器 `.github/workflows/release-docker.yml`。同一版本不得同时使用两条发布路径。本指南假定本次手动发布未启用或配置自动发布器。

## 版本来源

当前准确 Git 标签是应用发布版本的唯一来源。例如标签 `v0.4.0` 会派生 `0.4.0`，用于：

- **设置 > 关于**中显示的版本；
- OCI `org.opencontainers.image.version` 标签；
- 不可变 Docker 标签 `gouou7/mint-notes:0.4.0`；
- 浮动 Docker 标签 `gouou7/mint-notes:latest`。

`package.json` 有意保留私有包占位版本 `0.0.0`；它不是应用发布记录。普通源码构建显示 `development`，除非显式提供 `APP_VERSION`。

不要仅因应用版本增加就更改以下值：

- `server/database.ts` 中的数据库架构版本；
- `src/storage/` 下的 IndexedDB／Dexie 版本；
- 对象、历史、附件、密钥信封或加密版本；
- 工作区、导入／导出或可移植负载架构版本；
- 导入编辑器核心的来源或其直接 ProseMirror／Markdown 依赖；
- `docker-compose.yml` 或 `/data` 布局。

这些值描述兼容性或数据格式，需要各自的实现、迁移、安全审查、测试和文档。

## 本地前置条件

安装或准备：

- Node.js 22 或更高版本；
- `package.json` 声明的 pnpm 版本；
- Docker Engine 或 Docker Desktop；
- 支持 `linux/amd64` 和 `linux/arm64` 的 QEMU／binfmt Docker Buildx；
- 对 `gouou7/mint-notes` 有写权限的 Docker Hub 账户。

确认本地工具与守护进程：

```bash
node --version
pnpm --version
docker version
docker buildx version
```

macOS 上，Docker Desktop 通常包含 Buildx 和模拟支持。Colima 应在启用 binfmt 的情况下启动：

```bash
colima start --runtime docker --cpus 4 --memory 8 --disk 100 --binfmt
docker context use colima
```

一次性创建容器驱动构建器：

```bash
MINT_BUILDER="mint-notes-release"

docker buildx create \
  --name "$MINT_BUILDER" \
  --driver docker-container \
  --bootstrap \
  --use
docker buildx inspect --bootstrap
```

后续发布选择现有构建器：

```bash
MINT_BUILDER="mint-notes-release"

docker buildx use "$MINT_BUILDER"
docker buildx inspect --bootstrap
```

检查输出必须同时列出 `linux/amd64` 和 `linux/arm64`。任一平台不可用时，都不得发布不完整的 `latest` 镜像。

## 准备发布提交与标签

使用 `0.4.0` 之类稳定语义版本。把 `CHANGELOG.md` 中 `[未发布]` 的相关条目移到带日期标题下，并在顶部保留 `[未发布]`：

```markdown
## [未发布]

## [0.4.0] - 2026-07-26
```

提交全部已审查发布内容和变更日志，再创建带注解的本地标签：

```bash
MINT_VERSION="0.4.0"

git status --short
git diff --check
git add CHANGELOG.md
git commit -m "chore(release): prepare ${MINT_VERSION}"
git tag -a "v${MINT_VERSION}" -m "Release Mint Notes ${MINT_VERSION}"
```

如果发布包含其他已审查文件，请有意暂存。带标签的提交必须已经包含变更日志条目；标签之后提交的变化不属于该版本。

从准确标签解析构建值，不要在构建命令中手输版本：

```bash
MINT_TAG="$(git describe --tags --exact-match)"
MINT_VERSION="$(node scripts/release-version.mjs "$MINT_TAG")"
MINT_REVISION="$(git rev-parse HEAD)"
MINT_IMAGE="gouou7/mint-notes"
MINT_BUILDER="mint-notes-release"

test -z "$(git status --short)"
test "$MINT_TAG" = "v${MINT_VERSION}"
```

验证脚本只接受稳定 `vMAJOR.MINOR.PATCH` 标签，并要求变更日志中存在匹配的带日期标题。

## 运行发布检查

把派生版本注入浏览器构建，并运行完整检查：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
APP_VERSION="$MINT_VERSION" pnpm build
pnpm test:crypto-worker
pnpm test:smoke
docker compose config
```

任何命令失败都不得继续。

## 构建并冒烟测试本地镜像

构建工作站原生平台并加载到本地 Docker 镜像存储：

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

在一次性本地端口运行镜像：

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

预期健康响应为 `{"ok":true}`。还应打开 `http://localhost:18787`，完成简短浏览器冒烟测试，覆盖注册或登录、保险库解锁、笔记编辑、刷新和图片附件。

确认本地镜像标签：

```bash
docker image inspect "$MINT_IMAGE:${MINT_VERSION}-local" \
  --format '{{ index .Config.Labels "org.opencontainers.image.version" }}'
docker image inspect "$MINT_IMAGE:${MINT_VERSION}-local" \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

输出必须分别等于 `$MINT_VERSION` 和 `$MINT_REVISION`。

## 推送源码提交与 Git 标签

发布容器前，先让镜像所用的准确源码可用：

```bash
git push origin main
git push origin "$MINT_TAG"
```

如果由标签触发的 GitHub Actions 发布器仍已启用并配置，第二条命令会启动它。此时在这里停止，让自动化负责镜像仓库发布，不要再执行下方手动推送。

## 构建并推送多平台镜像

交互式认证。建议使用 Docker Hub 访问令牌或浏览器／设备流程，不要把密码直接写入 Shell 历史：

```bash
docker login
```

构建两个目标平台，并推送准确版本与 `latest` 标签：

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

不要把多平台构建与 `--load` 结合；本地 Docker 镜像存储一次只能加载一个平台。`--push` 会直接从 Buildx 构建器发布清单和两个平台镜像。

## 验证已发布镜像

检查两个镜像仓库标签：

```bash
docker buildx imagetools inspect "$MINT_IMAGE:$MINT_VERSION"
docker buildx imagetools inspect "$MINT_IMAGE:latest"
```

两个输出都必须列出 `linux/amd64` 和 `linux/arm64`，并且两个标签都要指向刚构建的镜像。在发布说明中记录 Git 提交、Git 标签、镜像版本标签和镜像仓库摘要。

把不可变版本标签部署到测试环境，并执行[部署验收检查](DEPLOYMENT.md#部署验收检查)。生产部署应固定准确版本或镜像仓库摘要，而不是依赖 `latest`。

## 从发布失败中恢复

- 如果构建在发布完成前失败，修复原因；只有未创建公开版本镜像时，才能重新执行相同构建。
- 不得把已经推送的 Git 标签移到另一提交。
- 如果版本标签已经公开但包含无效应用代码，不要静默替换或删除。发布修正补丁版本，让现有部署保持可追溯。
- 如果只需紧急回退 `latest`，无需重新构建，可把它重新指向之前已验证的不可变镜像：

```bash
MINT_IMAGE="gouou7/mint-notes"
MINT_PREVIOUS_VERSION="0.3.0"

docker buildx imagetools create \
  --tag "$MINT_IMAGE:latest" \
  "$MINT_IMAGE:$MINT_PREVIOUS_VERSION"
docker buildx imagetools inspect "$MINT_IMAGE:latest"
```

移动 `latest` 不会自动回滚正在运行的部署。请遵循[部署指南](DEPLOYMENT.md)和[备份与恢复指南](BACKUP_AND_RESTORE.md)中的备份与升级边界。

## 官方工具参考

- [Docker 多平台构建](https://docs.docker.com/build/building/multi-platform/)
- [`docker buildx build` 参考](https://docs.docker.com/reference/cli/docker/buildx/build/)
- [`docker buildx imagetools` 参考](https://docs.docker.com/reference/cli/docker/buildx/imagetools/)
- [`docker login` 参考](https://docs.docker.com/reference/cli/docker/login/)
