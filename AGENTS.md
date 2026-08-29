# AGENTS.md

## 项目概览

Mint Notes 是一个轻量、自托管、多用户的 Markdown 笔记 PWA。它采用本地优先写入路径和浏览器端端到端加密，因此输入与持久本地保存都无需等待网络；服务器只存储不透明的加密笔记、文件夹和附件数据。

浏览器应用使用 React、TypeScript、Vite、仓库内由 `typora-web` 衍生的 ProseMirror 编辑器核心、Web Crypto 和 Dexie／IndexedDB。服务器使用 Fastify 和 SQLite，并以单个非 root Docker 服务交付，不依赖 Redis、MongoDB、对象存储或独立搜索服务。

## 项目不变量

每次更改都必须保持以下不变量：

- 按键输入和本地保存绝不能等待网络请求。
- 服务器不得接收明文标题、Markdown、标签、文件夹名称、文件夹结构、大纲、附件名称、MIME 类型、附件字节或加密密钥。
- 服务器对用户自有对象、修订、变更和附件分块的每次查询，都必须从已认证会话绑定 `user_id`，不得从请求输入中获取。
- 冲突和删除不得静默销毁唯一剩余的修订。
- 规范 Markdown 源码是唯一可编辑文档模型和可移植笔记格式。渲染结构仅是视图，绝不能成为权威文档状态。
- 附件密文必须先持久写入 IndexedDB，之后才能插入其 Markdown 引用并尝试上传。
- Service Worker 功能可以改善可用性，但同步正确性不得依赖它。

## 文档路由

以 `docs/README.md` 作为面向用户的文档索引。实施更改时，只读取与当前更改相关的文档，并使用下表作为路由入口。

| 需求或更改 | 首先阅读 | 变更时处理 |
| --- | --- | --- |
| 产品摘要、支持的功能、要求或快速开始 | `README.md` | `README.md`；保持面向用户且简洁。 |
| 账户设置、编辑器模式、文件树操作、附件、同步状态、导入／导出、回收站或 PWA 使用 | `docs/USER_GUIDE.md` | `docs/USER_GUIDE.md`；若具有显著外部影响，还要更新 README 中对应的功能或限制。 |
| 贡献者设置、项目结构、验证命令或实现边界 | `docs/DEVELOPMENT.md` | `docs/DEVELOPMENT.md`；长期维护路由变化时也更新本文件。 |
| 运行时拓扑、本地优先写入路径、同步、IndexedDB／SQLite 职责或附件流程 | `docs/ARCHITECTURE.md` | `docs/ARCHITECTURE.md`；边界变化时还要审查 `docs/SECURITY.md`。 |
| 规范 Markdown、解析器／序列化器行为、实时渲染、源码坐标、光标／删除语义或编辑器扩展 | `docs/EDITOR_ARCHITECTURE.md` | 必须遵循该原则文档；除非用户明确要求修改编辑器架构原则，否则不得编辑它。用户可见行为变化时更新 `docs/USER_GUIDE.md`。 |
| 威胁模型、密钥层级、AAD、元数据暴露、Cookie、CSP 或账户隔离 | `docs/SECURITY.md` | `docs/SECURITY.md`；安全声明必须与可执行代码和测试一致。 |
| Docker、环境变量、反向代理、账户初始化、生产检查或架构版本升级 | `docs/DEPLOYMENT.md` | `docs/DEPLOYMENT.md`、`.env.example` 和 `docker-compose.yml`；必要时审查 README 快速开始。 |
| 在线备份、保留策略、恢复演练、WAL 行为或灾难恢复 | `docs/BACKUP_AND_RESTORE.md` | `docs/BACKUP_AND_RESTORE.md`；架构／存储变化时也要审查部署与架构文档。 |
| Nginx 标头、TLS 终止或请求大小限制 | `deploy/nginx.conf.example` 和 `docs/DEPLOYMENT.md` | 保持两个文件一致。 |
| 应用发布或多平台 Docker 镜像发布 | `docs/DOCKER_IMAGE_RELEASE.md` | 保持 CHANGELOG、Git 标签、注入的构建版本、镜像标签和发布验证步骤一致；`package.json` 不是发布版本来源。 |
| 仓库特有的 Agent 约束和反复出现的实现陷阱 | `AGENTS.md` | 仅用持久项目知识更新本文件，不记录一次性任务历史或通用 Agent 行为。 |

