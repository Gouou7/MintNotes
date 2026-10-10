# 应用接口适配

本文面向 OpenClaw 插件、未来读取软件和 MCP 适配器作者。安全承诺以[系统设计](system-design.md#应用连接与委托访问)为准；独立插件的安装见[OpenClaw 插件说明](../plugins/openclaw/README.md)。本版本提供通用客户端与原生应用 API，未提供 MCP 服务。

## 连接流程

1. 用户联网打开 Mint Notes 并解锁，在设置 → 安全 → 应用连接中新建连接。
2. 填写应用名称、只读／读写权限、不活跃期限，可选固定到期时间。
3. 已解锁的浏览器 Worker 随机生成应用密钥，包装保险库密钥，再向服务器登记认证派生值、包装信封与策略。
4. 页面只显示一次完整应用密钥。将服务地址及密钥配置给插件；页面关闭、锁定或登出后插件可独立工作。
5. 插件用认证派生值取回自己的信封，在本地解密保险库，拉取密文并在本地搜索、读取或编辑。
6. 在原页面撤销连接或修改到期策略。丢失密钥只能撤销重建；失效连接不能续期，权限不能原地升级。

网络中断或响应不明时，重试保持原连接 ID、认证派生值、包装信封和策略；明确的客户端错误（限流除外）允许修正表单并重新生成凭据。服务端对完全一致的有效连接返回幂等成功。客户端未确认服务器是否创建成功时不要生成第二把密钥。退出创建界面后，遗留连接可以通过连接列表撤销。

## 目录与运行时

| 路径 | 职责 |
| --- | --- |
| `packages/application-client/src/protocol.ts` | 应用协议、授权模型、期限与错误类型 |
| `packages/application-client/src/crypto.ts` | 浏览器 Worker 与原生客户端共用的 Web Crypto、AAD、凭据与信封 |
| `packages/application-client/src/policy.ts` | 负载验证、锁定笔记策略及未来隐私策略入口 |
| `packages/application-client/src/node/` | 原生传输、SQLite 密文缓存、串行工具调用、同步及持久重试 |
| `server/applications/` | 浏览器授权管理与原生 Bearer 认证 |
| `src/features/applications/` | 安全设置界面及控制器 |
| `plugins/openclaw/` | OpenClaw manifest、可选工具、单 Worker 生命周期与独立构建 |

Mint 主程序仍使用 Node.js 22+。原生适配器使用 Node 内置 `node:sqlite`；本插件要求 Node.js 24.16+，SDK 固定为 OpenClaw 2026.9.8。插件的构建会打包通用客户端，不依赖源码工作区运行。通用客户端暂作为仓库内部包维护，未来独立发布须另外维护版本兼容。

## 凭据与版本

应用密钥格式为 `mint-app-v1.<connectionId>.<seed>`：`connectionId` 为小写 UUID v4，`seed` 为 32 随机字节的无填充 Base64URL。服务器永远不接收完整应用密钥或 seed。

- `authSecret = Base64URL(HMAC-SHA-256(seed, UTF8("webmd-application-authentication-v1:" + connectionId)))`。
- `wrappingKey = HMAC-SHA-256(seed, UTF8("webmd-application-vault-wrapping-v1:" + connectionId))`。
- 用包装密钥 AES-256-GCM 加密 32 字节保险库密钥，每次产生新的 12 字节 nonce；AAD 为 `webmd:<userId>:<connectionId>:application-vault-envelope:v1`。
- 包装信封为 `{ version: 1, ciphertext, nonce }`，编码均为无填充 Base64URL；密文包含 GCM tag。
- 原生认证头为 `Authorization: Bearer <connectionId>.<authSecret>`。完整应用密钥不得直接放入 HTTP 头、URL、日志或工具参数。

bootstrap 声明 `protocolVersion: 1`、`objectSchemaVersion: 2`、`encryptionVersion: 1`。不兼容版本、账户或信封拒绝解密，不自动删除旧缓存。现有对象、历史及附件沿用 `webmd-*` AAD 和标头，准确格式以共享 `crypto.ts` 为准；不得用应用品牌重新命名协议。

## 浏览器管理 API

以下路径前缀为 `/api/account/application-connections`，仅在线浏览器会话可用，遵循已有 Cookie／Origin 规则；表中的 `/` 表示前缀本身，不附加尾斜杠。客户端在解锁后才生成信封，服务器不把有效会话视为已经证明解锁。

| 方法与路径 | 请求 | 响应 |
| --- | --- | --- |
| `GET /` | 无 | `{ connections: ApplicationConnection[] }`，不返回密钥、认证派生值或信封 |
| `POST /` | `connectionId, name, access, authSecret, vaultEnvelope, idleTimeoutDays, expiresAt` | `201 { connection }`；完全相同重试返回 `200 { connection, idempotent: true }` |
| `PATCH /:id` | `name, idleTimeoutDays, expiresAt` 三项全部提供 | `{ connection }`；不可改变权限或信封 |
| `DELETE /:id` | 无 | `{ ok: true }`，幂等撤销 |
| `POST /revoke-all` | 无 | `{ ok: true }` |

`access` 为 `read` 或 `read-write`；`idleTimeoutDays` 为 `7`、`30`、`90` 或 `null`；`expiresAt` 为含时区的 ISO 8601 时间或 `null`。名称限制 80 字符，每账户最多 50 个有效连接。响应包含 `createdAt`、`lastUsedAt`、`revokedAt`、`validUntil` 和 `status`（`active`／`expired`／`revoked`）。实际失效时间取固定期限与「最后业务活动时间，未使用时取创建时间，加不活跃期限」的较早值。

## 原生密文 API

统一前缀 `/api/apps/v1`，仅接受自己的 Bearer 凭据。HTTPS 地址只能是绝对源，如 `https://notes.example.com`；本地开发允许回环 HTTP。客户端禁止 URL 用户名、密码、路径、查询、片段和 HTTP 重定向，不携带浏览器 Cookie。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /connection` | 返回连接策略、服务器时间、账户 ID、包装信封、版本及 `historyEnabled`；不更新活动时间 |
| `GET /sync?since=<cursor>&limit=200&compact=1` | 密文变更页 `{ changes, cursor, hasMore }`；服务器游标回退时返回 `{ changes: [], cursor: 0, hasMore: true, reset: true }` |
| `GET /objects/:id` | 当前用户的一个 `EncryptedObject`，不存在或跨账户均返回 404 |
| `PUT /objects/:id` | 复用对象写协议：`objectType, ciphertext, nonce, encryptionVersion, baseRevision, deleted, idempotencyKey` |
| `POST /objects/batch` | 复用批量对象协议，供其他适配器使用；插件逐项保存 |
| `GET /attachments/:id/chunks/:index` | 附件密文二进制与已有 `X-WebMD-*` 标头 |
| `PUT /attachments/:id/chunks/:index` | 写入密文分块，用于适配器内部冲突副本；只读连接拒绝 |
| `POST /notes/:noteId/history/:historyId` | 保存编辑前的密文历史快照；沿用历史协议与幂等键 |

对象及批量请求的准确校验与错误沿用 `server/sync/objectStore.ts`；附件沿用 `server/attachments/routes.ts`；历史沿用 `server/history/routes.ts`。这些接口不能收到明文负载。服务端使用认证所得 `user_id`，请求不允许指定所有者。Bearer 不适用于 `/api/auth`、`/api/account`、`/api/admin` 或普通浏览器数据接口。应用 API 未暴露 SSE、永久清除、历史读取／设置／删除和连接管理。

写入以服务器修订为依据：待提交内容加密绑定 `baseRevision + 1`，重试必须复用完整原请求和幂等键，不能为相同重试重加密。读取页中所有对象认证、解密与结构验证成功后，才原子落库并推进游标；失败保留原游标。插件使用 `compact=1` 读取每页最新对象，但不会越过未经验证的一页。

## 通用客户端调用

构建后，在自己的可信 Worker 中调用；不要把密钥放进模型可见参数。状态目录由宿主提供，与用户正在编辑的 Markdown 目录分开。

```typescript
import { ApplicationClient } from "@mint-notes/application-client/node";

const client = await ApplicationClient.open({
  baseUrl: "https://notes.example.com",
  applicationKey: await readFromTrustedCredentialProvider(),
  stateDir: hostStateDirectory,
  offlineReads: true
});
try {
  const result = await client.execute("mint_notes_search", { query: "项目" }, abortSignal);
  // 只向模型返回用户授权读取的结果。
} finally {
  await client.close();
}
```

| 工具 | 参数与结果 |
| --- | --- |
| `mint_notes_status` | 无参数；连接策略、离线标记、最近同步时间及待提交操作 |
| `mint_notes_list` | 可选 `parentId`（`null` 为根目录）、`tag`、`favorite`、`offset`、`limit`（1–100）；返回笔记／文件夹元数据，不含正文 |
| `mint_notes_search` | 必填 `query`，其余过滤同上；标题、标签、正文搜索，返回最多 240 字符片段 |
| `mint_notes_get` | `noteId`；完整 Markdown、修订、`canRead`、`canWrite`、`pending` |
| `mint_notes_create` | `title`，可选 `markdown`、`parentId`、`tags`、`favorite`、`operationId` |
| `mint_notes_update` | `noteId, expectedRevision`；可选标题、正文、文件夹、标签、收藏及 `operationId` |
| `mint_notes_append` | `noteId, expectedRevision, markdown`，可选 `operationId`；按原样追加，不自动添加换行 |
| `mint_notes_trash` | `noteId, expectedRevision`，可选 `operationId`；只做软删除 |
| `mint_notes_read_attachment` | `noteId, attachmentId`；原生客户端返回验证后的 `ArrayBuffer`，OpenClaw 转换为 image tool content |

普通读取结果包含 `offline`、`lastSyncedAt`。写结果为 `{ operationId, objectId, status, revision?, conflictNoteId?, errorCode? }`：

- `committed`：服务器已确认，操作回执与新对象原子落库。
- `pending`：请求已加密持久化，但尚未确认；不能告诉用户已经同步成功。下次在线业务调用串行重试，`status` 可查看操作。
- `conflict`：原笔记保留服务器版本，返回独立冲突副本 ID；副本及其附件先持久化为同一个重试图，再按分块 → 附件清单 → 笔记上传。

建议每次写入由调用方生成 UUID `operationId`；同一逻辑请求重试复用 ID 与完全相同参数，不同参数复用 ID 返回 `IDEMPOTENCY_CONFLICT`。未提供时客户端会生成 ID；如果调用方连响应都未收到，只能先查询状态或核对笔记，不能假设重新调用不会重复创建。追加尤其应预先记录操作 ID。

重试遵守用户清空历史的屏障，不重新创建已清除的旧快照；原笔记被永久清除时，待提交内容保留为新的冲突副本，不恢复原对象 ID。

新写入前必须在线确认连接并完成同步；离线拒绝。已缓存附件仅在归属笔记匹配、引用有效、分块 AAD／标签、大小、摘要和图片签名全部通过时才返回。修改不允许新增或移除现有附件引用；无附件上传／删除工具。内部冲突复制不复用附件 ID 与密钥。

## 缓存、生命周期与错误

SQLite 文件按 HTTPS 源的摘要和连接 UUID 分隔，使用 WAL；目录及文件在支持的系统上限制为 0700／0600。对象、附件分块、待写内容及冲突图保持密文；操作参数摘要使用保险库派生的 HMAC，避免缓存裸正文摘要。附件缓存按 128 MiB LRU 清理，尚未确认的操作所需原附件不清理；待写图可能暂时超过缓存目标。同步游标与本地授权元数据不是机密正文。

适配器须串行操作同一连接，取消时停止网络请求，关闭时等待队列并清空密钥、关闭 SQLite。OpenClaw 服务退出会给予 Worker 短暂清理时间，随后终止；下次启动仍能继续已落库的密文请求。配置改变或凭据 provider 失效应停用旧运行时，不能把已缓存凭据当作新的授权。

| 错误 | 调用方处理 |
| --- | --- |
| `APPLICATION_INVALID`／`APPLICATION_REVOKED`／`APPLICATION_EXPIRED` | 停止解密与写入，提示用户在 Mint 创建新连接；不自动删掉未提交数据 |
| `APPLICATION_READ_ONLY`／`NOTE_LOCKED` | 不重试写入，不尝试修改权限或锁定状态 |
| `OFFLINE_WRITE_DISABLED`／`OFFLINE_CACHE_MISSING` | 联网再试；首次使用不能离线读取 |
| `REVISION_CONFLICT` | 在新操作中重新读取、核对内容，不能悄悄提高 expectedRevision 覆盖服务器内容 |
| `IDEMPOTENCY_CONFLICT` | 换新的操作 ID 前先核对已有回执；不要修改旧重试请求 |
| `NOTE_PENDING` | 先恢复网络并处理既有待提交操作 |
| `ATTACHMENT_REFERENCE_CHANGE` | 保留原有引用，附件编辑回到 Mint 本体完成 |
| `PROTOCOL_UNSUPPORTED`／`CACHE_VERSION_UNSUPPORTED`／`INVALID_RESPONSE`／`INVALID_OBJECT` | 停止相应读取或同步，保留缓存及游标，升级或排查适配器 |
| `CANCELLED`／`CLIENT_STOPPED` | 取消已开始的调用，重新启动后检查是否有待提交操作 |

适配器不记录原始错误、响应、笔记或密钥，只公开固定错误码。模型可见工具参数仅含笔记操作，不能包括凭据；笔记正文属于用户数据，不能被视为更高优先级指令。未来 MCP 或读取软件应复用共享协议与客户端，自己负责凭据 provider、宿主生命周期、结果格式和授权后的数据去向；新增隐私能力必须先重新设计密钥隔离，不能只在列表中过滤后宣称安全隔离。
