# 部署指南

[返回项目说明](../README.md)

本文记录当前版本支持的 Docker Compose 与 pnpm 部署方式，以及生产配置、反向代理、备份、恢复、升级和镜像发布流程。命令与配置应始终和实际发布保持一致；尚未支持的部署设想不要当作现有方案写入本指南。

无论选择哪种方式，生产环境都必须通过 HTTPS 反向代理访问，并让应用服务只监听回环地址或受保护的内部网络。

## Docker Compose 部署

Docker Compose 会以单个非 root 容器运行 Mint Notes，SQLite 数据保存在主机的 `notes-data` 目录，并挂载到容器的 `/data`。

1. 复制环境变量模板：

   ```bash
   cp .env.example .env
   ```

2. 编辑 `.env`，至少将 `APP_ORIGIN` 改为用户实际访问的 HTTPS 源。Linux 用户还应让 `PUID`、`PGID` 与 `notes-data` 目录的所有者一致，且不得为 `0`；不要让数据目录全局可写。

3. 创建数据目录、检查配置并启动：

   ```bash
   mkdir -p notes-data
   docker compose config
   docker compose up --build -d
   docker compose ps
   ```

Compose 默认仅在主机的 `127.0.0.1:8787` 监听。主机健康检查地址为 `http://127.0.0.1:8787/api/health`，预期返回 `{"ok":true}`。

## pnpm 部署

pnpm 部署直接在主机上构建并运行 Node.js 服务，不使用容器。需要 Node.js 22+、`package.json#packageManager` 指定的 pnpm 版本，以及编译 `better-sqlite3` 时可能用到的 Python 3、Make 和 C/C++ 编译器。应使用独立的非 root 服务账户，并固定部署目录。

仓库使用 `pnpm-lock.yaml` 锁定依赖。可通过 Corepack 启用项目指定的 pnpm 版本，不要改用其他包管理器安装依赖。

1. 检出准确的稳定版本标签，在项目根目录安装依赖并构建：

   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   APP_VERSION="$(node scripts/release-version.mjs "$(git describe --tags --exact-match)")" pnpm build
   pnpm prune --prod
   ```

2. 创建 `/data`，并只授予运行 Mint Notes 的服务账户读写权限。`NODE_ENV=production` 时，SQLite 数据固定保存在 `/data/notes.sqlite`。

3. 从项目根目录启动服务，确保相对路径 `dist` 和 `server-dist` 指向本次构建产物：

   ```bash
   NODE_ENV=production \
   HOST=127.0.0.1 \
   PORT=8787 \
   APP_ORIGIN=https://notes.example.com \
   pnpm start
   ```

直接运行时不会自动读取仓库中的 `.env`。请通过 systemd、Supervisor 或其他进程管理器注入环境变量、设置项目根目录为工作目录，并配置异常退出后自动重启。不要以 root 身份运行应用。

健康检查地址同样是 `http://127.0.0.1:8787/api/health`，预期返回 `{"ok":true}`。

## 生产配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | 无 | pnpm 部署必须设为 `production`；Docker 镜像已内置。 |
| `PUID` / `PGID` | `1000` | 仅用于 Docker Compose，指定容器用户与组。 |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | pnpm 部署的监听地址与端口；Compose 在容器内覆盖为 `0.0.0.0`，主机仍只暴露回环地址。 |
| `APP_ORIGIN` | 无 | 生产必填，必须是精确匹配公开源的 HTTPS URL，不能含路径或末尾斜杠。 |
| `ALLOW_REGISTRATION` | `false` | 首个管理员之后是否公开注册。 |
| `MAX_ATTACHMENT_SIZE_MB` | `25` | 服务端限制；内置客户端仍固定为 25 MiB。 |
| `USER_STORAGE_QUOTA_MB` | `2048` | 对象修订与附件分块的每用户配额。 |
| `USER_HISTORY_QUOTA_MB` | `256` | 独立历史配额。 |
| `SESSION_TTL_HOURS` | `168` | 普通会话寿命。 |
| `TRUST_PROXY` | `false` | 仅在受控反向代理后开启。 |
| `LOG_LEVEL` | `info` | `trace` 至 `fatal`、`silent`。 |

Docker 部署在 `.env` 中填写这些变量；pnpm 部署通过进程管理器注入。不要在任何环境文件中保存主密码、恢复密钥或保险库密钥。

