# AGENTS.md

## 项目

Mint Notes 是一款可自托管的多用户 Markdown 笔记 PWA，采用本地优先、端到端加密架构。React／TypeScript 客户端负责编辑、加密和 IndexedDB 持久化；Fastify／SQLite 服务端负责认证、密文同步、历史与附件存储。

## 仓库结构

| 位置 | 职责 |
| --- | --- |
| `src/App.tsx`、`src/features/session/` | 应用入口、认证、设备解锁与会话生命周期 |
| `src/features/vault/` | 保险库工作区、视图、保存队列、同步与历史控制器 |
| `src/features/` | 树与排序、附件、导入导出、历史等领域逻辑及功能界面 |
| `src/editor/` | 编辑器产品集成、阅读模式、Front Matter 与派生展示 |
| `src/editor/core/`、`src/editor/extensions/` | Markdown 核心、源码事务与位置映射；产品语法扩展 |
| `src/crypto/`、`src/storage/`、`src/api.ts` | 加密 Worker 及调用入口、Dexie 存储、HTTP 接口 |
| `src/components/`、`src/i18n/`、`src/styles.css` | 公共控件、界面翻译、应用样式 |
| `server/` | 服务组合、领域路由、认证、SQLite、日志、维护与备份 |
| `scripts/`、`.github/workflows/` | 集成检查、版本校验与镜像发布 |
| `Dockerfile`、`docker-compose.yml`、`deploy/`、`.env.example` | 容器、反向代理示例与配置模板 |
| `public/` | 随应用发布的静态资源与第三方许可声明 |
| `docs/` | 使用、系统设计、编辑器原则与自托管文档 |

测试与实现相邻，命名为 `*.test.ts`／`*.test.tsx`；编辑器还保留 `core/upstream-tests/` 与 `core/specs/`。`dist/`、`server-dist/` 是构建产物；`data/`、`notes-data/`、`backups/` 是运行数据，不作为源码维护或提交。

## 开发与命令

使用 Node.js 22+ 和 `package.json#packageManager` 指定的 pnpm 版本，依赖锁定在 `pnpm-lock.yaml`。不要引入其他包管理器的锁文件。

| 命令 | 用途 |
| --- | --- |
| `pnpm install` | 安装开发依赖；CI／发布使用 `pnpm install --frozen-lockfile` |
| `pnpm dev` | 同时启动 Vite 与 Fastify；也可用 `pnpm dev:web`／`pnpm dev:server` 分别启动 |
| `pnpm typecheck` | 检查客户端与服务端 TypeScript |
| `pnpm test` | 运行 Vitest 测试 |
| `pnpm exec vitest run src/editor/architecture.test.ts` | 定向运行单个测试文件；按任务替换路径 |
| `pnpm build` | 构建客户端与服务端；也可用 `pnpm build:web`／`pnpm build:server` 分别构建 |
| `pnpm start` | 运行已构建的服务端 |

开发端口默认是 Vite `5173`、API `8787`，Vite 代理 `/api`。开发数据库位于 `data/notes.sqlite`，由服务启动时初始化。当前没有独立的 lint／format 脚本，不要假定 `pnpm lint` 或 `pnpm format` 可用。