判断当前描述性事实时，按以下证据顺序判断：实现代码、自动化测试、构建／部署配置、`AGENTS.md`，最后是面向用户的文档。不要只因过时声明已存在于 README 中就继续保留。`docs/EDITOR_ARCHITECTURE.md` 中由本文件保护的规范性设计原则属于发布门槛，不能仅因当前实现不同而自动失效。

## 更改影响路由

- 更改加密、认证、持久化、同步、数据库架构、附件所有权、清除行为或 Service Worker 生命周期前，阅读 `docs/ARCHITECTURE.md`、`docs/SECURITY.md` 和 `docs/DEVELOPMENT.md` 中的相关部分。
- 更改解析器、序列化器、编辑器事务、装饰、节点视图、光标映射、删除行为或模式切换前，阅读并遵循 `docs/EDITOR_ARCHITECTURE.md`。将其中的设计原则视为发布门槛；如果需求与原则冲突，先向用户说明并请求决定，不得自行修改原则文档。
- 公共 API 路由、环境变量、部署命令、数据目录或端口变化时，必须按实际影响同步检查 `.env.example`、`docker-compose.yml`、`README.md` 和 `docs/DEPLOYMENT.md`。
- 可移植导入／导出格式变化时，必须一起检查 `docs/USER_GUIDE.md`、`docs/ARCHITECTURE.md`、备份指南和兼容性说明。
- 用户可见行为变化时，必须在同一次更改中更新用户指南。不改变行为的内部算法按需记录在开发文档或代码注释中，而不是 README；不得因此修改编辑器架构原则。
- 新增服务器可见元数据、网络源、分析、CDN 脚本、远程字体、原始 HTML 或可执行嵌入时，必须明确审查安全模型和 CSP。

## 模块职责

- `src/App.tsx`：只负责顶层会话状态路由。它选择认证、锁定和已解锁保险库界面，不得包含保险库持久化、同步、文档或附件算法。
- `src/components/`：共享展示原语，包括标准 Lucide 图标包装器。
- `src/editor/core/`：仓库内的 ProseMirror／Markdown 核心、规范解析器和序列化器、输入事务、通用扩展契约与稳定控制器。`UPSTREAM.md` 记录导入源码的来源。
- `src/editor/extensions/`：Mint Notes 自有的 Callout、Comment、Math、Mermaid 和 WikiLink／Embed 实时模式扩展，通过核心扩展契约注入。`src/editor/` 下的其他模块分别负责 React 适配器、实时／源码／阅读三种模式编辑器、源码／实时模式图片拖放和大纲提取。
- `src/crypto/`：仅限浏览器的 Argon2id／HMAC 密钥派生、密钥信封、认证对象加密和附件分块加密。不得将明文密码学工作移到服务器。
- `src/storage/`：用于加密 IndexedDB 对象、附件分块、每用户偏好／游标和持久发件箱的 Dexie 架构。
- `src/features/vault/`：已解锁保险库组合、类型化控制器、内存索引、对象写入串行化和保险库专用视图。将持久化、附件复制、同步、历史和文档命令留在各自所属模块中，不要添加到 `VaultApp.tsx` 或视图组件。
- `src/features/`：认证、设置、管理、附件、导入／导出、树工具和语言感知文本统计。
- `server/index.ts` 和 `server/app.ts`：只负责进程启动和应用组合。认证／会话行为、领域路由、仓库和维护任务应放在 `server/` 下各自模块中。
- `server/`：Fastify 领域路由与服务、会话派生授权、不透明加密对象存储、SQLite 修订／变更、附件分块、账户激活和静态 PWA 交付。
- `scripts/`：已构建加密 Worker 的集成测试和 API 冒烟测试。
- `deploy/`：生产反向代理示例。
- `docs/`：面向任务的产品、工程、运维和发布文档；导航与职责边界记录在 `docs/README.md` 中。

更改目前由 `src/App.tsx`、`src/features/vault/VaultApp.tsx`、`server/index.ts` 或 `server/app.ts` 协调的职责时，不得向这些入口点添加领域逻辑。应扩展现有归属模块，或先提取具有针对性测试的内聚类型化控制器／服务／仓库。不要创建新的万能编排文件代替提取；依赖方向和路由请参阅 `docs/DEVELOPMENT.md`。

`src/features/vault/VaultWorkspace.tsx` 和 `server/routes.ts` 仍是尚未获得更窄归属职责的集成协调器。将它们视为提取边界，而不是扩展点：更改其中内嵌的同步、历史、账户或文档命令行为前，必须先把该内聚行为移入类型化保险库 Hook／控制器，或服务器领域路由／服务，并提供针对性测试。