服务会在启动时严格校验端口、容量、会话时长和布尔开关；无效值会直接阻止启动，避免悄悄退回不符合预期的配置。生产模式缺少有效 `APP_ORIGIN` 时同样拒绝启动。

## 反向代理与日志

以 [`deploy/nginx.conf.example`](../deploy/nginx.conf.example) 为起点，替换域名和证书路径。代理必须保留 Host 与协议；`APP_ORIGIN` 必须等于用户访问的完整 URL。应用服务会协商压缩文本响应，对带内容哈希的静态资源发送一年不可变缓存，对应用入口和 Service Worker 要求重新验证；反向代理不应覆盖这些响应头。`/api/sync/events` 是 SSE 长连接，应关闭代理缓冲与缓存并保留较长超时。流中断只会降低同步及时性。

生产日志写入 stdout，使用 JSON。Docker 部署可直接查看：

```bash
docker compose logs --tail=100 notes
```

pnpm 部署应由进程管理器收集和轮转 stdout／stderr。日志保留由 Docker、进程管理器或主机负责；允许记录的内容与运维责任见[系统设计](system-design.md#日志与运维责任)。

首次打开站点创建管理员并保存恢复密钥。公开注册通常保持关闭；其他用户使用管理员生成的 72 小时一次性激活码。

## 备份

备份必须同时覆盖两层：服务器密文数据库用于恢复账户与同步状态，用户侧明文 Markdown ZIP 用于可移植恢复；恢复密钥应另行保存。

SQLite 使用 WAL，禁止直接复制运行中的 `notes.sqlite`。Docker 部署使用：

```bash
docker compose exec notes pnpm backup
docker compose cp notes:/data/backups/mint-notes-YYYY-MM-DDTHH-MM-SS-sssZ.sqlite ./backups/
```

pnpm 部署应从项目根目录、以应用服务账户运行：

```bash
NODE_ENV=production pnpm backup
```

pnpm 部署默认把备份写入 `/data/backups`；可通过 `BACKUP_DIR` 指定另一个由服务账户可写的目录。备份命令会输出文件路径和 SHA-256；复制后应再次核对摘要，并在应用数据目录之外保存至少一份加密副本。可从每日 7 份、每周 4 份、每月 12 份开始，再按恢复目标调整。

## 恢复与升级

先在隔离环境演练：停止服务，将已校验备份作为 `/data/notes.sqlite` 放入空数据目录，启动后验证健康检查、多个账户登录、恢复密钥重置、同步、附件、历史、管理员隔离与新备份。只打开数据库或通过健康检查不代表数据可恢复。

替换生产数据前先做最后一次在线备份并停止服务；完成验证前保留旧数据。Docker 部署应停止 Compose 服务后替换挂载目录中的数据库；pnpm 部署应通过进程管理器停止服务后替换 `/data/notes.sqlite`。不要手工修改 `PRAGMA user_version`。

升级 Docker 部署时，先备份，再更新 `docker-compose.yml` 中固定的镜像版本或摘要，拉取镜像并重新启动。升级 pnpm 部署时，先备份并准备新的稳定标签，在独立目录完成 `pnpm install --frozen-lockfile`、构建和 `pnpm prune --prod`，停止旧进程后切换工作目录并启动新版本；确认恢复正常前保留旧构建目录。

当前版本只支持服务器 schema v2 和浏览器数据库 `webmd-notes-v2`，不会迁移 v2 之前的数据。升级不兼容旧版本时，应从旧部署导出完整 Markdown ZIP、创建在线备份，再以全新 `/data` 启动并导入。启用历史保护或 v2 用户名信封后，不得回滚到不了解相应格式的版本；需要整体回退时恢复升级前备份。

## 发布镜像

稳定 Git 标签 `vMAJOR.MINOR.PATCH` 是应用版本的唯一来源，`package.json` 中的 `0.0.0` 不是发布版本。发布前应在 `CHANGELOG.md` 中加入带日期的对应版本，并在准确的标签上运行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
APP_VERSION="$(node scripts/release-version.mjs "$(git describe --tags --exact-match)")" pnpm build
pnpm test:crypto-worker
pnpm test:smoke
docker compose config
```

官方镜像同时发布 `linux/amd64`、`linux/arm64` 的不可变版本标签与 `latest`；生产应固定版本或摘要。已公开标签不得移动，失败版本应发布补丁版本。