发布版本取自稳定 Git 标签 `vMAJOR.MINOR.PATCH`，由 `scripts/release-version.mjs` 校验并通过 `APP_VERSION` 注入构建。不要把 `package.json` 的 `0.0.0` 改成发布版本，也不要移动已公开标签；完整流程见 [README.md](README.md#开发与发布)。

## 文档路由

按任务读取相关文档，同一事实只在最合适的文档中完整说明，其他位置用摘要和链接引用：

| 任务 | 文档与维护要求 |
| --- | --- |
| 产品概述、快速开始、开发、发布 | [README.md](README.md) |
| 用户可感知的行为变化 | 同一次修改中更新 [docs/guide.md](docs/guide.md) |
| 持久化、同步、加密、认证、隔离、CSP、元数据边界 | 先读 [docs/system-design.md](docs/system-design.md)，修改须获允许 |
| 编辑器行为、显示、交互与验收 | 先读 [docs/editor-architecture.md](docs/editor-architecture.md)，修改须获允许 |
| Docker、配置、代理、备份、恢复、升级 | 更新 [docs/self-hosting.md](docs/self-hosting.md)，并检查 `.env.example`、`docker-compose.yml`、`deploy/nginx.conf.example` 等相关配置 |
| 已发布版本的变化 | [CHANGELOG.md](CHANGELOG.md)，发布标签须有对应的带日期版本记录 |

- 每次更改代码后，按需更改对应文档。
- `docs/system-design.md` 和 `docs/editor-architecture.md`为指导性文档，一般任务原则上不修改，确需修改时询问用户许可。
- 原则与实现冲突时，暂停，先询问用户。

## 模块边界

- `src/App.tsx`、`src/features/vault/VaultApp.tsx`、`server/index.ts`、`server/app.ts` 只负责组合与生命周期，不放领域算法。
- `src/features/vault/VaultWorkspace.tsx` 与 `server/routes.ts` 仍是需要逐步提取的协调边界。修改相关行为时，先将其提取到职责单一的 Hook、控制器、领域路由或服务并测试，再扩展功能。
- 视图通过 Hook／控制器访问数据，不直接调用 Dexie、加密 Worker 或同步 API。
- `src/editor/core/` 不导入产品扩展；扩展放在 `src/editor/extensions/`，通过受限声明契约或类型化源码事务接入，不接收原始 ProseMirror 视图。
- 编辑器核心是仓库内维护的上游衍生代码，不是生成文件。修改前按需读 `src/editor/core/UPSTREAM.md`，保留上游许可证与测试；引入或更新第三方代码时检查 `public/THIRD_PARTY_NOTICES.txt`。
- 新增界面文案使用 `src/i18n/index.tsx` 的消息键，补齐英文、简体中文、繁体中文。控件图标显式导入 `lucide-react` 并通过 `AppIcon` 渲染，不用 Emoji、字体或 CDN 图标替代；纯图标按钮提供可翻译的可访问名称。

## 不变量

- **正文只有一份**：原始 Markdown 是唯一可编辑、可持久化、可交换的正文。解析树、DOM 与渲染结果都是派生状态；编辑必须经准确、原子的源码事务提交，操作范围外的空格、换行和标记写法保持原样。
- **展示不改正文**：模式切换、源码显隐和异步渲染不触发保存、同步或内容撤销记录。编辑器改动同时验证源码、选区、撤销与输入法组合输入；无法准确映射时先回退到源码，具体验收遵守 [编辑器架构原则](docs/editor-architecture.md)。
- **本地保存不等网络**：顺序为内存 → 浏览器加密 → 原子写入 IndexedDB 对象与发件箱 → 后台上传。同一用户、同一对象的持久写入串行；旧异步结果或上传确认不能覆盖新编辑或删掉较新的发件箱条目。
- **同步可重试**：沿用服务器修订、持久游标、`baseRevision` 与幂等键。拉取页全部通过认证、解密并原子落库后才推进游标；Service Worker 与 SSE 只改善可用性，不承担正确性。
- **冲突与清理不丢数据**：不按设备时间决定冲突胜者；保留服务器版本，将本地版本连同附件保存为独立冲突副本。冲突、删除和清理不得静默移除唯一剩余修订；永久清除必须遵守墓碑、待同步数据和受保护历史的检查。
- **附件先于引用**：附件密文持久化后才插入 Markdown 引用；同步先分块，再清单和所属笔记。一份附件只属于一篇笔记，复制、冲突或恢复为副本时生成新 UUID 与密钥。

## 安全与兼容

- **明文边界**：服务器不得收到明文标题、Markdown、标签、文件夹结构、笔记锁定状态、历史名称／内容、头像、附件名称／MIME／字节、主密码或解密密钥。允许的元数据以系统设计为准，不要把端到端加密描述为隐藏全部元数据。
- **认证与隔离**：所有用户对象、修订、变更、历史和附件查询从认证会话取得 `user_id`，不能接受请求指定所有者。生产使用 `Secure`、`HttpOnly`、`SameSite=Strict` Cookie 及 Origin 校验；服务器只存认证与会话凭据的哈希，端点标识不能单独认证。
- **加密与设备密钥**：沿用现有 Worker 与 Web Crypto，不实现新密码学原语。AES-GCM 每次使用全新随机 96 位 nonce，AAD 绑定用户、对象／附件、领域、版本及修订或分块位置。主密码、PIN 派生密钥、恢复密钥、已解锁密钥、笔记明文与 Blob URL 不进入应用持久存储、日志、URL 或服务器；本机解锁所需的不可导出设备 `CryptoKey` 与加密凭据按现有协议保存，不扩大此例外。
- **锁定与离线**：锁定清除解密内存与 Blob URL，保留密文和发件箱；登出还删除当前用户本地密文、发件箱及设备凭据。离线身份快照只允许本地路由，同一已记住端点经 `/api/auth/me` 验证前，禁用同步、SSE、远程附件、账户和管理请求。
- **内容安全**：禁用原始 HTML、可执行嵌入、运行时 CDN 脚本与远程字体。新增网络源、分析或嵌入前，审查系统设计中的数据边界与 CSP。图片附件按签名验证栅格格式，拒绝 SVG；内置客户端上限为 25 MiB。
- **日志**：复用 `server/logging.ts` 的结构化事件、安全错误与脱敏引用。不要直接记录请求／响应、原始 URL／查询、IP、用户名、完整 ID、标头、正文、凭据、密文、nonce 或附件字节。
- **兼容与数据维护**：`webmd-*` 存储、Cookie、标头、AAD、附件 URL 与导出标识符都是兼容协议，不随品牌名调整；更改须有保留数据的迁移。`webmd-notes-v2` 名称与 Dexie 内部版本号不是一回事，不得自动删除 v2 前数据库。SQLite 保持 WAL；在线备份使用 `server/backup.ts`（构建后 `pnpm backup`），不直接复制运行中的数据库。

## 验证

涉及多类改动时叠加相应检查；基础检查指 `pnpm typecheck` 与 `pnpm test`。

| 改动范围 | 必须完成的检查 |
| --- | --- |
| 仅文档 | 核对命令、路径、链接和事实，运行 `git diff --check`；无需运行应用测试 |
| TypeScript 行为 | `pnpm typecheck`、`pnpm test`，补充或更新受影响行为的回归用例 |
| 加密、Worker、附件加密 | 基础检查外，先 `pnpm build`，再 `pnpm test:crypto-worker` |
| 认证、API、SQLite、账户、配额、清除 | 基础检查外，先 `pnpm build`，再 `pnpm test:smoke` |
| 部署配置 | `docker compose config`，并核对自托管文档与配置示例 |
| 重大编辑器、PWA、窗格、拖放、响应式 | `pnpm build`，并检查受影响的桌面／平板／移动流程 |

集成检查使用构建产物，修改后不能复用旧构建。API smoke 脚本自行启动服务，使用临时数据库与固定端口 `8790`，运行前确保端口空闲。Vitest 默认使用 `happy-dom`；其结果不能代替真实浏览器中的选区、布局、输入法、触摸与 PWA 验证。交付时说明实际通过的检查，以及尚未完成的人工验证。
