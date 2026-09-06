# Mint Notes

<p align="center">
  <img src="public/icon.svg" alt="Mint Notes" width="128" height="128">
</p>

Mint Notes 是一款自托管的轻量 Markdown 笔记应用，支持多用户、PWA 离线编辑和跨设备同步。

## 主要能力

- **Markdown 编辑：**提供实时、源码和阅读三种模式，支持 GFM、数学公式、Mermaid、WikiLink、Callout 与 YAML Front Matter。
- **笔记整理：**支持文件夹、搜索、排序、固定、笔记锁、回收站、加密历史和图片附件。
- **本地优先：**编辑内容先加密写入浏览器的 IndexedDB，离线时仍可继续使用，恢复网络后在后台同步。
- **账户与恢复：**支持多用户、恢复密钥、已记住设备和可选的本地 PIN。
- **数据迁移：**可以导入或导出 Markdown 与 ZIP，并保留目录结构和附件。
- **简单部署：**React／TypeScript 客户端与 Fastify／SQLite 服务端打包在同一容器中，无需额外部署数据库或对象存储。

## Docker 快速开始

生产部署需要 Docker Engine、Docker Compose v2、HTTPS 域名和反向代理。

1. 复制环境变量模板：

   ```bash
   cp .env.example .env
   ```

2. 编辑 `.env`，将 `APP_ORIGIN` 改为用户实际访问的 HTTPS 源，例如 `https://notes.example.com`。Linux 用户还应让 `PUID`、`PGID` 与 `notes-data` 目录的所有者一致。

3. 创建数据目录并启动服务：

   ```bash
   mkdir -p notes-data
   docker compose config
   docker compose up --build -d
   docker compose ps
   ```

Compose 默认仅在主机的 `127.0.0.1:8787` 监听，请通过 HTTPS 反向代理对外提供服务。第一次打开站点时创建的账户会成为管理员；恢复密钥只显示一次，请立即保存。

投入使用前，建议测试一次明文导出和服务器备份。完整配置、反向代理、升级和恢复流程见[部署指南](docs/deployment.md)。

## 技术概览

- 客户端：React、TypeScript、Vite、ProseMirror、Dexie／IndexedDB
- 服务端：Fastify、SQLite
- 内容处理：Markdown、KaTeX、Mermaid
- 部署：Docker Compose、单容器、非 root 用户

## 本地开发

需要 Node.js 22+，并使用 `package.json#packageManager` 指定的 pnpm 版本（当前为 11.9.0）。

```bash
pnpm install
pnpm dev
```

Vite 默认运行在 `http://localhost:5173`，并将 `/api` 转发到 `http://127.0.0.1:8787` 的 Fastify 服务。

常用检查命令：

| 命令 | 用途 |
| --- | --- |
| `pnpm typecheck` | 检查客户端与服务端 TypeScript |
| `pnpm test` | 运行 Vitest 测试 |
| `pnpm build` | 构建客户端与服务端 |
| `pnpm test:crypto-worker` | 检查加密 Worker；运行前需重新构建 |
| `pnpm test:smoke` | 检查 API；运行前需重新构建 |

## 文档

| 文档 | 内容 |
| --- | --- |
| [使用指南](docs/guide.md) | 账户、编辑器、同步、附件、历史与数据迁移 |
| [部署指南](docs/deployment.md) | 部署、配置、备份、恢复、升级与发布 |
| [系统设计](docs/system-design.md) | 系统结构、数据流、安全保证与限制 |
| [编辑器架构](docs/editor-architecture.md) | Markdown 编辑器的设计原则与验收要求 |
| [变更日志](CHANGELOG.md) | 已发布版本的功能变化 |

## 许可证

Mint Notes 采用 [MIT 许可证](LICENSE)。

## 致谢

- [typora-web](https://github.com/Yuyz0112/typora-web)：编辑器核心的上游项目，采用 MIT 许可证。
- [KaTeX](https://katex.org/)：用于渲染数学公式，采用 MIT 许可证。
- [Mermaid](https://mermaid.js.org/)：用于渲染图表，采用 MIT 许可证。
- [Lucide React](https://lucide.dev/)：用于界面图标，采用 ISC 许可证；其中部分源自 Feather 的图标采用 MIT 许可证。

完整的许可文本见[第三方许可声明](public/THIRD_PARTY_NOTICES.txt)，并随发布包一同提供。
