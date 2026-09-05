# 自托管指南

[返回项目说明](../README.md)

本文记录当前版本支持的部署、配置、备份、恢复和升级方式。命令与配置应始终和实际发布保持一致；尚未支持的部署设想不要当作现有方案写入本指南。

Mint Notes 以单个非 root 容器运行，SQLite 数据固定在容器 `/data`。生产环境必须通过 HTTPS 反向代理访问，默认 Compose 仅监听主机 `127.0.0.1:8787`。

## 配置与启动

```bash
cp .env.example .env
mkdir -p notes-data
docker compose config
docker compose up --build -d
docker compose ps
```

Linux 上应让 `PUID`、`PGID` 与 `notes-data` 所有者一致，且不得为 `0`；不要让数据目录全局可写。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` | 容器用户与组。 |
| `HOST` / `PORT` | `0.0.0.0` / `8787` | Compose 内部监听地址与端口。 |
| `APP_ORIGIN` | 无 | 生产必填，必须精确匹配公开源。 |
| `ALLOW_REGISTRATION` | `false` | 首个管理员之后是否公开注册。 |
| `MAX_ATTACHMENT_SIZE_MB` | `25` | 服务端限制；内置客户端仍固定为 25 MiB。 |
| `USER_STORAGE_QUOTA_MB` | `2048` | 对象修订与附件分块的每用户配额。 |
| `USER_HISTORY_QUOTA_MB` | `256` | 独立历史配额。 |
| `SESSION_TTL_HOURS` | `168` | 普通会话寿命。 |
| `TRUST_PROXY` | `false` | 仅在受控反向代理后开启。 |
| `LOG_LEVEL` | `info` | `trace` 至 `fatal`、`silent`。 |

不要在 `.env` 中保存主密码、恢复密钥或保险库密钥。主机健康检查地址为 `http://127.0.0.1:8787/api/health`，预期返回 `{"ok":true}`。

## 反向代理与日志

以 [`deploy/nginx.conf.example`](../deploy/nginx.conf.example) 为起点，替换域名和证书路径。代理必须保留 Host 与协议；`APP_ORIGIN` 必须等于用户访问的完整 URL。`/api/sync/events` 是 SSE 长连接，应关闭代理缓冲与缓存并保留较长超时。流中断只会降低同步及时性。

生产日志写入 stdout，使用 JSON；查看命令：

```bash
docker compose logs --tail=100 notes
```

日志保留由 Docker 或主机负责；允许记录的内容与运维责任见[系统设计](system-design.md#日志与运维责任)。

首次打开站点创建管理员并保存恢复密钥。公开注册通常保持关闭；其他用户使用管理员生成的 72 小时一次性激活码。

## 备份

备份必须同时覆盖两层：服务器密文数据库用于恢复账户与同步状态，用户侧明文 Markdown ZIP 用于可移植恢复；恢复密钥应另行保存。

SQLite 使用 WAL，禁止直接复制运行中的 `notes.sqlite`。在线备份命令为：

```bash
docker compose exec notes pnpm backup
docker compose cp notes:/data/backups/mint-notes-YYYY-MM-DDTHH-MM-SS-sssZ.sqlite ./backups/
```

命令会输出文件路径和 SHA-256；复制后应再次核对摘要，并在应用卷之外保存至少一份加密副本。可从每日 7 份、每周 4 份、每月 12 份开始，再按恢复目标调整。

## 恢复与升级

先在隔离环境演练：停止服务，将已校验备份作为 `/data/notes.sqlite` 放入空卷，启动后验证健康检查、多个账户登录、恢复密钥重置、同步、附件、历史、管理员隔离与新备份。只打开数据库或通过健康检查不代表数据可恢复。

替换生产卷前先做最后一次在线备份并停止服务；完成验证前保留旧卷。不要手工修改 `PRAGMA user_version`。

当前版本只支持服务器 schema v2 和浏览器数据库 `webmd-notes-v2`，不会迁移 v2 之前的数据。升级不兼容旧版本时，应从旧部署导出完整 Markdown ZIP、创建在线备份，再以全新 `/data` 启动并导入。启用历史保护或 v2 用户名信封后，不得回滚到不了解相应格式的版本；需要整体回退时恢复升级前备份。

## 发布镜像

应用版本唯一来源是稳定 Git 标签 `vMAJOR.MINOR.PATCH`，`package.json` 的 `0.0.0` 不是发布版本。发布标签对应的 `CHANGELOG.md` 必须含带日期版本标题。开发与发布检查见[项目说明](../README.md#开发与发布)。官方镜像同时发布 `linux/amd64`、`linux/arm64` 的不可变版本标签与 `latest`；生产应固定版本或摘要。已公开标签不得移动，失败版本应发布补丁版本。