## 安全约束

- 不要实现新的密码学原语。使用现有加密 Worker 包装器和 Web Crypto 操作。
- 不得在同一密钥下重复使用 AES-GCM nonce；每次加密都要使用全新的随机 96 位 nonce。
- 通过 AAD 将对象密文绑定到用户 ID、对象 ID、对象类型、架构／加密版本和预期修订。
- 通过 AAD 将附件分块绑定到用户 ID、附件 UUID、分块索引、分块总数和加密版本。
- 不得在 Local Storage、Cache Storage、日志、URL、服务器响应或 SQLite 中持久保存明文笔记、解密后的附件数据、恢复密钥或已解锁保险库密钥。
- 生产环境中的认证令牌应存放在 `Secure`、`HttpOnly`、`SameSite=Strict` Cookie 中。服务器端只存储令牌哈希。
- 持久端点 Cookie 只标识用户／浏览器配置文件，本身绝不用于认证；端点哈希与会话哈希保持分离，所有端点查询均使用已认证会话的用户 ID。
- 本地 PIN 数据、设备密钥、自动锁定偏好和待处理端点撤销均仅保留在浏览器中，并且必须从诊断信息中排除。锁定时清除已解密内存；登出和无效会话也删除本地信任。
- 配置本地 PIN 后，IndexedDB 只能保留由 PIN 加密的设备凭据。普通重新加载可以使用仅保存在该标签页 `sessionStorage` 中、由设备直接包装的信封和上次活动时间戳，但前提是可选的不活动间隔尚未到期；手动锁定、不活动锁定、登出、非重新加载启动和无效会话处理都必须清除或拒绝它。绝不得在 IndexedDB、Local Storage、Cache Storage 或服务器数据中持久保存 PIN 派生密钥或该刷新信封，也不得使用跨标签页授权恢复受 PIN 保护的保险库。
- Markdown 中继续禁用原始 HTML 和远程可执行嵌入。
- 不得通过削弱精确来源检查或 CSP 来规避部署错误；应修复 `APP_ORIGIN` 和反向代理转发。

## 本地优先与同步约束

- 写入顺序为：内存更新、浏览器加密、原子 IndexedDB 对象／发件箱事务，最后后台上传。
- 网络失败必须保留最新的加密本地对象和重试条目。
- 附件分块必须先于加密附件清单和所属笔记修订上传。
- 条件推送使用 `baseRevision` 和幂等键。设备时间戳仅用于显示，不得用于解决冲突。
- 文档冲突会生成单独的冲突副本。除非有意重新设计数据丢失模型并同步文档，否则不得改为最后写入者胜出。
- 同步必须在本地更改后、解锁启动时、重新联网时、解锁期间定期以及可见性变化时持续运行。

## 数据、附件与兼容性约束

- 服务器架构 v2 和 IndexedDB 数据库 `webmd-notes-v2` 有意不迁移旧版 v2 之前格式。绝不得自动删除或覆盖旧版数据库。
- `webmd-*` IndexedDB、Local Storage、Cookie、HTTP 标头、加密 AAD、附件 URL 和导出格式标识符是早期产品名称留下的兼容命名空间。除非实施保留现有保险库、会话、Markdown 和导出内容的审慎迁移，否则不得重命名。
- SQLite 使用 WAL 模式。备份必须使用 `server/backup.ts` 和 SQLite 在线备份机制，不得复制正在使用的 `notes.sqlite` 文件。
- 一个附件只属于一篇笔记。复制笔记时必须生成新的附件 UUID 和密钥，确保删除原笔记不会破坏副本。
- 将笔记移入回收站时，为其附件创建墓碑；只有明确同步的清除流程才能物理删除分块。
- 内置浏览器客户端强制执行 25 MiB 栅格图片限制。只提高 `MAX_ATTACHMENT_SIZE_MB` 不会提高客户端限制。
- PNG、JPEG、GIF、WebP 和 AVIF 通过文件签名检测。不得直接渲染 SVG。
- 离线冷启动仅适用于具有匹配、带版本的最近验证用户／端点快照的已记住设备。直接设备凭据可以在本地解锁；受 PIN 保护的凭据必须显示 PIN 锁屏，且不得使用刷新或跨标签页授权绕过它。缓存身份仅用于本地路由和显示：在 `/api/auth/me` 重新验证同一已记住端点前，同步、SSE、远程附件读取以及所有账户／管理／服务器策略请求都保持禁用。确认的 `401`、端点模式降级或身份不匹配会删除本地信任并锁定保险库，但不会删除加密对象或发件箱。

