# 开发指南

[文档索引](README.md)

本指南面向需要运行、验证或扩展 Mint Notes 的贡献者。产品操作请参阅[用户指南](USER_GUIDE.md)；生产配置请参阅[部署指南](DEPLOYMENT.md)。

## 环境要求

- Node.js 22 或更高版本。
- pnpm 11 或更高版本；条件允许时应与 `package.json` 的 `packageManager` 字段一致。
- 用于容器验证的 Docker Compose v2。

安装依赖：

```bash
pnpm install
```

仓库在 `src/editor/core/` 中维护自己的实时 Markdown 编辑器核心。它衍生自 `typora-web` 0.3.1 发布源码；`src/editor/core/UPSTREAM.md` 记录准确提交和许可证。导入的行为规范与测试框架位于核心旁，并通过仓库的 Vitest 命令运行。请直接修改 TypeScript 源码，并用直接往返测试和 DOM 事务测试覆盖解析器、序列化器、输入事务、扩展、装饰和控制器更改。

## 开发服务器

```bash
pnpm dev
```

该命令会启动：

- 位于 `http://localhost:5173` 的 Vite。
- 位于 `http://127.0.0.1:8787` 的 Fastify API。
- 从 `/api` 到 API 服务器的 Vite 代理。

开发 API 会创建 `./data/notes.sqlite`；该目录已被 Git 忽略。生产镜像则将持久存储固定在 `/data`。新数据库中的第一个账户会成为管理员。

也可以单独启动各个进程：

```bash
pnpm dev:web
pnpm dev:server
```

开发服务器把日志格式化为带颜色、易读的单行文本。除健康检查和静态资源外，每个 API 请求会记录一条完成记录；重要认证、冲突、配额、管理和维护事件也会记录。需要详细的同步批次摘要时，使用 `LOG_LEVEL=debug pnpm dev:server`。生产环境使用相同事件字段的 JSON 格式。

每个 API 响应都包含服务器生成的 `X-Request-ID`，用于关联事件。只能通过 `server/logging.ts` 中的类型化辅助函数记录日志：绝不能把请求、标头、Cookie、正文、响应、用户名、完整内部 ID、密文、nonce 或秘密传给日志器。用户、对象、端点和账户设置 ID 必须先转换为进程本地匿名引用。

## 项目结构

| 路径 | 职责 |
| --- | --- |
| `src/App.tsx` | 在认证、设备锁定和已解锁保险库之间进行顶层路由。 |
| `src/components/` | 共享展示原语，包括标准图标包装器。 |
| `src/editor/core/` | ProseMirror／Markdown 核心、规范解析器和序列化器、输入事务、通用的仅声明呈现宿主与扩展契约、稳定控制器、导入的行为规范和来源说明。 |
| `src/editor/extensions/` | 相互独立、产品特有的 Callout、Comment、Math、Mermaid 和 WikiLink／Embed 实时呈现；核心不导入这些模块。新渲染器声明源码匹配与渲染回调，不创建原始 ProseMirror 插件。 |
| `src/editor/` 中的其他模块 | React 实时／源码适配器、源码／实时拖放处理、Markdown 呈现编解码器、只读渲染和大纲提取。 |
| `src/features/history.ts`、`src/features/vault/historyController.ts` 和 `src/components/HistoryPanel.tsx` | 历史负载／去重策略、类型化加密本地持久化／元数据队列，以及右侧面板的历史呈现。 |
| `src/features/session/` | 会话恢复、可信设备状态、跨标签页失效和锁定会话命令。 |
| `src/features/vault/` | 已解锁保险库组合、类型化状态／控制器 Hook、串行对象持久化、可重试文档保存、分页拉取／游标应用、本地清除、原子发件箱确认，以及文档树等保险库专用呈现。 |
| `src/i18n/` | 类型化英语、简体中文和繁体中文消息、浏览器语言解析、日期格式化和语言偏好上下文。 |
| `src/crypto/` | 浏览器 Worker 密钥派生、密码／恢复／设备信封、AES-GCM 对象加密和附件分块加密。 |
| `src/storage/` | 加密 IndexedDB 对象、分块、偏好、游标和持久发件箱的 Dexie 架构。 |
| `src/features/` | 认证、设置、管理、文件树与设备本地工作区状态工具、旧工作区迁移、同步协调与批处理、附件、导入／导出和文本统计。 |
| `server/index.ts` 和 `server/app.ts` | 进程启动和依赖组合；两者都不负责路由或 SQL 行为。 |
| `server/auth/`、`server/account/`、`server/admin/`、`server/attachments/`、`server/history/` 和 `server/sync/` | 会话派生守卫、账户端点生命周期、领域路由、验证和仓库。用户自有操作接收已认证作用域，不接收请求提供的用户 ID。 |
| `src/features/vault/VaultWorkspace.tsx` 和 `server/routes.ts` | 在其余账户／文档工作流被提取期间保留的集成协调器。文档保存调度、拉取／游标应用、清除存储、发件箱确认、历史持久化和历史／附件服务器路由均委托给专用模块。它们不是扩展点。 |
| `server/` 中的其他模块 | 结构化日志、SQLite 架构、历史／回收站策略、同步事件、维护任务和在线备份。 |
| `scripts/` | 加密 Worker 集成测试和 API 冒烟测试。 |
| `deploy/` | 反向代理示例。 |
| `docs/` | 面向任务的文档及其[导航索引](README.md)。 |

更改系统行为前请阅读 [`AGENTS.md`](../AGENTS.md)。按其中的路由表找到相关架构、编辑器、安全、部署或恢复指南，不要把所有文档都当作必读背景。

## 模块边界

