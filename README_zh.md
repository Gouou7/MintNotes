# Mint Notes

[English](README.md) | 简体中文

Mint Notes 是一款使用 AI 开发的玩具级项目。目标是提供轻量部署、安全储存、简单使用的笔记体验。本项目支持 PWA 自适应布局，采用端到端加密，你可以安全地将笔记服务部署在远程服务器，并使用你熟悉的 Markdown 语法进行笔记编辑。

如果你发现 Bug 或者有功能建议，请提交 Issue，或者向你的 AI Agent 提出修改要求！

## 功能特性

- **本地优先与端到端加密：**输入和本地保存无需等待网络，标题、正文、目录和附件在浏览器中加密后再同步。
- **Markdown 编辑体验：**支持类 Typora 的实时编辑、源码模式、阅读模式、KaTeX 数学公式、Mermaid 图表、WikiLink、可扩展的 Obsidian 风格 Callout、YAML 属性，以及实时大纲和字数统计。
- **笔记组织与历史：**支持文件夹、搜索、排序、拖放、笔记锁定、回收站，以及可预览和恢复的跨设备加密版本历史。
- **多用户与设备安全：**支持多用户账户、恢复密钥、激活码、可离线冷启动的已记住设备、可选的 PIN 加密本机解锁凭据、自动锁定和远程登出。
- **附件与数据迁移：**支持加密图片附件，以及保留目录结构和附件路径的 Markdown／ZIP 导入导出。
- **PWA 与多端同步：**适配桌面、平板和移动端，支持已记住设备离线启动与编辑、联网后延迟同步、主题和多语言界面。
- **轻量自托管：**使用单个 Docker 服务和 SQLite 部署，并提供一致的在线备份流程。

## 技术栈

浏览器应用使用 React、TypeScript、Vite、`typora-web`、Web Crypto 和 Dexie／IndexedDB。

服务器使用 Fastify 和 SQLite。

## 开发

环境要求：

- Node.js 22 或更高版本
- pnpm 11 或更高版本

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:5173`。Vite 会将 `/api` 代理到位于 `http://127.0.0.1:8787` 的 API 服务器。第一个账户会成为管理员，并在注册时获得恢复密钥。

有关项目结构、验证命令和测试依赖，请参阅[开发指南](docs/DEVELOPMENT.md)。

## Docker 快速开始

```bash
cp .env.example .env
mkdir -p notes-data
docker compose config
docker compose up --build -d
docker compose ps
```

启动前，请在 `.env` 中将 `APP_ORIGIN` 设置为用户实际访问的完整 HTTPS 源，例如 `https://notes.example.com`。

在 Linux 上，请将 `PUID` 和 `PGID` 设置为 `./notes-data` 所有者的非零数字用户 ID 和组 ID（通常分别为 `id -u` 和 `id -g` 的输出），以便非 root 容器能够写入 SQLite 文件。

## 首次使用

1. 打开应用并创建第一个账户。该账户始终会被赋予管理员角色。
2. 将显示的恢复密钥保存在密码管理器或受保护的离线位置。恢复密钥只会在创建账户时显示一次。
3. 除非确有需要，否则请保持关闭公开注册。管理员可以在**设置 > 管理员设置**中创建激活码。
4. 在正式依赖此服务前，请分别创建并测试一次明文 Markdown ZIP 导出和加密的服务器备份。

[用户指南](docs/USER_GUIDE.md)涵盖编辑器模式、文件树操作、附件、同步状态、账户恢复、导入／导出和安全删除。

## 文档

请从[文档索引](docs/README.md)按任务选择对应指南。

- **使用 Mint Notes：**[用户指南](docs/USER_GUIDE.md)
- **运维 Mint Notes：**[生产部署](docs/DEPLOYMENT.md)与[备份和恢复](docs/BACKUP_AND_RESTORE.md)
- **参与开发：**[开发指南](docs/DEVELOPMENT.md)；架构与安全资料可从文档索引进入

## 致谢

感谢以下开源项目:

- Markdown 编辑器：[typora-web](https://github.com/Yuyz0112/typora-web)
- 数学公式渲染：[KaTeX](https://katex.org/)
- 图表渲染：[Mermaid](https://mermaid.js.org/)
- 图标包：[Lucide React](https://lucide.dev/)

## 许可证

Mint Notes 使用 [MIT 许可证](LICENSE)发布。
