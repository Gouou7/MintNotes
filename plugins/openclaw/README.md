# Mint Notes OpenClaw 插件

以独立应用密钥连接 Mint Notes，提供笔记与文件夹列表、本地搜索、读取、在线新建／修改／追加／软删除，以及现有图片附件读取。支持已验证缓存的离线读取。锁定笔记只读；插件没有新上传、删除附件或永久清除工具。

## 构建与安装

要求 Node.js 24.16+、OpenClaw 2026.9.8。插件 SDK 固定在已核对版本，升级宿主前先验证工具与服务生命周期；Windows、macOS、Linux 使用同一 TypeScript／Node 实现，无额外 SQLite 原生扩展。

在仓库根目录：

```bash
pnpm install --frozen-lockfile
pnpm typecheck:openclaw
pnpm build:openclaw
pnpm --filter @mint-notes/openclaw pack --out /tmp/mint-notes-openclaw.tgz
openclaw plugins install /tmp/mint-notes-openclaw.tgz
```

构建产物为 `dist/index.js` 与 `dist/client-worker.js`，发布包包含 manifest、构建产物及本文。Windows 应将示例 `/tmp` 替换为自己的临时目录。安装属于用户自行操作；本仓库的开发检查不会修改正在运行的 Gateway 或用户配置。

## 连接配置

在 Mint Notes 已解锁且在线的客户端，打开设置 → 安全 → 应用连接。创建连接，选择只读或读写、闲置期限及可选固定到期时间，保存仅显示一次的应用密钥。丢失时撤销后重建。

在 OpenClaw 配置里启用 `mint-notes`，提供服务源及 SecretRef。以下为环境 provider 示例；请通过宿主的受保护环境或凭据管理设置值，不要写入仓库、工具调用或聊天消息：

```json
{
  "secrets": {
    "providers": {
      "mint-env": { "source": "env", "allowlist": ["MINT_NOTES_APPLICATION_KEY"] }
    }
  },
  "plugins": {
    "entries": {
      "mint-notes": {
        "enabled": true,
        "config": {
          "baseUrl": "https://notes.example.com",
          "applicationKey": { "source": "env", "provider": "mint-env", "id": "MINT_NOTES_APPLICATION_KEY" },
          "offlineReads": true
        }
      }
    }
  },
  "tools": { "alsoAllow": ["mint-notes"] }
}
```

工具全部注册为 optional，按需要在宿主工具策略中放行整个插件或具体工具。只读授权即使放行写工具，也会被服务器拒绝。SecretRef 的加密保存能力由具体 provider 决定；插件 manifest 声明敏感字段与 capability owner，provider 不可用时应由宿主停止该能力。也支持宿主提供的明文配置值，但不建议直接写进配置文件。

服务地址必须为纯 HTTPS 源，不得带路径、账号、查询或片段；开发仅允许回环 HTTP。首次调用必须联网。关闭 Mint 网页不影响连接，浏览器锁定或登出也不会撤销插件；主密码修改、账户恢复、账户禁用会撤销连接。

## 使用与状态

读取工具返回 `offline` 与 `lastSyncedAt`。先读取笔记取得 revision，写工具必须提供 `expectedRevision`；为同一逻辑写入提前生成并复用 `operationId`，防止追加或新建在重试时重复。`pending` 表示已加密保存在本地但尚未服务器确认；`conflict` 返回冲突副本 ID，原笔记保留服务器版本。

插件只有一个按需启动的 Worker，没有后台心跳；状态检查不延长闲置期限。宿主停用或重载时关闭 Worker 与 SQLite。缓存位于宿主 stateDir 下的 `mint-notes`，只保存密文，不保存应用密钥或 Markdown 明文；未提交操作依赖该缓存，请在确认同步前不要手动删除。

完整工具参数、API、错误和未来适配规范见[应用接口适配](../../docs/application-connections.md)，安全边界见[系统设计](../../docs/system-design.md#应用连接与委托访问)。安装包外可从 [Mint Notes 仓库文档](https://github.com/Gouou7/MintNotes/blob/main/docs/application-connections.md)查看规范。应用密钥授予全保险库解密能力，只交给可信软件；撤销无法删除软件已经保存的数据。

插件包的代码许可证由 `LICENSE` 提供，打包的 TypeBox 许可见 `THIRD_PARTY_NOTICES.txt`；OpenClaw SDK 由宿主提供，不包含在插件运行包中。
