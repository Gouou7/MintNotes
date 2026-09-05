# AGENTS.md

## 项目与文档路由

Mint Notes 是一款使用 React／TypeScript、Fastify 和 SQLite 构建的本地优先、端到端加密 Markdown PWA。为了避免文档重复或逐渐失真，各文档各有侧重。处理任务时只需阅读相关文档；如果改动影响了其中描述的行为，也要同步更新对应文档：

| 任务 | 先读与同步维护 |
| --- | --- |
| 产品能力、快速开始、开发、发布 | `README.md` |
| 用户界面、编辑器行为、历史、附件、同步、导入导出 | `docs/guide.md` |
| 拓扑、持久化、同步、存储、附件 | `docs/system-design.md` |
| 加密、认证、隔离、CSP、元数据 | `docs/trust-and-security.md` |
| Docker、配置、代理、备份、恢复、升级 | `docs/self-hosting.md`；并检查 `.env.example`、Compose 与 Nginx 示例 |
| 编辑器解析、事务、映射、扩展 | `docs/editor-architecture.md`；原则冲突时停止并请求用户决定 |
| 已发布版本的变化 | `CHANGELOG.md` |

`README.md` 和使用指南描述当前已经提供的能力；系统设计、自托管和安全文档解释当前实现及其边界；本文件与编辑器架构原则记录修改项目时必须遵守的约束；变更日志只记录版本历史。尚未实现的设想应放在 Issue 或单独的设计提案中，不要写成现有功能。

同一项事实只在最合适的文档中完整说明，其他地方保留简短摘要和链接即可。判断当前行为时以代码、测试和配置为准；编辑器架构原则则是发布门槛，不能因为实现暂时偏离就直接改写。用户能够感知的行为一旦变化，必须在同一次修改中更新使用指南。

## 不变量

- 按键和本地保存不能等待网络。顺序是内存、浏览器加密、原子 IndexedDB 对象／发件箱、后台上传。
- 服务器不得收到明文标题、Markdown、标签、文件夹结构、历史名称／内容、附件名称／MIME／字节或任何加密密钥。
- 所有用户对象、修订、变更、历史和附件查询都从认证会话取得 `user_id`，不得接受请求指定所有者。
- 冲突、删除和清理不得静默移除唯一剩余修订；文档冲突生成独立副本。设备时间只用于显示。
- 规范 Markdown 是唯一可编辑、可持久化、可交换的正文。解析树、DOM、渲染结果和兼容表示不是权威状态；所有编辑经准确原子源码事务提交。
- 附件密文先持久化，再插入 Markdown 引用；同步先分块，再清单和笔记。一份附件只属于一篇笔记，复制时生成新 UUID 与密钥。
- Service Worker 与 SSE 只能改善可用性，不能承担同步正确性。

## 安全与兼容

- 不实现新密码学原语；使用现有 Worker 与 Web Crypto。AES-GCM 每次使用全新随机 96 位 nonce，并以 AAD 绑定用户、对象／附件、领域、版本、修订或分块位置。
- 生产认证使用 `Secure`、`HttpOnly`、`SameSite=Strict` Cookie；服务器只存哈希。端点标识符与会话分离，不能单独认证。
- PIN 派生密钥、恢复密钥、已解锁密钥、明文或 Blob URL 不得进入持久存储、日志、URL 或服务器。锁定清除解密内存；登出还删除当前用户本地密文与发件箱。
- 原始 HTML、远程可执行嵌入、CDN 脚本与远程字体禁用；新增网络源、分析或嵌入必须审查 `docs/trust-and-security.md` 与 CSP。
- 不重命名 `webmd-*` IndexedDB、Cookie、标头、AAD、附件 URL 或导出标识符，除非实现保留数据的迁移。不得自动删除 v2 前数据库。
- SQLite 使用 WAL；只用 `server/backup.ts` 在线备份。栅格图片按签名验证，拒绝 SVG；内置客户端上限 25 MiB。
- 离线身份快照只允许本地路由；同一已记住端点经 `/api/auth/me` 验证前，禁用同步、SSE、远程附件、账户和管理请求。

## 模块边界

- `src/App.tsx`、`VaultApp.tsx`、`server/index.ts`、`server/app.ts` 只做组合，不承载领域算法。
- `VaultWorkspace.tsx` 与 `server/routes.ts` 是提取边界，不是扩展点；先把相关行为提取为窄 Hook／控制器／领域路由或服务并测试。
- `src/editor/core/` 不导入产品扩展；新扩展通过受限声明契约或类型化源码事务工作，不接收原始编辑器视图。
- 视图不直接调用 Dexie、加密 Worker 或同步 API；服务器路由从认证请求派生作用域。
- 控件图标显式导入 `lucide-react` 并通过 `AppIcon` 渲染；不得用 Emoji、字体或 CDN 图标替代。

## 验证

TypeScript 行为变化运行 `pnpm typecheck` 与 `pnpm test`。加密／Worker／附件加密变化还需构建后运行 `pnpm test:crypto-worker`；认证、API、SQLite、账户、配额或清除变化还需构建后运行 `pnpm test:smoke`；部署配置变化运行 `docker compose config`。重大编辑器、PWA、窗格、拖放或响应式变化运行 `pnpm build`，并说明仍需人工检查的桌面／平板／移动流程。
