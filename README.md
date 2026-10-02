# Mint Notes

<p align="center">
  <img src="public/icon.svg" alt="Mint Notes" width="128" height="128">
</p>

Mint Notes 是一款自托管的轻量 Markdown 笔记应用，支持多用户、PWA 离线编辑和跨设备同步。

## 主要能力

- **Markdown 编辑：**实时、源码与阅读三种模式，支持 GFM、数学公式、Mermaid、WikiLink、Callout、YAML Front Matter 与 HTTPS 外部图片。
- **笔记整理：**文件夹、搜索、排序、固定、笔记锁、回收站、加密历史与图片附件。
- **本地优先：**内容先加密写入浏览器的 IndexedDB，离线仍可使用，恢复网络后后台同步。
- **账户与恢复：**多用户、恢复密钥、已记住设备与可选本地 PIN；保险库指该账户的加密笔记数据。
- **数据迁移：**导入、导出 Markdown 与 ZIP，保留目录结构和附件；重名自动编号，缺失图片等问题在导入结果中列出。

## Docker 快速开始

生产部署需要 Docker Engine、Docker Compose v2、HTTPS 域名和反向代理。

```bash
cp .env.example .env
mkdir -p notes-data
docker compose config
docker compose up --build -d
docker compose ps
```

`.env` 默认值适用于标准 HTTPS 反向代理方案，通常无需修改；Linux 用户应让 `PUID`、`PGID` 与 `notes-data` 目录的所有者一致。Compose 默认只在主机的 `127.0.0.1:8787` 监听，请按[反向代理示例](deploy/nginx.conf.example)配置域名和证书，通过 HTTPS 对外提供服务。

首次打开站点时创建的账户即为管理员，恢复密钥只显示一次，请立即保存；参数含义、升级与恢复流程见[部署指南](docs/deployment.md)。

## 数据安全提示

- **恢复密钥**：保存到密码管理器或受保护的离线位置；忘记主密码且没有恢复密钥时，无法恢复保险库。
- **导出与备份**：导出结果是明文，应保存到可信或另行加密的位置；服务器备份方法见[部署指南](docs/deployment.md#备份)。
- **本地数据**：锁定保留本地密文与待同步更改；登出会删除当前账户的浏览器数据，清除站点数据也可能丢失尚未同步的唯一副本。出现本地保存失败警告时，不要关闭保险库或清除数据。
- **应用更新**：激活 PWA 新版本前，先确认最新编辑已保存到本地。

## 技术概览

- 客户端：React、TypeScript、Vite、ProseMirror、Dexie／IndexedDB
- 服务端：Fastify、SQLite
- 内容处理：Markdown、KaTeX、Mermaid
- 部署与浏览器：Docker Compose 单容器、非 root 运行；需支持 Web Crypto 与 IndexedDB，已适配 iPhone／iPadOS Safari 与 PWA 安装模式

## 本地开发

需要 Node.js 22+，以及 `package.json#packageManager` 指定的 pnpm 版本（当前为 11.9.0）。

```bash
pnpm install
pnpm dev
```

Vite 默认运行在 `http://localhost:5173`，并将 `/api` 转发到 `http://127.0.0.1:8787` 的 Fastify 服务。常用检查命令为 `pnpm typecheck`、`pnpm test` 与 `pnpm build`；`pnpm test:crypto-worker`、`pnpm test:smoke` 分别检查加密 Worker 与 API，运行前需重新构建。

## 文档

| 文档 | 内容 |
| --- | --- |
| [部署指南](docs/deployment.md) | 部署、配置、备份、恢复、升级与发布 |
| [系统设计](docs/system-design.md) | 已采纳的系统架构、数据流、安全边界与设计约束 |
| [编辑器架构](docs/editor-architecture.md) | Markdown 编辑器的设计原则与验收要求 |
| [变更日志](CHANGELOG.md) | 未发布与已发布版本的新增、调整和修复 |

问题与建议请提交到 [GitHub Issues](https://github.com/Gouou7/MintNotes/issues)。

## 常见问题

- **忘记主密码或恢复密钥**：没有恢复密钥就无法恢复保险库，请把恢复密钥存入密码管理器。
- **一直显示同步中**：本地保存不等待网络；先确认设备在线，再检查服务器健康检查与反向代理的服务器发送事件（SSE）配置。
- **更新后界面异常**：先确认编辑已保存，再刷新页面；iOS 主屏幕应用可能需要重新添加，操作前先同步并导出。
- **附件上传被拒绝**：客户端单图上限为 25 MiB，服务端上限由 `MAX_ATTACHMENT_SIZE_MB` 决定；图片格式与用户配额同样受限。
- **显示外部图片**：在正文中写入 `![图片说明](https://example.com/image.png)`，实时和阅读模式会显示图片；需要图片站点允许外部加载，离线可用性与隐私边界见[系统设计](docs/system-design.md#外部图片显示)。
- **离线无法登录**：已记住设备可离线打开本地保险库（有 PIN 时先解锁），未记住的设备必须联网验证。

## 许可证

Mint Notes 采用 [MIT 许可证](LICENSE)。

## 致谢

- [typora-web](https://github.com/Yuyz0112/typora-web)：编辑器核心的上游项目，采用 MIT 许可证。
- [KaTeX](https://katex.org/)：用于渲染数学公式，采用 MIT 许可证。
- [Mermaid](https://mermaid.js.org/)：用于渲染图表，采用 MIT 许可证。
- [Lucide React](https://lucide.dev/)：用于界面图标，采用 ISC 许可证；其中部分源自 Feather 的图标采用 MIT 许可证。

完整的许可文本见[第三方许可声明](public/THIRD_PARTY_NOTICES.txt)，并随发布包一同提供。