`App.tsx`、`VaultApp.tsx`、`server/index.ts` 和 `server/app.ts` 是组合边界。它们可以选择界面、构造依赖、注册模块并负责关闭接线，但不得堆积加密、持久化、同步、路由处理器或 SQL 算法。

客户端状态应位于具有明确依赖对象的专用 Hook 和控制器中。视图接收类型化状态与命令，不直接调用 Dexie、加密 Worker 或同步 API。同一对象的持久写入通过对象持久化控制器；包含附件的副本通过共享附件克隆服务。

服务器 HTTP 模块验证输入，并从已认证请求获取用户作用域。仓库和服务显式接收该作用域。正文、参数或查询字段绝不能选择对象所有者。新路由族应放入领域路由模块，而不是启动或应用组合文件。

更改跨越领域时，应在拥有该工作流的最窄控制器中编排，并向协作者暴露小型类型化端口。如果相关行为仍嵌入宽泛模块，应在同一更改中提取该内聚行为及其测试，不要继续扩张宽泛模块。

## UI 图标与品牌

应用控件使用 `lucide-react`。显式导入每个符号，使 Vite 能移除未使用图标；然后通过 `AppIcon` 渲染。该组件提供标准 18 px 大小、1.8 描边宽度和装饰性无障碍属性：

```tsx
import { LockKeyhole, Settings } from "lucide-react";
import { AppIcon } from "./components/AppIcon";

<button aria-label="设置"><AppIcon icon={Settings} /></button>
<button><AppIcon icon={LockKeyhole} size={16} />锁定</button>
```

- 不得使用 `import * as Icons`、运行时字符串查找或其他会让整个图标库保留在客户端包中的模式。
- 不得用 Emoji、Unicode 字形、远程图标字体或 CDN 托管 SVG 作为应用控件。远程资源还需要审查 CSP 和安全模型。
- 只有图标的按钮需要 `aria-label` 或等效可见文本。`AppIcon` 会把 SVG 本身标记为装饰元素，使辅助技术朗读控件而不是图形。
- Mint Notes 徽标、favicon、PWA 图标、可遮罩 PWA 图标和 Apple 触控图标应作为项目自有资源保存在 `public/` 下；第三方 UI 符号不得替代产品标识。
- Lucide 及继承的 Feather 许可证文本随 `public/THIRD_PARTY_NOTICES.txt` 分发。图标库或适用许可证变化时更新该文件，并在生产构建后确认声明存在于 `dist/` 中。

## 验证

运行常规检查：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:crypto-worker
pnpm test:smoke
docker compose config
```

顺序很重要：

- `pnpm test` 直接从源码运行 Vitest 单元测试和服务器测试。
- `pnpm build` 生成 `dist/` 和 `server-dist/`。
- `pnpm test:crypto-worker` 从 `dist/assets` 加载构建后的 Worker 包。
- `pnpm test:smoke` 使用临时数据库启动 `server-dist/index.js`，并在结束后将其移除。

冒烟测试覆盖账户初始化，跨用户对象、附件、头像、笔记历史和 SSE 隔离，来源客户端通知抑制，批量对象写入与冲突，紧凑增量拉取，历史设置／清除屏障／清除，密码与恢复密钥更改，管理员激活与删除，认证清除传播，以及回收站保留设置。Worker 测试覆盖注册／登录／恢复兼容性、恢复密钥轮换、PIN 加密设备凭据、错误 PIN 拒绝、对象／头像／历史／附件往返、nonce 唯一性、AAD 绑定和篡改拒绝。

在本地构建并发布由官方标签派生的多平台容器时，维护者应遵循独立的 [Docker 镜像发布指南](DOCKER_IMAGE_RELEASE.md)。

## 实现边界

更改系统行为前请阅读 [`AGENTS.md`](../AGENTS.md)。其中包含可执行的仓库约束，并将各更改领域路由到对应的权威文档：

| 更改领域 | 权威参考 |
| --- | --- |
| 本地优先持久化、同步、浏览器／服务器存储或附件 | [系统架构](ARCHITECTURE.md) |
| 规范 Markdown、解析、序列化、实时渲染、源码坐标或编辑器扩展 | [编辑器架构](EDITOR_ARCHITECTURE.md) |
| 认证、加密、AAD、账户隔离、CSP 或元数据暴露 | [安全模型](SECURITY.md) |
| 架构兼容性、生产配置或升级 | [生产部署](DEPLOYMENT.md) |
| 应用发布或 Docker 镜像发布 | [Docker 镜像发布](DOCKER_IMAGE_RELEASE.md) |
| 在线备份、保留或恢复 | [备份和恢复](BACKUP_AND_RESTORE.md) |
| 用户可见的编辑器、历史、导入／导出、回收站、设置或 PWA 行为 | [用户指南](USER_GUIDE.md) |

### 数据持久性与同步

- 保持按键路径不受网络延迟影响：编辑器状态、浏览器加密、原子 IndexedDB 对象／发件箱存储，最后后台同步。
- 同步冲突或删除流程失败时，保留唯一剩余的修订。
- 插入附件的 Markdown 引用前先持久保存附件密文，并先上传分块，再上传清单和所属笔记。
- 不要让同步正确性依赖 Service Worker 后台执行或 SSE 交付。

### 编辑器更改

规范 Markdown 源码是唯一可编辑文档模型。实时渲染仅用于呈现；破坏基于源码的位置或作者输入的分隔符会阻断发布。完整规则——包括源码坐标编辑、允许的临时表示、职责边界和强制回归测试——记录在[编辑器架构](EDITOR_ARCHITECTURE.md)中；不要在功能文档中复制不完整版本。

### 安全与平台边界

- 使用现有加密包装器和会话派生的服务器授权；不得新增自定义原语或由请求控制的用户作用域。
- 新增远程资源、分析、原始 HTML 或可执行嵌入前，审查安全模型和内容安全策略。