## 编辑器与 PWA 约束

- 负责笔记正文编辑或显示的模块统一称为“编辑器”。编辑器包含“实时模式”“源码模式”“阅读模式”三种“编辑模式”。实时模式内受支持的 Markdown 语法结构在光标位于其源码范围内时处于“编辑态”，光标移出后处于“渲染态”；编辑态和渲染态不是额外的编辑模式。界面、文档、类型、组件和状态标识必须使用这一术语层级。
- **发布阻断级编辑器原则：**规范 Markdown 字符串是唯一权威、可提交、可持久化的文档模型，也是所有编辑操作的唯一内容目标。编辑器产生的内容变化必须通过准确、原子的源码事务提交；解析、派生结构、DOM 和展示状态不得反向覆盖规范源码，输入与本地提交不得等待网络。
- 将 `src/editor/core/` 视为 Mint Notes 自有、衍生自 `typora-web` 0.3.1 的核心。直接修改其 TypeScript 源码，并保留 `UPSTREAM.md` 和 `LICENSE.typora-web`。核心更改必须用针对性测试证明规范源码和事务效果，不能只证明解析树等价。
- `src/editor/core/` 不得导入 Mint Notes 产品扩展。新展示通过受限的声明式扩展契约接入，不得接收原始编辑器视图或直接修改文档；修改源码的扩展能力必须返回类型化源码事务。遗留底层 Hook 仅用于迁移，不得用于新功能。
- 所有编辑器功能变更必须遵循 `docs/EDITOR_ARCHITECTURE.md`。仅实现、修复、优化或重构功能时不得编辑该原则文档；若需求与原则冲突，必须先请求用户作出架构决定。只有用户明确要求修改编辑器架构原则时，才能更新该文档。
- 已解密附件 Blob URL 只存在于内存中，并且必须在笔记变化或保险库锁定时撤销。
- PWA 更新必须经过现有用户确认路径，避免在未保存编辑过渡期间激活新构建包。
- 界面符号必须使用 `lucide-react` 的显式命名导入，并通过 `src/components/AppIcon.tsx` 渲染。不得使用命名空间／动态图标查找、图标字体、CDN 资源、Emoji 或文本字形替代应用控件。
- 产品徽标和安装图标应作为项目自有资源保存在 `public/` 中；Lucide 符号是界面控件，不是 Mint Notes 品牌。只有图标的按钮必须具有无障碍名称；图标许可变化时必须同步更新随发布包分发的 `public/THIRD_PARTY_NOTICES.txt`。

## 命令与验证

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm test:crypto-worker
pnpm test:smoke
docker compose config
```

`test:crypto-worker` 从 `dist/assets` 加载构建后的 Worker，`test:smoke` 运行 `server-dist/index.js`；执行两者前先运行 `pnpm build`。

交互式 UI 验证策略：

- 不要将浏览器、Chrome 或计算机操作工具用于例行更改、小型 UI／样式／文案调整或默认完成检查。
- 仅在用户明确要求浏览器或桌面应用测试，或更改确属重大且发布关键时使用这些工具，例如广泛的交互重设计，或无法被自动化检查充分覆盖的编辑器生命周期、Service Worker 更新流程、认证／解锁流程、同步／冲突处理或附件持久性跨领域变化。
- 其他更改只运行下方列表中最快的相关非交互命令行检查和针对性冒烟测试。在交付中说明仍需用户手动执行的视觉或交互检查，不要把任务扩展为浏览器或桌面自动化。

最低要求：

- TypeScript 行为变化后运行 `pnpm typecheck` 和 `pnpm test`。
- 加密、密钥信封、Worker 或附件加密变化后还要运行 `pnpm test:crypto-worker`。
- 认证、授权、API、SQLite、激活、密码、配额或清除变化后还要运行 `pnpm test:smoke`。
- Docker、环境、端口、卷或反向代理相关配置变化后运行 `docker compose config`。
- 编辑器生命周期、Service Worker、主题、窗格、拖放或响应式布局出现重大变化时，运行生产构建并指出仍需验证的桌面／平板／移动端流程；是否由 Agent 或用户执行这些检查，应遵循上方交互式 UI 验证策略。
