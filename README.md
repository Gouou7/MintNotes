# Mint Notes

Mint Notes 是一款轻量、可自托管的多用户 Markdown 笔记 PWA，也是一个使用 AI 开发的玩具级项目。编辑内容会先在浏览器中加密保存，再由后台同步；服务器只保存无法直接读取的密文。

## 主要能力

- 提供实时、源码和阅读三种编辑模式，支持数学公式、Mermaid、WikiLink、Callout 与 YAML 属性。
- 可以用文件夹、搜索、排序和固定功能整理笔记，并提供笔记锁、回收站、加密历史与图片附件。
- 支持多用户、恢复密钥、已记住设备、可选的本地 PIN、离线编辑和后台同步。
- 可以导入或导出 Markdown 与 ZIP，并保留目录结构和附件。
- 客户端采用 React 和 TypeScript，服务端采用 Fastify 和 SQLite，无需额外部署数据库或对象存储。

## Docker 快速开始

需要 Docker Engine、Docker Compose v2、HTTPS 域名和反向代理。

```bash
cp .env.example .env
mkdir -p notes-data
docker compose config
docker compose up --build -d
```

在 `.env` 中把 `APP_ORIGIN` 改为实际 HTTPS 源；Linux 用户还应让 `PUID`、`PGID` 与 `notes-data` 所有者一致。打开站点后，第一个账户会成为管理员。恢复密钥只显示一次，请立即保存；投入使用前应测试一次明文导出和服务器备份。

完整配置、反向代理、升级和恢复流程见[自托管指南](docs/self-hosting.md)。

## 开发与发布

本地开发需要 Node.js 22+，并使用 `package.json` 指定的 pnpm 版本（当前为 11.9.0）：

```bash
pnpm install
pnpm dev
```

Vite 默认运行在 `http://localhost:5173`，并将 `/api` 转发到 `http://127.0.0.1:8787` 的 Fastify 服务。提交代码前至少运行 `pnpm typecheck` 和 `pnpm test`；涉及生产构建时再运行 `pnpm build`。加密 Worker 和 API 的集成检查依赖构建产物，应在构建后分别运行 `pnpm test:crypto-worker` 和 `pnpm test:smoke`。

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

镜像发布及升级注意事项见[自托管指南](docs/self-hosting.md#发布镜像)。

## 文档

- [使用指南](docs/guide.md)：当前已经提供的功能，以及账户、编辑器、同步、附件、历史和数据迁移的实际行为。
- [自托管指南](docs/self-hosting.md)：部署、配置、备份、恢复与升级。
- [架构概览](docs/system-design.md)与[安全模型](docs/trust-and-security.md)：当前的数据流、信任边界与实现保证。
- [编辑器架构原则](docs/editor-architecture.md)：编辑器需要长期遵守的状态、事务和扩展边界。
- [变更日志](CHANGELOG.md)

## 许可证

Mint Notes 采用 [MIT 许可证](LICENSE)。

## 致谢

- [typora-web](https://github.com/Yuyz0112/typora-web)：编辑器核心的上游项目，采用 MIT 许可证。
- [KaTeX](https://katex.org/)：用于渲染数学公式，采用 MIT 许可证。
- [Mermaid](https://mermaid.js.org/)：用于渲染图表，采用 MIT 许可证。
- [Lucide React](https://lucide.dev/)：用于界面图标，采用 ISC 许可证；其中部分源自 Feather 的图标采用 MIT 许可证。

完整的许可文本见[第三方许可声明](public/THIRD_PARTY_NOTICES.txt)，并随发布包一同提供。
