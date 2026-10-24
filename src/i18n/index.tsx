import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { LanguagePreference } from "../types";

export const SUPPORTED_LOCALES = ["en", "zh-CN", "zh-TW"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type { LanguagePreference } from "../types";
export type TranslationValues = Record<string, string | number>;

const LANGUAGE_STORAGE_KEY = "webmd-notes-language";

const messages = {
  "storage.browserStorage": {"en": "Browser storage", "zh-CN": "浏览器存储", "zh-TW": "瀏覽器儲存"},
  "storage.databaseDetails": {"en": "Details", "zh-CN": "详细信息", "zh-TW": "詳細資訊"},
  "storage.retentionRules": {"en": "Retention rules", "zh-CN": "保留规则", "zh-TW": "保留規則"},
  "storage.pending": {"en": "Pending sync", "zh-CN": "待同步", "zh-TW": "待同步"},
  "storage.objects": { en: "Objects", "zh-CN": "对象", "zh-TW": "物件" },
  "storage.pendingCounts": {"en": "{objects} objects · {attachments} attachments · {history} versions", "zh-CN": "对象{objects}，附件{attachments}，历史{history}", "zh-TW": "物件{objects}，附件{attachments}，歷史{history}"},
  "storage.unsaved": {"en": "Awaiting local save", "zh-CN": "本地待保存", "zh-TW": "本機待儲存"},
  "storage.noteCount": {"en": "{count} notes", "zh-CN": "{count}篇", "zh-TW": "{count}篇"},
  "storage.localEstimate": {"en": "Local payload estimate", "zh-CN": "本地载荷估算", "zh-TW": "本機載荷估算"},
  "storage.lastCompleteSync": {"en": "Last complete sync", "zh-CN": "最近完整同步", "zh-TW": "最近完整同步"},
  "storage.siteEstimateLabel": {"en": "Site usage / capacity estimate", "zh-CN": "本站用量／容量估算", "zh-TW": "本站用量／容量估算"},
  "storage.pendingUnknown": {"en": "Checking pending data. Signing out removes local changes.", "zh-CN": "正在核对待同步数据。退出会清除本地修改。", "zh-TW": "正在核對待同步資料。登出會清除本機修改。"},
  "storage.title": {"en": "Notes and storage", "zh-CN": "笔记和存储", "zh-TW": "筆記與儲存"},
  "storage.refresh": {"en": "Refresh", "zh-CN": "刷新", "zh-TW": "重新整理"},
  "storage.total": {"en": "Total storage", "zh-CN": "总存储用量", "zh-TW": "總儲存用量"},
  "storage.totalQuota": {"en": "Total quota", "zh-CN": "总配额", "zh-TW": "總配額"},
  "storage.notes": {"en": "Notes", "zh-CN": "笔记", "zh-TW": "筆記"},
  "storage.attachments": {"en": "Attachments", "zh-CN": "附件", "zh-TW": "附件"},
  "storage.avatar": {"en": "Avatar", "zh-CN": "头像", "zh-TW": "頭像"},
  "storage.trashIncluded": {"en": "Includes {size} in trash.", "zh-CN": "含回收站{size}。", "zh-TW": "含資源回收筒{size}。"},
  "storage.updatedAt": {"en": "Updated {date}", "zh-CN": "更新于{date}", "zh-TW": "更新於{date}"},
  "storage.cachedAt": {"en": "Cached {date}", "zh-CN": "缓存于{date}", "zh-TW": "快取於{date}"},
  "storage.local": {"en": "Local status", "zh-CN": "本地状态", "zh-TW": "本機狀態"},
  "storage.localPayload": {"en": "Your encrypted payload estimate: {size}", "zh-CN": "当前用户本地密文载荷估算：{size}", "zh-TW": "目前使用者本機密文載荷估算：{size}"},
  "storage.pendingSummary": {"en": "Pending sync: {objects} objects, {attachments} attachments, {history} history versions. Notes awaiting local save: {unsaved}.", "zh-CN": "待同步：{objects}个对象、{attachments}个附件、{history}个历史版本。尚未完成本地保存：{unsaved}篇笔记。", "zh-TW": "待同步：{objects}個物件、{attachments}個附件、{history}個歷史版本。尚未完成本機儲存：{unsaved}篇筆記。"},
  "storage.lastSync": {"en": "Last complete sync: {date}", "zh-CN": "最近完整同步成功：{date}", "zh-TW": "最近完整同步成功：{date}"},
  "storage.neverSynced": {"en": "Not recorded yet", "zh-CN": "尚无记录", "zh-TW": "尚無記錄"},
  "storage.siteEstimate": {"en": "Site storage estimate: {used} / browser capacity estimate: {quota}", "zh-CN": "本站占用估算：{used}／浏览器容量估算：{quota}", "zh-TW": "本站佔用估算：{used}／瀏覽器容量估算：{quota}"},
  "storage.unknown": {"en": "Unknown", "zh-CN": "未知", "zh-TW": "未知"},
  "storage.estimateUnavailable": {"en": "Storage estimates are unavailable in this browser.", "zh-CN": "此浏览器暂无法提供存储估算。", "zh-TW": "此瀏覽器暫無法提供儲存估算。"},
  "storage.estimateHelp": {"en": "Site estimates include other accounts and caches; they are not exact user usage or free disk space.", "zh-CN": "本站估算包含其他账户及缓存，不代表用户精确用量或磁盘余量。", "zh-TW": "本站估算包含其他帳戶及快取，不代表使用者精確用量或磁碟餘量。"},
  "storage.requestPersistence": {"en": "Request persistence", "zh-CN": "申请持久存储", "zh-TW": "申請持久儲存"},
  "storage.persistence.unsupported": {"en": "Persistence unavailable", "zh-CN": "不支持持久存储", "zh-TW": "不支援持久儲存"},
  "storage.persistence.granted": {"en": "Persistent storage granted", "zh-CN": "持久存储已授权", "zh-TW": "持久儲存已授權"},
  "storage.persistence.best-effort": {"en": "Persistent storage not granted", "zh-CN": "持久存储未授权", "zh-TW": "持久儲存未授權"},
  "storage.persistence.denied": {"en": "Persistence request declined", "zh-CN": "持久存储申请未获准", "zh-TW": "持久儲存申請未獲准"},
  "storage.persistenceHelp": {"en": "Persistence reduces automatic eviction. It does not replace backups or prevent manual removal.", "zh-CN": "持久存储可降低自动回收风险，不能替代备份或阻止手动清除。", "zh-TW": "持久儲存可降低自動回收風險，不能替代備份或阻止手動清除。"},
  "storage.noServerUsage": {"en": "Connect to load usage.", "zh-CN": "联网后可读取用量。", "zh-TW": "連線後可讀取用量。"},
  "storage.level.normal": {"en": "Within quota", "zh-CN": "空间充足", "zh-TW": "空間充足"},
  "storage.level.warning": {"en": "At least 80% used", "zh-CN": "已用空间达到80%", "zh-TW": "已用空間達到80%"},
  "storage.level.critical": {"en": "At least 95% used", "zh-CN": "已用空间达到95%", "zh-TW": "已用空間達到95%"},
  "storage.level.full": {"en": "Quota reached; growing uploads are paused", "zh-CN": "已达配额，增加用量的上传暂停", "zh-TW": "已達配額，增加用量的上傳暫停"},
  "storage.level.unlimited": {"en": "No total quota limit", "zh-CN": "总配额不限", "zh-TW": "總配額不限"},
  "storage.warningNotice": {"en": "Storage usage reached 80%.", "zh-CN": "存储用量已达80%。", "zh-TW": "儲存用量已達80%。"},
  "storage.criticalNotice": {"en": "Storage usage reached 95%. Free space or increase the quota.", "zh-CN": "存储用量已达95%，请释放空间或调整配额。", "zh-TW": "儲存用量已達95%，請釋放空間或調整配額。"},
  "storage.fullNotice": {"en": "Quota reached. Local changes are retained; free space to resume uploads.", "zh-CN": "存储已达配额，本地修改已保留。释放空间后可继续上传。", "zh-TW": "儲存已達配額，本機修改已保留。釋放空間後可繼續上傳。"},
  "storage.inherit": {"en": "Use server default", "zh-CN": "使用服务器默认值", "zh-TW": "使用伺服器預設值"},
  "storage.customLimit": {"en": "Custom", "zh-CN": "自定义", "zh-TW": "自訂"},
  "storage.unlimited": {"en": "Unlimited", "zh-CN": "不限", "zh-TW": "不限"},
  "storage.capacityMiB": {"en": "Capacity (MiB)", "zh-CN": "容量（MiB）", "zh-TW": "容量（MiB）"},
  "storage.historyBudget": {"en": "Note history quota", "zh-CN": "笔记历史配额", "zh-TW": "筆記歷史配額"},
  "storage.historyBudgetHelp": {"en": "History counts toward the total quota. Unlimited removes only this budget.", "zh-CN": "历史计入总配额。“不限”仅取消历史单独上限。", "zh-TW": "歷史計入總配額。「不限」僅取消歷史單獨上限。"},
  "storage.saveQuota": {"en": "Save quota", "zh-CN": "保存配额", "zh-TW": "儲存配額"},
  "storage.editQuota": {"en": "Edit quota", "zh-CN": "设置配额", "zh-TW": "設定配額"},
  "storage.userQuota": {"en": "Storage quota for {name}", "zh-CN": "{name}的存储配额", "zh-TW": "{name}的儲存配額"},
  "storage.lowerQuotaWarning": {"en": "Below current usage. Keep existing data and restrict growth.", "zh-CN": "新配额低于已有用量。确认保留数据，并限制后续增长。", "zh-TW": "新配額低於已有用量。確認保留資料，並限制後續增長。"},
  "storage.quotaSaved": {"en": "Storage quota updated.", "zh-CN": "存储配额已更新。", "zh-TW": "儲存配額已更新。"},
  "storage.quotaSaveFailed": {"en": "Unable to update the storage quota.", "zh-CN": "无法更新存储配额。", "zh-TW": "無法更新儲存配額。"},
  "storage.migration": {"en": "Note migration", "zh-CN": "笔记迁移", "zh-TW": "筆記遷移"},
  "storage.exportAll": {"en": "Export complete ZIP", "zh-CN": "导出完整压缩包", "zh-TW": "匯出完整壓縮包"},
  "storage.importPackage": {"en": "Import ZIP or notes", "zh-CN": "导入压缩包或笔记", "zh-TW": "匯入壓縮包或筆記"},
  "storage.exportScope": {"en": "Includes current notes and attachments; excludes history and trash. The ZIP is unencrypted.", "zh-CN": "包含当前笔记及附件，不含历史和回收站。压缩包为明文。", "zh-TW": "包含目前筆記及附件，不含歷史和資源回收筒。壓縮包為明文。"},
  "storage.transferFailed": {"en": "Import or export failed. Your data is retained.", "zh-CN": "导入或导出失败，原数据仍保留。", "zh-TW": "匯入或匯出失敗，原資料仍保留。"},
  "storage.databaseFailed": {"en": "Database status is unavailable. Refresh to retry.", "zh-CN": "无法获取数据库状态，请刷新重试。", "zh-TW": "無法取得資料庫狀態，請重新整理重試。"},
  "storage.databaseState": {"en": "SQLite {sqlite} · Schema {schema} · {journal}", "zh-CN": "SQLite {sqlite} · 结构{schema} · {journal}", "zh-TW": "SQLite {sqlite} · 結構{schema} · {journal}"},
  "storage.databaseReady": {"en": "Database available", "zh-CN": "数据库连接正常", "zh-TW": "資料庫連線正常"},
  "storage.databaseFiles": {"en": "Database files total", "zh-CN": "数据库文件总占用", "zh-TW": "資料庫檔案總佔用"},
  "storage.databaseFile": {"en": "Main database file", "zh-CN": "数据库主文件", "zh-TW": "資料庫主檔案"},
  "storage.wal": {"en": "WAL file", "zh-CN": "WAL日志文件", "zh-TW": "WAL日誌檔案"},
  "storage.shm": {"en": "Shared memory file", "zh-CN": "共享内存文件", "zh-TW": "共用記憶體檔案"},
  "storage.reusable": {"en": "Reusable space inside database", "zh-CN": "数据库内部可复用空间", "zh-TW": "資料庫內部可重用空間"},
  "storage.allUserData": {"en": "All users' logical data", "zh-CN": "全部用户逻辑数据用量", "zh-TW": "全部使用者邏輯資料用量"},
  "storage.databaseReadOnly": {"en": "Reusable space is included in the database file. Maintenance requires the stopped-service tools.", "zh-CN": "可复用空间已计入文件大小。维护需停机执行。", "zh-TW": "可重用空間已計入檔案大小。維護需停機執行。"},
  "notice.metadataQuotaReached": { en: "Synchronization records reached their limit. New writes are paused; synced notes can still be cleared from the trash.", "zh-CN": "同步记录已达上限，暂时无法新增写入；仍可永久清除已同步的回收项。", "zh-TW": "同步記錄已達上限，暫時無法新增寫入；仍可永久清除已同步的回收項。" },
  "notice.historyClearResult": { en: "Deleted {deleted} history versions; retained {preserved} protected versions.", "zh-CN": "已删除{deleted}个历史版本，保留{preserved}个保护版本。", "zh-TW": "已刪除{deleted}個歷史版本，保留{preserved}個保護版本。" },
  "storage.logical": { en: "Storage usage", "zh-CN": "存储用量", "zh-TW": "儲存用量" },
  "storage.content": { en: "Current notes and attachments", "zh-CN": "当前笔记与附件", "zh-TW": "目前筆記與附件" },
  "storage.physical": { en: "Server disk usage", "zh-CN": "服务器磁盘占用", "zh-TW": "伺服器磁碟用量" },
  "storage.physicalHelp": { en: "Shared disk files include reusable SQLite pages and backups. These figures differ from account quotas.", "zh-CN": "共享文件包含SQLite可复用空闲页和备份，其大小与账户配额用量不同。", "zh-TW": "共用檔案包含SQLite可重用空閒頁與備份，其大小與帳戶配額用量不同。" },
  "storage.database": { en: "Database", "zh-CN": "数据库", "zh-TW": "資料庫" },
  "storage.backups": { en: "Backups", "zh-CN": "备份", "zh-TW": "備份" },
  "storage.unavailable": { en: "Connect to the server to refresh usage.", "zh-CN": "连接服务器后可刷新用量。", "zh-TW": "連線伺服器後可更新用量。" },
  "storage.cacheHelp": { en: "Synced attachment and history caches use up to 128 MiB and 64 MiB. Older downloads may require a network connection. Pending data is retained.", "zh-CN": "已同步附件与历史正文缓存上限分别为128 MiB和64 MiB，较早下载的内容可能需要重新联网读取。待同步数据始终保留。", "zh-TW": "已同步附件與歷史正文快取上限分別為128 MiB與64 MiB，較早下載的內容可能需要重新連線讀取。待同步資料一律保留。" },
  "notice.recoveredHistoryMetadata": { en: "Recovered history metadata: {name} ({date}). The original historical body is no longer available on the server.", "zh-CN": "已恢复历史元数据：{name}（{date}）。服务器上的原历史正文已不可用。", "zh-TW": "已復原歷史中繼資料：{name}（{date}）。伺服器上的原歷史正文已無法取得。" },
  "history.kindApplicationEdit": { en: "Before application edit", "zh-CN": "应用编辑前", "zh-TW": "應用編輯前" },
  "history.offlineAvailable": { en: "Available offline", "zh-CN": "可离线读取", "zh-TW": "可離線讀取" },
  "history.downloadRequired": { en: "Download required", "zh-CN": "需联网下载", "zh-TW": "需連線下載" },
  "notice.recoveryMissingAttachments": { en: "Recovery copy saved; {count} unavailable attachments could not be recovered. Their references remain in the text.", "zh-CN": "已保存恢复副本；{count}个不可用附件未能恢复，其引用保留在正文中。", "zh-TW": "已儲存復原副本；{count}個無法取得的附件未能復原，其引用保留在正文中。" },
  "notice.syncUpgradeRequired": { en: "Update this client to resume synchronization. Local data is retained.", "zh-CN": "请更新客户端后继续同步，本地数据已保留。", "zh-TW": "請更新用戶端後繼續同步，本機資料已保留。" },
  "notice.operationExpired": { en: "An operation expired. Its local data is retained; reconcile and recover the proposal before retrying.", "zh-CN": "操作已过期，本地数据已保留；请先校准并恢复本地副本。", "zh-TW": "操作已過期，本機資料已保留；請先校準並復原本機副本。" },
  "notice.ownershipIncomplete": { en: "Unlock and finish attachment reconciliation before permanently clearing notes.", "zh-CN": "请先解锁并完成附件归属校准，再永久清除笔记。", "zh-TW": "請先解鎖並完成附件歸屬校準，再永久清除筆記。" },
  "applications.title": {"en": "Application connections", "zh-CN": "应用连接", "zh-TW": "應用連線"},
  "applications.help": {"en": "Use separate keys to connect trusted applications. Locked notes are read-only. Revocation cannot remove existing offline copies.", "zh-CN": "使用独立密钥连接可信应用。锁定笔记为只读。撤销连接无法删除已有离线副本。", "zh-TW": "使用獨立金鑰連線可信任的應用程式。鎖定筆記為唯讀。撤銷連線無法刪除既有離線副本。"},
  "applications.add": {"en": "Add application", "zh-CN": "添加应用", "zh-TW": "新增應用"},
  "applications.refresh": {"en": "Refresh", "zh-CN": "刷新", "zh-TW": "重新整理"},
  "applications.revokeAll": {"en": "Revoke all applications", "zh-CN": "撤销所有应用", "zh-TW": "撤銷所有應用"},
  "applications.failed": {"en": "Unable to complete the request. Please retry.", "zh-CN": "操作失败。请重试。", "zh-TW": "操作失敗。請重試。"},
  "applications.name": {"en": "Application name", "zh-CN": "应用名称", "zh-TW": "應用名稱"},
  "applications.permission": {"en": "Permission", "zh-CN": "权限", "zh-TW": "權限"},
  "applications.readWrite": {"en": "Read and write", "zh-CN": "读写", "zh-TW": "讀寫"},
  "applications.readOnly": {"en": "Read only", "zh-CN": "只读", "zh-TW": "唯讀"},
  "applications.idleExpiry": {"en": "Inactivity timeout", "zh-CN": "闲置期限", "zh-TW": "閒置期限"},
  "applications.days": {"en": "{count} days", "zh-CN": "{count} 天", "zh-TW": "{count} 天"},
  "applications.never": {"en": "Never", "zh-CN": "永不", "zh-TW": "永不"},
  "applications.fixedExpiry": {"en": "Fixed expiry (optional)", "zh-CN": "固定到期时间（可选）", "zh-TW": "固定到期時間（選填）"},
  "applications.policyHelp": {"en": "Inactivity is measured from the last online data access. Permission changes require a new connection. Writing requires an online connection.", "zh-CN": "闲置时间从最近一次在线数据访问起计算。更改权限需新建连接。写入数据需联网。", "zh-TW": "閒置時間自最近一次線上資料存取起計算。變更權限需建立新連線。寫入資料需連網。"},
  "applications.retry": {"en": "Retry creation", "zh-CN": "重试创建", "zh-TW": "重試建立"},
  "applications.generate": {"en": "Generate application key", "zh-CN": "生成应用密钥", "zh-TW": "產生應用金鑰"},
  "applications.newKey": {"en": "New application key", "zh-CN": "新应用密钥", "zh-TW": "新應用金鑰"},
  "applications.once": {"en": "This key is shown only once. Save it before closing. If lost, create a new connection.", "zh-CN": "密钥仅显示一次。关闭前请保存至应用。丢失后需新建连接。", "zh-TW": "金鑰僅顯示一次。關閉前請儲存至應用程式。遺失後需建立新連線。"},
  "applications.serverUrl": {"en": "Server address", "zh-CN": "服务地址", "zh-TW": "服務位址"},
  "applications.key": {"en": "Application key", "zh-CN": "应用密钥", "zh-TW": "應用金鑰"},
  "applications.copyUrl": {"en": "Copy address", "zh-CN": "复制地址", "zh-TW": "複製位址"},
  "applications.copyKey": {"en": "Copy key", "zh-CN": "复制密钥", "zh-TW": "複製金鑰"},
  "applications.savedKey": {"en": "Saved, close", "zh-CN": "已保存，关闭", "zh-TW": "已儲存，關閉"},
  "applications.copied": {"en": "Copied", "zh-CN": "已复制", "zh-TW": "已複製"},
  "applications.copyFailed": {"en": "Unable to copy. Select the content and copy it manually.", "zh-CN": "复制失败。请选中内容后手动复制。", "zh-TW": "複製失敗。請選取內容後手動複製。"},
  "applications.removeDevice": {"en": "Remove device", "zh-CN": "移除设备", "zh-TW": "移除裝置"},
  "applications.revoke": {"en": "Revoke", "zh-CN": "撤销", "zh-TW": "撤銷"},
  "applications.confirmAll": {"en": "Revoke all application connections? Online access will end. Existing offline copies will remain.", "zh-CN": "撤销所有应用连接？在线访问权限将失效。已有离线副本仍会保留。", "zh-TW": "撤銷所有應用程式連線？線上存取權限將失效。既有離線副本仍會保留。"},
  "applications.confirmOne": {"en": "Revoke this application connection? Online access will end. Existing offline copies will remain.", "zh-CN": "撤销此应用连接？在线访问权限将失效。已有离线副本仍会保留。", "zh-TW": "撤銷此應用程式連線？線上存取權限將失效。既有離線副本仍會保留。"},
  "applications.empty": {"en": "No application connections", "zh-CN": "尚无应用连接", "zh-TW": "尚無應用連線"},
  "applications.active": {"en": "Active", "zh-CN": "有效", "zh-TW": "有效"},
  "applications.expired": {"en": "Expired", "zh-CN": "已到期", "zh-TW": "已到期"},
  "applications.revoked": {"en": "Revoked", "zh-CN": "已撤销", "zh-TW": "已撤銷"},
  "applications.created": {"en": "Created: {date}", "zh-CN": "创建：{date}", "zh-TW": "建立：{date}"},
  "applications.lastUsed": {"en": "Last used: {date}", "zh-CN": "最近使用：{date}", "zh-TW": "最近使用：{date}"},
  "applications.unused": {"en": "Not yet used", "zh-CN": "尚未使用", "zh-TW": "尚未使用"},
  "applications.idlePolicy": {"en": "Inactivity timeout: {value}", "zh-CN": "闲置期限：{value}", "zh-TW": "閒置期限：{value}"},
  "applications.expires": {"en": "Valid until: {date}", "zh-CN": "有效期限：{date}", "zh-TW": "有效期限：{date}"},
  "applications.edit": {"en": "Edit", "zh-CN": "编辑", "zh-TW": "編輯"},
  "editor.backToFootnote": { en: "Back to footnote reference", "zh-CN": "返回脚注引用", "zh-TW": "返回註腳引用" },
  "editor.sourceLabel": { en: "Markdown source", "zh-CN": "Markdown 源码", "zh-TW": "Markdown 原始碼" },
  "editor.toggleCallout": { en: "Toggle callout", "zh-CN": "展开或折叠 Callout", "zh-TW": "展開或摺疊 Callout" },
  "editor.diagramRendering": { en: "Rendering diagram…", "zh-CN": "正在渲染图表…", "zh-TW": "正在繪製圖表…" },
  "editor.diagramFailed": { en: "Unable to render Mermaid diagram", "zh-CN": "无法渲染 Mermaid 图表", "zh-TW": "無法繪製 Mermaid 圖表" },
  "editor.diagramAlt": { en: "Mermaid diagram", "zh-CN": "Mermaid 图表", "zh-TW": "Mermaid 圖表" },
  "editor.insertRetry": { en: "The insertion position changed. Please insert the attachment again.", "zh-CN": "插入位置已变化，请重新插入附件。", "zh-TW": "插入位置已變更，請重新插入附件。" },
  "editor.tableSize": { en: "Resize table", "zh-CN": "调整表格大小", "zh-TW": "調整表格大小" },
  "editor.tableDelete": { en: "Delete table", "zh-CN": "删除表格", "zh-TW": "刪除表格" },
  "editor.alignLeft": { en: "Align left", "zh-CN": "左对齐", "zh-TW": "靠左對齊" },
  "editor.alignCenter": { en: "Align center", "zh-CN": "居中对齐", "zh-TW": "置中對齊" },
  "editor.alignRight": { en: "Align right", "zh-CN": "右对齐", "zh-TW": "靠右對齊" },
  "editor.rows": { en: "Rows", "zh-CN": "行数", "zh-TW": "列數" },
  "editor.columns": { en: "Columns", "zh-CN": "列数", "zh-TW": "欄數" },
  "editor.codeLanguage": { en: "Code language", "zh-CN": "代码语言", "zh-TW": "程式碼語言" },
  "editor.invalidCodeLanguage": { en: "Code language cannot contain backticks or line breaks.", "zh-CN": "代码语言不能包含反引号或换行。", "zh-TW": "程式碼語言不能包含反引號或換行。" },
  "editor.calloutType": { en: "Callout type", "zh-CN": "Callout 类型", "zh-TW": "Callout 類型" },
  "editor.calloutTitle": { en: "Callout title", "zh-CN": "Callout 标题", "zh-TW": "Callout 標題" },
  "common.close": { en: "Close", "zh-CN": "关闭", "zh-TW": "關閉" },
  "common.cancel": { en: "Cancel", "zh-CN": "取消", "zh-TW": "取消" },
  "common.copy": { en: "Copy", "zh-CN": "复制", "zh-TW": "複製" },
  "editor.copyCode": { en: "Copy code", "zh-CN": "复制代码", "zh-TW": "複製程式碼" },
  "editor.codeText": { en: "Text", "zh-CN": "文本", "zh-TW": "文字" },
  "editor.codeCopied": { en: "Code copied", "zh-CN": "代码已复制", "zh-TW": "程式碼已複製" },
  "editor.codeCopyFailed": { en: "Could not copy code", "zh-CN": "无法复制代码", "zh-TW": "無法複製程式碼" },
  "common.download": { en: "Download", "zh-CN": "下载", "zh-TW": "下載" },
  "common.upload": { en: "Upload", "zh-CN": "上传", "zh-TW": "上傳" },
  "common.replace": { en: "Replace", "zh-CN": "更换", "zh-TW": "更換" },
  "common.remove": { en: "Remove", "zh-CN": "移除", "zh-TW": "移除" },
  "common.save": { en: "Save", "zh-CN": "保存", "zh-TW": "儲存" },
  "common.unknown": { en: "Unknown", "zh-CN": "未知", "zh-TW": "未知" },
  "common.default": { en: "default", "zh-CN": "默认", "zh-TW": "預設" },
  "language.label": { en: "Language", "zh-CN": "语言", "zh-TW": "語言" },
  "language.selector": { en: "Interface language", "zh-CN": "界面语言", "zh-TW": "介面語言" },
  "language.system": { en: "Follow browser", "zh-CN": "跟随浏览器", "zh-TW": "跟隨瀏覽器" },
  "pwa.update.confirm": {
    en: "A new version is available. Ensure your notes are saved locally before updating.",
    "zh-CN": "新版本可用。更新前请确认笔记已保存到本地。",
    "zh-TW": "新版本可用。更新前請確認筆記已儲存至本機。"
  },

  "auth.recovery.title": { en: "Save your recovery key", "zh-CN": "保存恢复密钥", "zh-TW": "儲存復原金鑰" },
  "auth.recovery.description": {
    en: "The server cannot recover your notes. Save this recovery key in a password manager or a secure offline location.",
    "zh-CN": "服务器无法恢复笔记。请将恢复密钥保存至密码管理器或安全的离线位置。",
    "zh-TW": "伺服器無法復原筆記。請將復原金鑰儲存至密碼管理器或安全的離線位置。"
  },
  "auth.recovery.copy": { en: "Copy recovery key", "zh-CN": "复制恢复密钥", "zh-TW": "複製復原金鑰" },
  "auth.recovery.copied": { en: "Recovery key copied", "zh-CN": "恢复密钥已复制", "zh-TW": "復原金鑰已複製" },
  "auth.recovery.copyFailed": {
    en: "Unable to copy the recovery key. Select it and copy it manually.",
    "zh-CN": "恢复密钥复制失败。请选中密钥后手动复制。",
    "zh-TW": "復原金鑰複製失敗。請選取金鑰後手動複製。"
  },
  "auth.recovery.download": { en: "Download recovery key", "zh-CN": "下载恢复密钥", "zh-TW": "下載復原金鑰" },
  "auth.recovery.confirm": {
    en: "I confirm that I stored the recovery key in a secure location.",
    "zh-CN": "我确认已将恢复密钥保存在安全位置。",
    "zh-TW": "我確認已將復原金鑰儲存在安全位置。"
  },
  "auth.recovery.saved": { en: "Recovery key saved", "zh-CN": "已保存恢复密钥", "zh-TW": "已儲存復原金鑰" },
  "auth.register.title": { en: "Create encrypted account", "zh-CN": "创建加密账户", "zh-TW": "建立加密帳戶" },
  "auth.activate.title": { en: "Register with activation code", "zh-CN": "使用激活码注册", "zh-TW": "使用啟用碼註冊" },
  "auth.recover.title": { en: "Recover account", "zh-CN": "找回密码", "zh-TW": "找回密碼" },
  "auth.bootstrap.guidance": {
    en: "The first account on this server becomes the administrator.",
    "zh-CN": "服务器的首个账户将成为管理员。",
    "zh-TW": "伺服器的首個帳戶將成為管理員。"
  },
  "auth.registration.closed": {
    en: "Public registration is closed. Contact an administrator for an activation code.",
    "zh-CN": "公开注册已关闭。请向管理员申请激活码。",
    "zh-TW": "公開註冊已關閉。請向管理員申請啟用碼。"
  },
  "auth.recover.guidance": {
    en: "Use the recovery key to reset your master password. If both are lost, your data cannot be recovered.",
    "zh-CN": "使用恢复密钥重置主密码。主密码与恢复密钥均丢失时将无法恢复数据。",
    "zh-TW": "使用復原金鑰重設主密碼。主密碼與復原金鑰均遺失時將無法復原資料。"
  },
  "auth.username": { en: "Username", "zh-CN": "用户名", "zh-TW": "使用者名稱" },
  "auth.displayName": { en: "Display name", "zh-CN": "显示名称", "zh-TW": "顯示名稱" },
  "auth.activationCode": { en: "Activation code", "zh-CN": "激活码", "zh-TW": "啟用碼" },
  "auth.recoveryKey": { en: "Recovery key", "zh-CN": "恢复密钥", "zh-TW": "復原金鑰" },
  "auth.masterPassword": { en: "Master password", "zh-CN": "主密码", "zh-TW": "主密碼" },
  "auth.newMasterPassword": { en: "New master password", "zh-CN": "新主密码", "zh-TW": "新主密碼" },
  "auth.confirmPassword": { en: "Confirm password", "zh-CN": "确认密码", "zh-TW": "確認密碼" },
  "auth.confirmNewPassword": { en: "Confirm new master password", "zh-CN": "确认新主密码", "zh-TW": "確認新主密碼" },
  "auth.currentPassword": { en: "Current master password", "zh-CN": "当前主密码", "zh-TW": "目前主密碼" },
  "auth.rememberDevice": { en: "Remember this device", "zh-CN": "记住本设备", "zh-TW": "記住此裝置" },
  "auth.processingKeys": { en: "Processing security keys…", "zh-CN": "正在处理安全密钥…", "zh-TW": "正在處理安全金鑰…" },
  "auth.login": { en: "Log in", "zh-CN": "登录", "zh-TW": "登入" },
  "auth.register": { en: "Register", "zh-CN": "注册", "zh-TW": "註冊" },
  "auth.createAccount": { en: "Create account", "zh-CN": "创建账户", "zh-TW": "建立帳戶" },
  "auth.activateCreate": { en: "Activate and create keys", "zh-CN": "激活并创建密钥", "zh-TW": "啟用並建立金鑰" },
  "auth.resetPassword": { en: "Reset password", "zh-CN": "重设密码", "zh-TW": "重設密碼" },
  "auth.backToLogin": { en: "Back to login", "zh-CN": "返回登录", "zh-TW": "返回登入" },
  "auth.forgotPassword": { en: "Forgot password", "zh-CN": "忘记密码", "zh-TW": "忘記密碼" },
  "auth.normalRegistration": { en: "Standard registration", "zh-CN": "普通注册", "zh-TW": "一般註冊" },
  "auth.configError": {
    en: "Unable to load registration settings. Select Register to retry.",
    "zh-CN": "注册配置加载失败。请选择“注册”重试。",
    "zh-TW": "註冊設定載入失敗。請選擇「註冊」重試。"
  },
  "auth.offlineUnavailable": {
    en: "Offline access requires a remembered device previously verified online with this version.",
    "zh-CN": "离线访问需使用已记住的设备。该设备须已通过当前版本的在线验证。",
    "zh-TW": "離線存取需使用已記住的裝置。該裝置須已通過目前版本的線上驗證。"
  },
  "auth.passwordMin": {
    en: "The master password must contain at least 10 characters",
    "zh-CN": "主密码至少需要 10 个字符",
    "zh-TW": "主密碼至少需要 10 個字元"
  },
  "auth.newPasswordMin": {
    en: "The new master password must contain at least 10 characters",
    "zh-CN": "新主密码至少需要 10 个字符",
    "zh-TW": "新主密碼至少需要 10 個字元"
  },
  "auth.passwordMismatch": { en: "The passwords do not match", "zh-CN": "两次输入的密码不一致", "zh-TW": "兩次輸入的密碼不一致" },
  "auth.newPasswordMismatch": {
    en: "The new passwords do not match",
    "zh-CN": "两次输入的新密码不一致",
    "zh-TW": "兩次輸入的新密碼不一致"
  },
  "auth.passwordReset": { en: "Master password reset. Please log in again.", "zh-CN": "主密码已重置。请重新登录。", "zh-TW": "主密碼已重設。請重新登入。" },
  "auth.operationFailed": { en: "The operation failed", "zh-CN": "操作失败", "zh-TW": "操作失敗" },

  "lock.restoring": {
    en: "Restoring device access…",
    "zh-CN": "正在恢复设备访问…",
    "zh-TW": "正在復原裝置存取…"
  },
  "lock.title": { en: "Notes locked", "zh-CN": "笔记已锁定", "zh-TW": "筆記已鎖定" },
  "lock.offline": {
    en: "Offline · Master password unlock is temporarily unavailable",
    "zh-CN": "离线 · 暂无法使用主密码解锁",
    "zh-TW": "離線 · 暫無法使用主密碼解鎖"
  },
  "lock.devicePin": { en: "Device PIN", "zh-CN": "本机 PIN", "zh-TW": "本機 PIN" },
  "lock.unlocking": { en: "Unlocking…", "zh-CN": "正在解锁…", "zh-TW": "正在解鎖…" },
  "lock.unlockWithPin": { en: "Unlock with PIN", "zh-CN": "使用 PIN 解锁", "zh-TW": "使用 PIN 解鎖" },
  "lock.usePassword": { en: "Use master password", "zh-CN": "改用主密码", "zh-TW": "改用主密碼" },
  "lock.verifying": { en: "Verifying…", "zh-CN": "正在验证…", "zh-TW": "正在驗證…" },
  "lock.unlockWithPassword": { en: "Unlock with master password", "zh-CN": "使用主密码解锁", "zh-TW": "使用主密碼解鎖" },
  "lock.backToPin": { en: "Back to PIN unlock", "zh-CN": "返回 PIN 解锁", "zh-TW": "返回 PIN 解鎖" },
  "lock.logout": { en: "Log out", "zh-CN": "退出登录", "zh-TW": "登出" },
  "lock.invalidPin": { en: "Incorrect PIN", "zh-CN": "PIN 不正确", "zh-TW": "PIN 不正確" },
  "lock.cannotUnlock": { en: "Unable to unlock", "zh-CN": "无法解锁", "zh-TW": "無法解鎖" },
  "lock.invalidPassword": { en: "Incorrect master password", "zh-CN": "主密码不正确", "zh-TW": "主密碼不正確" },

  "settings.title": { en: "Settings", "zh-CN": "设置", "zh-TW": "設定" },
  "settings.localOnly": {
    en: "Offline · Some settings cannot be changed",
    "zh-CN": "离线 · 某些设置无法更改",
    "zh-TW": "離線 · 某些設定無法變更"
  },
  "settings.close": { en: "Close settings", "zh-CN": "关闭设置", "zh-TW": "關閉設定" },
  "settings.general": { en: "Appearance", "zh-CN": "外观", "zh-TW": "外觀" },
  "settings.security": { en: "Account and security", "zh-CN": "用户和安全", "zh-TW": "使用者與安全" },
  "settings.trash": { en: "Trash", "zh-CN": "回收站", "zh-TW": "垃圾桶" },
  "settings.data": { en: "Data migration", "zh-CN": "数据迁移", "zh-TW": "資料移轉" },
  "settings.about": { en: "About", "zh-CN": "关于", "zh-TW": "關於" },
  "settings.admin": { en: "Administrator settings", "zh-CN": "管理员设置", "zh-TW": "管理員設定" },
  "settings.logoutTitle": { en: "Log out of this device?", "zh-CN": "确认从当前设备登出？", "zh-TW": "確認從目前裝置登出？" },
  "settings.logoutWarning": {
    en: "Logging out deletes all local data for this account from this browser, including notes, attachments, and changes. Unsynced data cannot be recovered. Data synced to the server will remain.",
    "zh-CN": "登出将删除此浏览器中当前账户的全部本地数据（含笔记、附件和更改）。未同步数据将无法恢复。已同步至服务器的数据不受影响。",
    "zh-TW": "登出將刪除此瀏覽器中目前帳戶的全部本機資料（含筆記、附件和變更）。未同步資料將無法復原。已同步至伺服器的資料不受影響。"
  },
  "settings.profile": { en: "Profile", "zh-CN": "个人资料", "zh-TW": "個人資料" },
  "settings.editProfile": { en: "Edit profile", "zh-CN": "编辑资料", "zh-TW": "編輯資料" },
  "settings.name": { en: "Name", "zh-CN": "名称", "zh-TW": "名稱" },
  "settings.changeDisplayName": { en: "Change name", "zh-CN": "修改名称", "zh-TW": "變更名稱" },
  "settings.changeUsername": { en: "Change username", "zh-CN": "修改用户名", "zh-TW": "變更使用者名稱" },
  "settings.newUsername": { en: "New username", "zh-CN": "新用户名", "zh-TW": "新使用者名稱" },
  "settings.changeUsernameHelp": {
    en: "Changing the username requires other devices to log in again with the new username.",
    "zh-CN": "修改用户名后，其他设备需使用新用户名重新登录。",
    "zh-TW": "變更使用者名稱後，其他裝置需使用新使用者名稱重新登入。"
  },
  "settings.verifyUsernameChange": { en: "Verify username change", "zh-CN": "验证用户名修改", "zh-TW": "驗證使用者名稱變更" },
  "settings.usernameVerificationHelp": {
    en: "Enter your current master password and recovery key. If the key is unavailable, reset it to continue.",
    "zh-CN": "请输入当前主密码和恢复密钥。恢复密钥不可用时可重置后继续。",
    "zh-TW": "請輸入目前主密碼和復原金鑰。復原金鑰無法使用時可重設後繼續。"
  },
  "settings.resetRecoveryAndContinue": { en: "Reset recovery key and continue", "zh-CN": "重置恢复密钥并继续", "zh-TW": "重設復原金鑰並繼續" },
  "settings.confirmUsernameChange": { en: "Confirm change", "zh-CN": "确认修改", "zh-TW": "確認變更" },
  "settings.saveReplacementRecovery": { en: "Save the new recovery key", "zh-CN": "保存新的恢复密钥", "zh-TW": "儲存新的復原金鑰" },
  "settings.replacementRecoveryHelp": {
    en: "Save the new recovery key before continuing. The old key becomes invalid after the username change succeeds.",
    "zh-CN": "继续前请保存新恢复密钥。用户名修改成功后旧密钥才会失效。",
    "zh-TW": "繼續前請儲存新復原金鑰。使用者名稱變更成功後舊金鑰才會失效。"
  },
  "settings.finishUsernameChange": { en: "Finish username change", "zh-CN": "完成用户名修改", "zh-TW": "完成使用者名稱變更" },
  "settings.avatar": { en: "Avatar", "zh-CN": "头像", "zh-TW": "頭像" },
  "settings.currentAvatar": { en: "Current avatar", "zh-CN": "当前头像", "zh-TW": "目前頭像" },
  "settings.uploadAvatar": { en: "Upload avatar", "zh-CN": "上传头像", "zh-TW": "上傳頭像" },
  "settings.changeAvatar": { en: "Change avatar", "zh-CN": "更换头像", "zh-TW": "更換頭像" },
  "settings.removeAvatar": { en: "Remove avatar", "zh-CN": "移除头像", "zh-TW": "移除頭像" },
  "settings.appearance": { en: "Appearance", "zh-CN": "外观", "zh-TW": "外觀" },
  "settings.theme": { en: "Theme", "zh-CN": "主题", "zh-TW": "主題" },
  "settings.themeSystem": { en: "Follow system", "zh-CN": "跟随系统", "zh-TW": "跟隨系統" },
  "settings.themeLight": { en: "Light", "zh-CN": "浅色", "zh-TW": "淺色" },
  "settings.themeDark": { en: "Dark", "zh-CN": "深色", "zh-TW": "深色" },
  "settings.fontSize": { en: "Font size", "zh-CN": "字体大小", "zh-TW": "字體大小" },
  "settings.fontSizeSmall": { en: "{size} (Small)", "zh-CN": "{size}（小）", "zh-TW": "{size}（小）" },
  "settings.fontSizeDefault": { en: "{size} (Default)", "zh-CN": "{size}（默认）", "zh-TW": "{size}（預設）" },
  "settings.fontSizeLarge": { en: "{size} (Large)", "zh-CN": "{size}（大）", "zh-TW": "{size}（大）" },
  "settings.editor": { en: "Editor", "zh-CN": "编辑器", "zh-TW": "編輯器" },
  "settings.wrapCodeBlocks": { en: "Wrap code blocks", "zh-CN": "代码块自动换行", "zh-TW": "程式碼區塊自動換行" },
  "settings.trashHelp": {
    en: "Trash items are permanently deleted when the retention period expires.",
    "zh-CN": "回收站内容将在保留期满后永久删除。",
    "zh-TW": "垃圾桶內容將在保留期限屆滿後永久刪除。"
  },
  "settings.autoDelete": { en: "Automatically delete after", "zh-CN": "自动删除时间", "zh-TW": "自動刪除時間" },
  "settings.days": { en: "{count} days", "zh-CN": "{count} 天", "zh-TW": "{count} 天" },
  "settings.daysDefault": { en: "{count} days (default)", "zh-CN": "{count} 天（默认）", "zh-TW": "{count} 天（預設）" },
  "settings.keepForever": { en: "Keep forever", "zh-CN": "永久保存", "zh-TW": "永久保留" },
  "settings.deletedItems": { en: "Deleted items", "zh-CN": "已删除项目", "zh-TW": "已刪除項目" },
  "settings.trashSummary": { en: "{roots} deleted items · {total} items total", "zh-CN": "{roots} 个删除项目 · 共 {total} 项", "zh-TW": "{roots} 個已刪除項目 · 共 {total} 項" },
  "settings.trashFilterSummary": { en: "{count} matching items", "zh-CN": "{count} 个匹配项", "zh-TW": "{count} 個符合項目" },
  "settings.clearingTrash": { en: "Clearing…", "zh-CN": "正在清空…", "zh-TW": "正在清空…" },
  "settings.clearTrash": { en: "Clear trash", "zh-CN": "清空回收站", "zh-TW": "清空垃圾桶" },
  "settings.trashEmpty": { en: "Trash is empty", "zh-CN": "回收站为空", "zh-TW": "垃圾桶是空的" },
  "settings.noTrashMatches": { en: "No deleted items match these filters", "zh-CN": "没有符合筛选条件的已删除项目", "zh-TW": "沒有符合篩選條件的已刪除項目" },
  "settings.searchTrash": { en: "Search trash", "zh-CN": "搜索回收站", "zh-TW": "搜尋垃圾桶" },
  "settings.trashTypeFilter": { en: "Filter trash by type", "zh-CN": "按类型筛选回收站", "zh-TW": "依類型篩選垃圾桶" },
  "settings.allTypes": { en: "All types", "zh-CN": "全部类型", "zh-TW": "全部類型" },
  "settings.foldersOnly": { en: "Folders", "zh-CN": "文件夹", "zh-TW": "資料夾" },
  "settings.notesOnly": { en: "Notes", "zh-CN": "笔记", "zh-TW": "筆記" },
  "settings.trashSort": { en: "Sort deleted items", "zh-CN": "排序已删除项目", "zh-TW": "排序已刪除項目" },
  "settings.deletedNewest": { en: "Deleted: newest", "zh-CN": "删除时间：最新", "zh-TW": "刪除時間：最新" },
  "settings.deletedOldest": { en: "Deleted: oldest", "zh-CN": "删除时间：最早", "zh-TW": "刪除時間：最早" },
  "settings.sortByName": { en: "Name", "zh-CN": "名称", "zh-TW": "名稱" },
  "settings.collapseAll": { en: "Collapse all", "zh-CN": "全部收起", "zh-TW": "全部收合" },
  "settings.showMore": { en: "Show {count} more", "zh-CN": "再显示 {count} 项", "zh-TW": "再顯示 {count} 項" },
  "settings.untitled": { en: "Untitled note", "zh-CN": "无标题笔记", "zh-TW": "無標題筆記" },
  "settings.folder": { en: "Folder", "zh-CN": "文件夹", "zh-TW": "資料夾" },
  "settings.note": { en: "Note", "zh-CN": "笔记", "zh-TW": "筆記" },
  "settings.containsItems": { en: "contains {count} items", "zh-CN": "包含 {count} 项", "zh-TW": "包含 {count} 項" },
  "settings.deletedAt": { en: "deleted {date}", "zh-CN": "删除于 {date}", "zh-TW": "刪除於 {date}" },
  "settings.expandFolder": { en: "Expand {title}", "zh-CN": "展开 {title}", "zh-TW": "展開 {title}" },
  "settings.collapseFolder": { en: "Collapse {title}", "zh-CN": "收起 {title}", "zh-TW": "收合 {title}" },
  "settings.restore": { en: "Restore", "zh-CN": "恢复", "zh-TW": "復原" },
  "settings.restoreItem": { en: "Restore {title}", "zh-CN": "恢复 {title}", "zh-TW": "復原 {title}" },
  "settings.moreActions": { en: "More actions", "zh-CN": "更多操作", "zh-TW": "更多操作" },
  "settings.moreActionsFor": { en: "More actions for {title}", "zh-CN": "{title}的更多操作", "zh-TW": "{title}的更多操作" },
  "settings.permanentDelete": { en: "Permanently delete", "zh-CN": "永久删除", "zh-TW": "永久刪除" },
  "settings.permanentDeleteItem": { en: "Permanently delete {title}", "zh-CN": "永久删除 {title}", "zh-TW": "永久刪除 {title}" },
  "settings.devicePin": { en: "Device PIN", "zh-CN": "本机 PIN", "zh-TW": "本機 PIN" },
  "settings.setPin": { en: "Set PIN", "zh-CN": "设置 PIN", "zh-TW": "設定 PIN" },
  "settings.pinHelp": {
    en: "After setup, the PIN is required at app startup. It applies only to this device.",
    "zh-CN": "设置后每次启动应用均需输入 PIN。PIN 仅适用于当前设备。",
    "zh-TW": "設定後每次啟動應用程式均需輸入 PIN。PIN 僅適用於目前裝置。"
  },
  "settings.pinConfiguredHelp": {
    en: "A PIN is set for this device. You can change or remove it.",
    "zh-CN": "当前设备已设置 PIN。可更改或移除。",
    "zh-TW": "目前裝置已設定 PIN。可變更或移除。"
  },
  "settings.pinVerificationHelp": {
    en: "Enter your current master password and new PIN.",
    "zh-CN": "请输入当前主密码和新 PIN。",
    "zh-TW": "請輸入目前主密碼和新 PIN。"
  },
  "settings.removePinHelp": {
    en: "Enter your current master password to remove this device's PIN. This also disables automatic locking.",
    "zh-CN": "输入当前主密码以移除本机 PIN。移除后将关闭自动锁定。",
    "zh-TW": "輸入目前主密碼以移除本機 PIN。移除後將關閉自動鎖定。"
  },
  "settings.newPin": { en: "New PIN", "zh-CN": "新 PIN", "zh-TW": "新 PIN" },
  "settings.pinMin": { en: "At least 4 characters", "zh-CN": "至少 4 个字符", "zh-TW": "至少 4 個字元" },
  "settings.changePin": { en: "Change PIN", "zh-CN": "更改 PIN", "zh-TW": "變更 PIN" },
  "settings.removePin": { en: "Remove PIN", "zh-CN": "移除 PIN", "zh-TW": "移除 PIN" },
  "settings.autoLock": { en: "Automatic locking", "zh-CN": "自动锁定", "zh-TW": "自動鎖定" },
  "settings.autoLockHelp": {
    en: "The app locks after the selected period of inactivity. Unlock with the device PIN or master password.",
    "zh-CN": "应用将在设定的无操作时长后自动锁定。可使用本机 PIN 或主密码解锁。",
    "zh-TW": "應用程式將在設定的閒置時間後自動鎖定。可使用本機 PIN 或主密碼解鎖。"
  },
  "settings.autoLockAfter": { en: "Lock after inactivity", "zh-CN": "无操作后自动锁定", "zh-TW": "閒置後自動鎖定" },
  "settings.offDefault": { en: "Off (default)", "zh-CN": "关闭（默认）", "zh-TW": "關閉（預設）" },
  "settings.minutes": { en: "{count} minutes", "zh-CN": "{count} 分钟", "zh-TW": "{count} 分鐘" },
  "settings.minute": { en: "1 minute", "zh-CN": "1 分钟", "zh-TW": "1 分鐘" },
  "settings.loginDevices": { en: "Login devices", "zh-CN": "登录设备", "zh-TW": "登入裝置" },
  "settings.loginDevicesHelp": {
    en: "Manage signed-in devices and remove inactive records. New devices must remain signed in for 24 hours before signing out other active devices.",
    "zh-CN": "管理登录设备并移除失效记录。新设备登录满 24 小时后才能登出其他有效设备。",
    "zh-TW": "管理登入裝置並移除失效記錄。新裝置登入滿 24 小時後才能登出其他有效裝置。"
  },
  "settings.inactiveDeviceRetention": {
    en: "Signed-out and expired device records are removed after {count} days. You can also remove them manually.",
    "zh-CN": "已登出和已过期的设备记录将在 {count} 天后自动移除。也可手动移除。",
    "zh-TW": "已登出和已過期的裝置記錄將在 {count} 天後自動移除。也可手動移除。"
  },
  "settings.loadingDevices": { en: "Loading login devices…", "zh-CN": "正在加载登录设备…", "zh-TW": "正在載入登入裝置…" },
  "settings.revokeAfter": { en: "Other devices can be signed out after {date}.", "zh-CN": "可在 {date} 后登出其他设备。", "zh-TW": "可在 {date} 後登出其他裝置。" },
  "settings.currentDevice": { en: "Current device", "zh-CN": "当前设备", "zh-TW": "目前裝置" },
  "settings.remembered": { en: "Remembered", "zh-CN": "已记住", "zh-TW": "已記住" },
  "settings.lastOnline": { en: "Last online: {date}", "zh-CN": "上次上线：{date}", "zh-TW": "上次上線：{date}" },
  "settings.deviceDetails": {
    en: "First login: {first} · Recent login: {last} · {count} logins · IP {ip} · {status}",
    "zh-CN": "首次登录：{first} · 最近登录：{last} · 共 {count} 次 · IP {ip} · {status}",
    "zh-TW": "首次登入：{first} · 最近登入：{last} · 共 {count} 次 · IP {ip} · {status}"
  },
  "settings.deviceActive": { en: "Active", "zh-CN": "有效", "zh-TW": "有效" },
  "settings.deviceSignedOut": { en: "Signed out", "zh-CN": "已登出", "zh-TW": "已登出" },
  "settings.deviceExpired": { en: "Expired", "zh-CN": "已过期", "zh-TW": "已過期" },
  "settings.signOut": { en: "Sign out", "zh-CN": "登出", "zh-TW": "登出" },
  "settings.accountCredentials": { en: "Account credentials", "zh-CN": "账户凭据", "zh-TW": "帳戶憑證" },
  "settings.accountCredentialsHelp": {
    en: "Manage your master password and recovery key. Select an action to verify your identity.",
    "zh-CN": "管理主密码和恢复密钥。选择操作后需验证身份。",
    "zh-TW": "管理主密碼和復原金鑰。選擇操作後需驗證身分。"
  },
  "settings.changePassword": { en: "Change master password", "zh-CN": "修改主密码", "zh-TW": "變更主密碼" },
  "settings.changePasswordHelp": {
    en: "Changing the master password requires other devices to log in again. The recovery key remains valid.",
    "zh-CN": "修改主密码后其他设备需重新登录。恢复密钥仍然有效。",
    "zh-TW": "變更主密碼後其他裝置需重新登入。復原金鑰仍然有效。"
  },
  "settings.recoveryHelp": {
    en: "Use the recovery key to reset a forgotten master password. Resetting the key immediately invalidates the old key. Save the new key promptly.",
    "zh-CN": "恢复密钥可用于重置遗忘的主密码。重置密钥后旧密钥将立即失效。请及时保存新密钥。",
    "zh-TW": "復原金鑰可用於重設遺忘的主密碼。重設金鑰後舊金鑰將立即失效。請及時儲存新金鑰。"
  },
  "settings.resetRecovery": { en: "Reset recovery key", "zh-CN": "重置恢复密钥", "zh-TW": "重設復原金鑰" },
  "settings.recoveryShownOnce": { en: "The new recovery key is shown only once", "zh-CN": "新的恢复密钥仅在本次显示", "zh-TW": "新的復原金鑰僅在本次顯示" },
  "settings.savedRecovery": { en: "I have saved it", "zh-CN": "我已保存", "zh-TW": "我已儲存" },
  "settings.portableHelp": {
    en: "Markdown ZIP exports contain plaintext. Save them in a trusted location. Folder structure, empty folders, and attachments are preserved.",
    "zh-CN": "Markdown ZIP 导出文件包含明文。请保存至可信位置。导出将保留目录结构、空文件夹和附件。",
    "zh-TW": "Markdown ZIP 匯出檔案包含明文。請儲存至可信任的位置。匯出將保留目錄結構、空資料夾和附件。"
  },
  "settings.import": { en: "Import Markdown / ZIP", "zh-CN": "导入 Markdown / ZIP", "zh-TW": "匯入 Markdown / ZIP" },
  "settings.export": { en: "Export complete ZIP", "zh-CN": "导出完整 ZIP", "zh-TW": "匯出完整 ZIP" },
  "settings.aboutHelp": {
    en: "Thanks to the following open-source projects.",
    "zh-CN": "感谢以下开源项目。",
    "zh-TW": "感謝以下開源專案。"
  },
  "settings.version": { en: "Version", "zh-CN": "版本", "zh-TW": "版本" },
  "settings.aboutDescription": {
    en: "Mint Notes is a lightweight, self-hosted Markdown notes app. It supports multiple users, offline PWA editing, and cross-device sync.",
    "zh-CN": "Mint Notes 是一款轻量的自托管 Markdown 笔记应用。支持多用户、PWA 离线编辑和跨设备同步。",
    "zh-TW": "Mint Notes 是一款輕量的自託管 Markdown 筆記應用程式。支援多使用者、PWA 離線編輯和跨裝置同步。"
  },
  "settings.acknowledgements": { en: "Acknowledgements", "zh-CN": "致谢", "zh-TW": "致謝" },
  "settings.editorCoreOrigin": { en: "Upstream project for the editor core", "zh-CN": "编辑器核心的上游项目", "zh-TW": "編輯器核心的上游專案" },
  "settings.mathFormulaRendering": { en: "Used to render mathematical formulas", "zh-CN": "用于渲染数学公式", "zh-TW": "用於算繪數學公式" },
  "settings.diagramRendering": { en: "Used to render diagrams", "zh-CN": "用于渲染图表", "zh-TW": "用於算繪圖表" },
  "settings.iconLibrary": { en: "Used for interface icons", "zh-CN": "用于界面图标", "zh-TW": "用於介面圖示" },

  "notice.loadDevicesFailed": { en: "Unable to load login devices", "zh-CN": "无法加载登录设备", "zh-TW": "無法載入登入裝置" },
  "notice.loadTrashRetentionFailed": { en: "Unable to load trash retention settings", "zh-CN": "无法加载回收站保留设置", "zh-TW": "無法載入垃圾桶保留設定" },
  "notice.trashForever": { en: "Trash items will be kept forever", "zh-CN": "回收站内容将永久保留", "zh-TW": "垃圾桶內容將永久保留" },
  "notice.trashDeleteAfter": { en: "Trash items will be automatically deleted after {count} days", "zh-CN": "回收站内容将在 {count} 天后自动删除", "zh-TW": "垃圾桶內容將在 {count} 天後自動刪除" },
  "notice.settingRestored": { en: "{message}. The previous setting was restored.", "zh-CN": "{message}，已恢复原设置", "zh-TW": "{message}，已復原原設定" },
  "notice.saveTrashFailed": { en: "Unable to save trash settings. Previous settings restored.", "zh-CN": "回收站设置保存失败。已恢复原设置。", "zh-TW": "垃圾桶設定儲存失敗。已復原原設定。" },
  "notice.displayNameUpdated": { en: "Name updated", "zh-CN": "名称已更新", "zh-TW": "名稱已更新" },
  "notice.displayNameFailed": { en: "Unable to update name", "zh-CN": "无法更新名称", "zh-TW": "無法更新名稱" },
  "notice.usernameUpdated": { en: "Username updated. Other devices must log in again.", "zh-CN": "用户名已更新。其他设备需重新登录。", "zh-TW": "使用者名稱已更新。其他裝置需重新登入。" },
  "notice.usernameRecoveryReset": { en: "Username and recovery key updated. Other devices must log in again.", "zh-CN": "用户名和恢复密钥已更新。其他设备需重新登录。", "zh-TW": "使用者名稱和復原金鑰已更新。其他裝置需重新登入。" },
  "notice.usernameFailed": { en: "Unable to update username", "zh-CN": "无法更新用户名", "zh-TW": "無法更新使用者名稱" },
  "notice.usernameUnchanged": { en: "Enter a different username", "zh-CN": "请输入不同的用户名", "zh-TW": "請輸入不同的使用者名稱" },
  "notice.avatarUpdated": { en: "Avatar updated", "zh-CN": "头像已更新", "zh-TW": "頭像已更新" },
  "notice.avatarUpdateFailed": { en: "Unable to update avatar", "zh-CN": "无法更新头像", "zh-TW": "無法更新頭像" },
  "notice.avatarRemoved": { en: "Avatar removed", "zh-CN": "头像已移除", "zh-TW": "頭像已移除" },
  "notice.avatarRemoveFailed": { en: "Unable to remove avatar", "zh-CN": "无法移除头像", "zh-TW": "無法移除頭像" },
  "notice.signOutDeviceConfirm": { en: "Sign out {device}? It must log in again on its next connection.", "zh-CN": "登出 {device}？该设备下次连接时需重新登录。", "zh-TW": "登出 {device}？該裝置下次連線時需重新登入。" },
  "notice.deviceSignedOut": { en: "{device} signed out", "zh-CN": "{device} 已登出", "zh-TW": "{device} 已登出" },
  "notice.deviceSignOutFailed": { en: "Unable to sign out device", "zh-CN": "登出设备失败", "zh-TW": "登出裝置失敗" },
  "notice.removeDeviceConfirm": { en: "Remove the inactive record for {device}?", "zh-CN": "移除 {device} 的失效记录？", "zh-TW": "移除 {device} 的失效記錄？" },
  "notice.deviceRemoved": { en: "{device} removed", "zh-CN": "已移除 {device}", "zh-TW": "已移除 {device}" },
  "notice.deviceRemoveFailed": { en: "Unable to remove device record", "zh-CN": "移除设备记录失败", "zh-TW": "移除裝置記錄失敗" },
  "notice.pinSaved": { en: "PIN saved for this device", "zh-CN": "当前设备 PIN 已保存", "zh-TW": "目前裝置的 PIN 已儲存" },
  "notice.pinSaveFailed": { en: "Unable to save PIN", "zh-CN": "无法保存 PIN", "zh-TW": "無法儲存 PIN" },
  "notice.pinRemoved": { en: "Device PIN removed. Automatic locking disabled.", "zh-CN": "本机 PIN 已移除。自动锁定已关闭。", "zh-TW": "本機 PIN 已移除。自動鎖定已關閉。" },
  "notice.pinRemoveFailed": { en: "Unable to remove PIN", "zh-CN": "无法移除 PIN", "zh-TW": "無法移除 PIN" },
  "notice.setPinFirst": { en: "Set a device PIN before enabling automatic locking", "zh-CN": "开启自动锁定前请先设置本机 PIN", "zh-TW": "開啟自動鎖定前請先設定本機 PIN" },
  "notice.autoLockEnabled": { en: "The app will lock after {count} minutes of inactivity", "zh-CN": "无操作 {count} 分钟后将自动锁定", "zh-TW": "閒置 {count} 分鐘後將自動鎖定" },
  "notice.autoLockDisabled": { en: "Automatic locking disabled. Device PIN retained.", "zh-CN": "自动锁定已关闭。本机 PIN 已保留。", "zh-TW": "自動鎖定已關閉。本機 PIN 已保留。" },
  "notice.autoLockSaveFailed": { en: "Unable to save automatic locking settings", "zh-CN": "无法保存自动锁定设置", "zh-TW": "無法儲存自動鎖定設定" },
  "notice.passwordChanged": { en: "Master password changed. Other devices must log in again. The recovery key remains valid.", "zh-CN": "主密码已修改。其他设备需重新登录。恢复密钥仍然有效。", "zh-TW": "主密碼已變更。其他裝置需重新登入。復原金鑰仍然有效。" },
  "notice.passwordChangeFailed": { en: "Unable to change password", "zh-CN": "密码修改失败", "zh-TW": "密碼變更失敗" },
  "notice.recoveryReset": { en: "Recovery key reset. The old key is no longer valid.", "zh-CN": "恢复密钥已重置。旧密钥已失效。", "zh-TW": "復原金鑰已重設。舊金鑰已失效。" },
  "notice.recoveryResetFailed": { en: "Unable to reset recovery key", "zh-CN": "无法重置恢复密钥", "zh-TW": "無法重設復原金鑰" },
  "notice.itemRestored": { en: "“{title}” restored", "zh-CN": "“{title}”已恢复", "zh-TW": "「{title}」已復原" },
  "notice.itemRestoreFailed": { en: "Unable to restore “{title}”", "zh-CN": "无法恢复“{title}”", "zh-TW": "無法復原「{title}」" },

  "admin.description": {
    en: "Create and manage user accounts. Administrators cannot view users' note content.",
    "zh-CN": "创建和管理用户账户。管理员无法查看用户的笔记内容。",
    "zh-TW": "建立和管理使用者帳戶。管理員無法查看使用者的筆記內容。"
  },
  "admin.userManagement": { en: "User management", "zh-CN": "用户管理", "zh-TW": "使用者管理" },
  "admin.createPending": { en: "Add user", "zh-CN": "新增用户", "zh-TW": "新增使用者" },
  "admin.createPendingHelp": {
    en: "Enter a username and display name to generate an activation code valid for 72 hours.",
    "zh-CN": "输入用户名和显示名称以生成激活码。激活码有效期为 72 小时。",
    "zh-TW": "輸入使用者名稱和顯示名稱以產生啟用碼。啟用碼有效期限為 72 小時。"
  },
  "admin.createCode": { en: "Create activation code", "zh-CN": "创建激活码", "zh-TW": "建立啟用碼" },
  "admin.codeShownOnce": { en: "Activation code is shown only once", "zh-CN": "激活码仅显示一次", "zh-TW": "啟用碼僅顯示一次" },
  "admin.pending": { en: "Pending activation", "zh-CN": "待激活", "zh-TW": "待啟用" },
  "admin.expires": { en: "expires {date}", "zh-CN": "{date} 到期", "zh-TW": "{date} 到期" },
  "admin.existingUsers": { en: "Existing users", "zh-CN": "现有用户", "zh-TW": "現有使用者" },
  "admin.currentAccount": { en: "Current account", "zh-CN": "当前账户", "zh-TW": "目前帳戶" },
  "admin.roleAdmin": { en: "Administrator", "zh-CN": "管理员", "zh-TW": "管理員" },
  "admin.roleUser": { en: "User", "zh-CN": "用户", "zh-TW": "使用者" },
  "admin.objectCount": { en: "{count} objects", "zh-CN": "{count} 个对象", "zh-TW": "{count} 個物件" },
  "admin.enable": { en: "Enable", "zh-CN": "启用", "zh-TW": "啟用" },
  "admin.disable": { en: "Disable", "zh-CN": "禁用", "zh-TW": "停用" },
  "admin.delete": { en: "Delete", "zh-CN": "删除", "zh-TW": "刪除" },
  "admin.deleteUser": { en: "Permanently delete user", "zh-CN": "永久删除用户", "zh-TW": "永久刪除使用者" },
  "admin.deleteUserTitle": { en: "Permanently delete @{username}", "zh-CN": "永久删除 @{username}", "zh-TW": "永久刪除 @{username}" },
  "admin.deleteWarning": {
    en: "This permanently deletes the account, notes, history, attachments, and login devices from this server database. This cannot be undone. Independent backups and local browser ciphertext will remain.",
    "zh-CN": "此操作将从服务器数据库中永久删除该账户及其笔记、历史版本、附件和登录设备。删除后无法恢复。独立备份及浏览器中的本地密文仍会保留。",
    "zh-TW": "此操作將從伺服器資料庫中永久刪除該帳戶及其筆記、歷史版本、附件和登入裝置。刪除後無法復原。獨立備份及瀏覽器中的本機密文仍會保留。"
  },
  "admin.confirmUsername": { en: "Enter the username to confirm", "zh-CN": "输入用户名确认", "zh-TW": "輸入使用者名稱確認" },
  "admin.yourPassword": { en: "Your master password", "zh-CN": "您的主密码", "zh-TW": "您的主密碼" },
  "admin.cancelActivationConfirm": { en: "Cancel activation eligibility for @{username}?", "zh-CN": "取消 @{username} 的激活资格？", "zh-TW": "取消 @{username} 的啟用資格？" },
  "admin.loadFailed": { en: "Unable to load administrator settings", "zh-CN": "无法加载管理员设置", "zh-TW": "無法載入管理員設定" },
  "admin.codeCreated": { en: "Activation code created. Save it now.", "zh-CN": "激活码已创建。请立即保存。", "zh-TW": "啟用碼已建立。請立即儲存。" },
  "admin.createFailed": { en: "Unable to create user", "zh-CN": "无法创建用户", "zh-TW": "無法建立使用者" },
  "admin.userEnabled": { en: "{name} enabled", "zh-CN": "{name} 已启用", "zh-TW": "{name} 已啟用" },
  "admin.userDisabled": { en: "{name} disabled", "zh-CN": "{name} 已禁用", "zh-TW": "{name} 已停用" },
  "admin.updateFailed": { en: "Unable to update user status", "zh-CN": "无法更新用户状态", "zh-TW": "無法更新使用者狀態" },
  "admin.activationCancelled": { en: "Activation eligibility for @{username} cancelled", "zh-CN": "@{username} 的激活资格已取消", "zh-TW": "@{username} 的啟用資格已取消" },
  "admin.cancelFailed": { en: "Unable to cancel activation eligibility", "zh-CN": "无法取消激活资格", "zh-TW": "無法取消啟用資格" },
  "admin.userDeleted": { en: "@{username} permanently deleted", "zh-CN": "@{username} 已永久删除", "zh-TW": "@{username} 已永久刪除" },
  "admin.deleteFailed": { en: "Unable to delete user", "zh-CN": "无法删除用户", "zh-TW": "無法刪除使用者" },

  "app.save.saving": { en: "Saving locally…", "zh-CN": "正在保存到本地…", "zh-TW": "正在儲存到本機…" },
  "app.save.local": { en: "Saved locally · pending sync", "zh-CN": "已保存到本地 · 等待同步", "zh-TW": "已儲存至本機 · 等待同步" },
  "app.save.syncing": { en: "Syncing…", "zh-CN": "正在同步…", "zh-TW": "正在同步…" },
  "app.save.synced": { en: "Synced", "zh-CN": "已同步", "zh-TW": "已同步" },
  "app.save.offline": { en: "Offline · saved locally", "zh-CN": "离线 · 已保存到本地", "zh-TW": "離線 · 已儲存在本機" },
  "app.save.unverifiedDetail": {
    en: "Server session not verified. Changes are saved locally. Verification will retry automatically.",
    "zh-CN": "服务器会话未验证。修改已保存到本地。系统将自动重试验证。",
    "zh-TW": "伺服器工作階段未驗證。變更已儲存至本機。系統將自動重試驗證。"
  },
  "app.save.error": { en: "Sync error · saved locally", "zh-CN": "同步错误 · 已保存到本地", "zh-TW": "同步錯誤 · 已儲存在本機" },
  "app.save.syncingDetail": { en: "Synchronizing with the server…", "zh-CN": "正在与服务器同步…", "zh-TW": "正在與伺服器同步…" },
  "app.save.offlineDetail": {
    en: "Offline. Changes are saved locally and will sync after reconnection.",
    "zh-CN": "设备离线。修改已保存到本地。联网后将自动同步。",
    "zh-TW": "裝置離線。變更已儲存至本機。連網後將自動同步。"
  },
  "app.save.unreachableDetail": {
    en: "Unable to connect to the server. Changes are saved locally. Sync will retry automatically.",
    "zh-CN": "无法连接服务器。修改已保存到本地。系统将自动重试同步。",
    "zh-TW": "無法連線至伺服器。變更已儲存至本機。系統將自動重試同步。"
  },
  "app.save.serverErrorDetail": {
    en: "Server rejected sync: {reason}. Changes are saved locally. Sync will retry automatically.",
    "zh-CN": "服务器拒绝同步：{reason}。修改已保存到本地。系统将自动重试同步。",
    "zh-TW": "伺服器拒絕同步：{reason}。變更已儲存至本機。系統將自動重試同步。"
  },
  "app.save.localFailureDetail": {
    en: "Local save failed. The latest changes have not been saved.",
    "zh-CN": "本地保存失败。最新修改尚未保存。",
    "zh-TW": "本機儲存失敗。最新變更尚未儲存。"
  },
  "app.loadingNotes": { en: "Decrypting local notes…", "zh-CN": "正在解密本地笔记…", "zh-TW": "正在解密本機筆記…" },
  "app.untitled": { en: "Untitled note", "zh-CN": "无标题笔记", "zh-TW": "無標題筆記" },
  "app.newFolder": { en: "New folder", "zh-CN": "新文件夹", "zh-TW": "新資料夾" },
  "app.welcomeTitle": { en: "Welcome", "zh-CN": "欢迎使用", "zh-TW": "歡迎使用" },
  "app.welcomeMarkdown": {
    en: "# Welcome\n\nThis is a local-first, end-to-end encrypted Markdown note.\n\n- Manage folders and notes on the left\n- Drag notes into folders\n- Image attachments are encrypted in the browser\n",
    "zh-CN": "# 欢迎使用\n\n这是一个本地优先、端到端加密的 Markdown 笔记。\n\n- 左侧管理文件夹和笔记\n- 可把笔记拖入文件夹\n- 图片附件在浏览器中加密\n",
    "zh-TW": "# 歡迎使用\n\n這是一個本機優先、端對端加密的 Markdown 筆記。\n\n- 在左側管理資料夾和筆記\n- 可將筆記拖入資料夾\n- 圖片附件會在瀏覽器中加密\n"
  },
  "app.conflictSuffix": { en: "conflict copy", "zh-CN": "冲突副本", "zh-TW": "衝突副本" },
  "app.copySuffix": { en: "copy", "zh-CN": "副本", "zh-TW": "副本" },
  "app.closeNotification": { en: "Close notification", "zh-CN": "关闭通知", "zh-TW": "關閉通知" },
  "app.collapseDirectory": { en: "Collapse directory", "zh-CN": "折叠目录", "zh-TW": "收合目錄" },
  "app.closeDirectory": { en: "Close directory", "zh-CN": "关闭目录", "zh-TW": "關閉目錄" },
  "app.pinned": { en: "Pinned", "zh-CN": "置顶", "zh-TW": "置頂" },
  "app.folderToggleHint": { en: "Expand or collapse this folder in the file list", "zh-CN": "在文件列表中展开或折叠此文件夹", "zh-TW": "在檔案清單中展開或收合此資料夾" },
  "app.notSynced": { en: "Not yet synchronized", "zh-CN": "尚未同步", "zh-TW": "尚未同步" },
  "app.openMenu": { en: "Open menu for {title}", "zh-CN": "打开 {title} 菜单", "zh-TW": "開啟 {title} 選單" },
  "app.search": { en: "Search notes", "zh-CN": "搜索笔记", "zh-TW": "搜尋筆記" },
  "app.clearSearch": { en: "Clear search", "zh-CN": "清除搜索", "zh-TW": "清除搜尋" },
  "app.noteActions": { en: "Note actions", "zh-CN": "笔记操作", "zh-TW": "筆記操作" },
  "app.newNote": { en: "New note", "zh-CN": "新建笔记", "zh-TW": "新增筆記" },
  "app.createFolder": { en: "New folder", "zh-CN": "新建文件夹", "zh-TW": "新增資料夾" },
  "app.collapseAll": { en: "Collapse all folders", "zh-CN": "折叠所有文件夹", "zh-TW": "收合所有資料夾" },
  "app.locateCurrent": { en: "Locate current note", "zh-CN": "定位当前笔记", "zh-TW": "定位目前筆記" },
  "app.sort": { en: "Sort order", "zh-CN": "排序方式", "zh-TW": "排序方式" },
  "app.sortCreated": { en: "Created", "zh-CN": "建立时间", "zh-TW": "建立時間" },
  "app.sortUpdated": { en: "Last modified", "zh-CN": "上次修改", "zh-TW": "上次修改" },
  "app.sortManual": { en: "Manual", "zh-CN": "手动", "zh-TW": "手動" },
  "app.noMatches": { en: "No matching notes", "zh-CN": "没有匹配的笔记", "zh-TW": "沒有相符的筆記" },
  "app.lock": { en: "Lock", "zh-CN": "锁定", "zh-TW": "鎖定" },
  "app.lockNote": { en: "Lock note", "zh-CN": "锁定笔记", "zh-TW": "鎖定筆記" },
  "app.unlockNote": { en: "Unlock note", "zh-CN": "解锁笔记", "zh-TW": "解鎖筆記" },
  "app.unlockToEdit": { en: "Unlock this note to edit", "zh-CN": "解锁笔记后可编辑", "zh-TW": "解鎖筆記後可編輯" },
  "app.noteLockedBadge": { en: "Locked note", "zh-CN": "已锁定笔记", "zh-TW": "已鎖定筆記" },
  "app.logout": { en: "Log out", "zh-CN": "登出", "zh-TW": "登出" },
  "app.resizeLeft": { en: "Resize left sidebar", "zh-CN": "调整左侧栏宽度", "zh-TW": "調整左側欄寬度" },
  "app.openLeft": { en: "Open left sidebar", "zh-CN": "打开左侧栏", "zh-TW": "開啟左側欄" },
  "app.noteTitle": { en: "Note title", "zh-CN": "笔记标题", "zh-TW": "筆記標題" },
  "app.selectNote": { en: "Select a note", "zh-CN": "选择一篇笔记", "zh-TW": "選擇一篇筆記" },
  "app.editorMode": { en: "Editor mode", "zh-CN": "编辑模式", "zh-TW": "編輯模式" },
  "app.modeLive": { en: "Live", "zh-CN": "实时", "zh-TW": "即時" },
  "app.modeSource": { en: "Source", "zh-CN": "源码", "zh-TW": "原始碼" },
  "app.modeReading": { en: "Read-only", "zh-CN": "只读模式", "zh-TW": "唯讀模式" },
  "app.addImage": { en: "Add image attachment", "zh-CN": "添加图片附件", "zh-TW": "新增圖片附件" },
  "app.openRight": { en: "Open right sidebar", "zh-CN": "打开右侧栏", "zh-TW": "開啟右側欄" },
  "app.emptyTitle": { en: "Select or create a note", "zh-CN": "选择或创建一篇笔记", "zh-TW": "選擇或建立一篇筆記" },
  "app.emptyNoteHint": { en: "Start writing…", "zh-CN": "开始写作…", "zh-TW": "開始寫作…" },
  "app.createdAt": { en: "Created: {date}", "zh-CN": "创建时间：{date}", "zh-TW": "建立時間：{date}" },
  "app.updatedAt": { en: "Modified: {date}", "zh-CN": "修改时间：{date}", "zh-TW": "修改時間：{date}" },
  "app.countHelp": { en: "Words are segmented by language and exclude punctuation. Characters exclude whitespace and include symbols.", "zh-CN": "字词按语言分段且不计标点。字符数不计空白但包含符号。", "zh-TW": "字詞依語言分段且不計標點。字元數不計空白但包含符號。" },
  "app.count": { en: "{words} words · {characters} characters", "zh-CN": "{words} 字词 · {characters} 字符", "zh-TW": "{words} 字詞 · {characters} 字元" },
  "app.resizeRight": { en: "Resize right sidebar", "zh-CN": "调整右侧栏宽度", "zh-TW": "調整右側欄寬度" },
  "app.rightPanel": { en: "Right panel", "zh-CN": "右侧面板", "zh-TW": "右側面板" },
  "app.outline": { en: "Outline", "zh-CN": "大纲", "zh-TW": "大綱" },
  "app.collapseRight": { en: "Collapse right sidebar", "zh-CN": "折叠右侧栏", "zh-TW": "收合右側欄" },
  "app.closeRight": { en: "Close right sidebar", "zh-CN": "关闭右侧栏", "zh-TW": "關閉右側欄" },
  "app.noteOutline": { en: "Note outline", "zh-CN": "笔记大纲", "zh-TW": "筆記大綱" },
  "app.outlineEmpty": { en: "Add Markdown headings to display an outline.", "zh-CN": "添加 Markdown 标题后将显示大纲。", "zh-TW": "新增 Markdown 標題後將顯示大綱。" },
  "outline.expandHeading": { en: "Expand {title}", "zh-CN": "展开 {title}", "zh-TW": "展開 {title}" },
  "outline.collapseHeading": { en: "Collapse {title}", "zh-CN": "收起 {title}", "zh-TW": "收合 {title}" },
  "app.closeSidebars": { en: "Close sidebars", "zh-CN": "关闭侧栏", "zh-TW": "關閉側欄" },
  "app.selectedCount": { en: "{count} items selected", "zh-CN": "已选择 {count} 个项目", "zh-TW": "已選擇 {count} 個項目" },
  "app.open": { en: "Open", "zh-CN": "打开", "zh-TW": "開啟" },
  "app.rename": { en: "Rename", "zh-CN": "重命名", "zh-TW": "重新命名" },
  "app.unpin": { en: "Unpin", "zh-CN": "取消置顶", "zh-TW": "取消置頂" },
  "app.createNoteInFolder": { en: "New note in folder", "zh-CN": "在文件夹中新建笔记", "zh-TW": "在資料夾中新增筆記" },
  "app.createSubfolder": { en: "New subfolder", "zh-CN": "新建子文件夹", "zh-TW": "新增子資料夾" },
  "app.duplicate": { en: "Make a copy", "zh-CN": "制作副本", "zh-TW": "製作副本" },
  "app.export": { en: "Export", "zh-CN": "导出", "zh-TW": "匯出" },
  "app.moveTo": { en: "Move to…", "zh-CN": "移动到…", "zh-TW": "移動到…" },
  "app.rootDirectory": { en: "Root directory", "zh-CN": "根目录", "zh-TW": "根目錄" },
  "app.restore": { en: "Restore", "zh-CN": "恢复", "zh-TW": "復原" },
  "app.permanentDeleteEllipsis": { en: "Permanently delete…", "zh-CN": "永久删除…", "zh-TW": "永久刪除…" },
  "app.moveToTrash": { en: "Move to trash", "zh-CN": "移到回收站", "zh-TW": "移到垃圾桶" },
  "app.markdownSource": { en: "Markdown source", "zh-CN": "Markdown 源码", "zh-TW": "Markdown 原始碼" },
  "properties.title": { en: "Note properties", "zh-CN": "笔记属性", "zh-TW": "筆記屬性" },
  "properties.key": { en: "Property name", "zh-CN": "属性名称", "zh-TW": "屬性名稱" },
  "properties.value": { en: "Value for {key}", "zh-CN": "{key} 的值", "zh-TW": "{key} 的值" },
  "properties.noValue": { en: "No value", "zh-CN": "没有值", "zh-TW": "沒有值" },
  "properties.add": { en: "Add note property", "zh-CN": "添加笔记属性", "zh-TW": "新增筆記屬性" },
  "properties.remove": { en: "Remove property", "zh-CN": "删除属性", "zh-TW": "刪除屬性" },
  "properties.removeNamed": { en: "Remove property {key}", "zh-CN": "删除属性 {key}", "zh-TW": "刪除屬性 {key}" },
  "properties.addListValue": { en: "Add value", "zh-CN": "添加值", "zh-TW": "新增值" },
  "properties.removeListValue": { en: "Remove value {value}", "zh-CN": "删除值 {value}", "zh-TW": "刪除值 {value}" },
  "properties.keyRequired": { en: "A property name is required.", "zh-CN": "属性名称不能为空。", "zh-TW": "屬性名稱不能為空。" },
  "properties.keyDuplicate": { en: "That property name already exists.", "zh-CN": "该属性名称已存在。", "zh-TW": "該屬性名稱已存在。" },
  "properties.invalid": {
    en: "Invalid YAML frontmatter. The original content is preserved.",
    "zh-CN": "YAML 元数据无效。已保留原始内容。",
    "zh-TW": "YAML 中繼資料無效。已保留原始內容。"
  },
  "properties.sourceHint": {
    en: "Switch to Source mode to edit the original YAML.",
    "zh-CN": "请切换到源码模式编辑原始 YAML。",
    "zh-TW": "請切換到原始碼模式編輯原始 YAML。"
  },
  "properties.complexValue": { en: "Complex YAML value", "zh-CN": "复杂 YAML 值", "zh-TW": "複雜 YAML 值" },
  "properties.complexHint": {
    en: "Complex YAML values are read-only here. Edit them in Source mode.",
    "zh-CN": "复杂 YAML 值在此处为只读。请在源码模式中编辑。",
    "zh-TW": "複雜 YAML 值在此處為唯讀。請在原始碼模式中編輯。"
  },
  "app.attachmentNotLoaded": { en: "Attachment not loaded: {name}", "zh-CN": "附件尚未加载：{name}", "zh-TW": "附件尚未載入：{name}" },

  "notice.attachmentConflict": { en: "Attachment metadata conflict. Server version retained. Local attachment chunks preserved.", "zh-CN": "附件元数据冲突。已保留服务器版本及本地附件分块。", "zh-TW": "附件中繼資料衝突。已保留伺服器版本及本機附件分塊。" },
  "notice.documentConflict": { en: "Sync conflict in “{title}”. Local changes saved as a conflict copy.", "zh-CN": "“{title}”存在同步冲突。本地修改已保存为冲突副本。", "zh-TW": "「{title}」存在同步衝突。本機變更已儲存為衝突副本。" },
  "notice.activeRemoteDeleted": { en: "This note was deleted on another device. The view will update when you leave this note.", "zh-CN": "此笔记已在其他设备上删除。离开当前笔记后将更新界面。", "zh-TW": "此筆記已在其他裝置上刪除。離開目前筆記後將更新介面。" },
  "notice.activeRemoteUpdated": { en: "This note was updated on another device. The remote version will load when you leave this note.", "zh-CN": "此笔记已在其他设备上更新。离开当前笔记后将应用远端版本。", "zh-TW": "此筆記已在其他裝置上更新。離開目前筆記後將套用遠端版本。" },
  "notice.remoteIntegrity": { en: "{count} encrypted server items failed integrity checks. The last readable local versions were preserved.", "zh-CN": "{count} 个服务器加密项目未通过完整性校验。已保留本地最后可读版本。", "zh-TW": "{count} 個伺服器加密項目未通過完整性驗證。已保留本機最後可讀版本。" },
  "notice.syncFailed": { en: "Sync failed. Changes are saved locally.", "zh-CN": "同步失败。修改已保存到本地。", "zh-TW": "同步失敗。變更已儲存至本機。" },
  "notice.localSaveFailed": {
    en: "Local save failed. The latest changes remain on this page but have not been saved.",
    "zh-CN": "本地保存失败。最新修改仅保留在当前页面中。",
    "zh-TW": "本機儲存失敗。最新變更僅保留在目前頁面中。"
  },
  "notice.localDecryptFailed": { en: "Unable to decrypt {count} local items. Other notes loaded successfully. {detail}", "zh-CN": "{count} 个本地加密项目无法解密。其他笔记已加载。{detail}", "zh-TW": "{count} 個本機加密項目無法解密。其他筆記已載入。{detail}" },
  "notice.pendingDecryptFailed": { en: "{count} items contain unsynced changes and were preserved unchanged.", "zh-CN": "其中 {count} 个项目含未同步修改并已原样保留。", "zh-TW": "其中 {count} 個項目含未同步變更並已原樣保留。" },
  "notice.ciphertextRetained": { en: "The original ciphertext was retained.", "zh-CN": "已保留原始密文。", "zh-TW": "已保留原始密文。" },
  "notice.ignoreRevision": { en: "Do not show this version again", "zh-CN": "不再提示此版本", "zh-TW": "不再提示此版本" },
  "notice.remoteIntegrityOthers": { en: "{count} encrypted server items failed integrity checks. Other notes loaded successfully. Readable local versions were preserved.", "zh-CN": "{count} 个服务器加密项目未通过完整性校验。其他笔记已加载。本地可读版本均已保留。", "zh-TW": "{count} 個伺服器加密項目未通過完整性驗證。其他筆記已載入。本機可讀版本均已保留。" },
  "notice.localRestoredSyncRetry": { en: "Local notes restored. Server sync failed and will retry automatically.", "zh-CN": "本地笔记已恢复。同步失败，稍后自动重试。", "zh-TW": "本機筆記已復原。同步失敗，稍後自動重試。" },
  "notice.loadedOffline": { en: "Local notes loaded offline.", "zh-CN": "已离线加载本地笔记。", "zh-TW": "已離線載入本機筆記。" },
  "notice.onlineSessionRequired": {
    en: "This action requires an online, verified server session.",
    "zh-CN": "此操作需要联网并完成服务器会话验证。",
    "zh-TW": "此操作需要連線並完成伺服器工作階段驗證。"
  },
  "notice.openDatabaseFailed": { en: "Unable to open the local encrypted database", "zh-CN": "无法打开本地加密数据库", "zh-TW": "無法開啟本機加密資料庫" },
  "notice.logoutLocalClearFailed": { en: "Unable to delete local account data. You are still logged in.", "zh-CN": "本地账户数据删除失败。当前账户尚未登出。", "zh-TW": "本機帳戶資料刪除失敗。目前帳戶尚未登出。" },
  "notice.attachmentLoadFailed": { en: "Unable to load attachment", "zh-CN": "附件加载失败", "zh-TW": "附件載入失敗" },
  "notice.attachmentSaveFailed": { en: "Unable to save attachment", "zh-CN": "附件保存失败", "zh-TW": "附件儲存失敗" },
  "notice.restoreNameConflict": { en: "Unable to restore: “{title}” already exists in the destination.", "zh-CN": "无法恢复：目标目录中已存在“{title}”。", "zh-TW": "無法復原：目標目錄中已存在「{title}」。" },
  "notice.wikiLinkNotFound": { en: "WikiLink target not found: {target}", "zh-CN": "找不到 WikiLink 目标：{target}", "zh-TW": "找不到 WikiLink 目標：{target}" },
  "notice.purgeSingleLabel": { en: "“{title}” and its child items and attachments", "zh-CN": "“{title}”及其子项目和附件", "zh-TW": "「{title}」及其子項目和附件" },
  "notice.purgeMultipleLabel": { en: "the selected {count} items and their child items and attachments", "zh-CN": "选中的 {count} 个项目及其子项目和附件", "zh-TW": "選取的 {count} 個項目及其子項目和附件" },
  "notice.purgeConfirm": { en: "Permanently delete {label}, all attachments and all history, including protected versions? This cannot be undone.", "zh-CN": "永久删除{label}、全部附件和全部历史（包括保护版本）？此操作无法撤销。", "zh-TW": "永久刪除{label}、全部附件與全部歷史（包括保護版本）？此操作無法復原。" },
  "notice.clearTrashConfirm": { en: "Permanently delete all trash contents? Server revision history and encrypted attachments will also be deleted. This cannot be undone.", "zh-CN": "永久删除回收站全部内容？服务器历史版本及附件密文也将删除。此操作无法撤销。", "zh-TW": "永久刪除垃圾桶全部內容？伺服器歷史版本及附件密文也將刪除。此操作無法復原。" },
  "notice.purgeOnlineOnly": { en: "Permanent deletion requires an online connection. Offline items remain in trash.", "zh-CN": "永久删除需联网。离线时内容仍保留在回收站。", "zh-TW": "永久刪除需連網。離線時內容仍保留在垃圾桶。" },
  "notice.purgeWaitSync": { en: "Wait for deletion status to synchronize before permanently deleting.", "zh-CN": "请等待删除状态同步完成后再永久删除。", "zh-TW": "請等待刪除狀態同步完成後再永久刪除。" },
  "notice.purgeComplete": { en: "Selected trash content permanently deleted.", "zh-CN": "已永久删除所选回收站内容。", "zh-TW": "已永久刪除所選垃圾桶內容。" },
  "notice.purgeFailed": { en: "Permanent deletion failed", "zh-CN": "永久删除失败", "zh-TW": "永久刪除失敗" },
  "notice.moveIntoDescendant": { en: "A folder cannot be moved into itself or a subfolder.", "zh-CN": "文件夹不能移入自身或其子文件夹。", "zh-TW": "資料夾不能移入自身或其子資料夾。" },
  "notice.moveNameConflict": { en: "Cannot move: an item named “{title}” already exists in the destination.", "zh-CN": "无法移动：目标目录中已有名为“{title}”的项目。", "zh-TW": "無法移動：目標目錄中已有名為「{title}」的項目。" },
  "notice.batchMoveIntoDescendant": { en: "Selected folders cannot be moved into themselves or their subfolders.", "zh-CN": "所选文件夹不能移入自身或其子文件夹。", "zh-TW": "所選資料夾不能移入自身或其子資料夾。" },
  "notice.batchMoveNameConflict": { en: "Cannot move selection: the destination would contain duplicate items named “{title}”.", "zh-CN": "无法批量移动：目标目录会出现名为“{title}”的重复项目。", "zh-TW": "無法批次移動：目標目錄會出現名為「{title}」的重複項目。" },
  "notice.encryptingAttachment": { en: "Encrypting {name} locally…", "zh-CN": "正在本地加密 {name}…", "zh-TW": "正在本機加密 {name}…" },
  "notice.attachmentSaved": { en: "Attachment “{name}” saved locally. Syncing in the background.", "zh-CN": "附件“{name}”已保存到本地。正在后台同步。", "zh-TW": "附件「{name}」已儲存至本機。正在背景同步。" },
  "notice.noteLocked": { en: "“{title}” locked", "zh-CN": "已锁定“{title}”", "zh-TW": "已鎖定「{title}」" },
  "notice.noteUnlocked": { en: "“{title}” unlocked", "zh-CN": "已解锁“{title}”", "zh-TW": "已解鎖「{title}」" },
  "notice.noteLockedEdit": { en: "Unlock “{title}” to edit", "zh-CN": "解锁“{title}”后可编辑", "zh-TW": "解鎖「{title}」後可編輯" },
  "notice.noteLockFailed": { en: "Unable to update note lock", "zh-CN": "无法更新笔记锁定状态", "zh-TW": "無法更新筆記鎖定狀態" },
  "notice.lockedTrashBlocked": { en: "Unlock “{title}” before moving this selection to trash", "zh-CN": "所选内容包含已锁定的“{title}”。请先解锁再移至回收站。", "zh-TW": "所選內容包含已鎖定的「{title}」。請先解鎖再移至垃圾桶。" },
  "notice.copiesCreated": { en: "{count} copies created.", "zh-CN": "已创建 {count} 个副本。", "zh-TW": "已建立 {count} 個副本。" },
  "notice.nameRequired": { en: "The name cannot be empty.", "zh-CN": "名称不能为空。", "zh-TW": "名稱不能為空。" },
  "notice.renameConflict": { en: "Cannot rename: an item named “{title}” already exists in this directory.", "zh-CN": "无法重命名：所在目录中已有名为“{title}”的项目。", "zh-TW": "無法重新命名：所在目錄中已有名為「{title}」的項目。" },
  "notice.allNotes": { en: "all notes", "zh-CN": "全部笔记", "zh-TW": "全部筆記" },
  "notice.exportConfirm": { en: "Export {label}? Exported files contain plaintext. Save them in a trusted location.", "zh-CN": "导出{label}？导出文件包含明文。请保存至可信位置。", "zh-TW": "匯出{label}？匯出檔案包含明文。請儲存至可信任的位置。" },
  "notice.exportSelectionConfirm": { en: "Export the selected {count} items? Exported files contain plaintext. Save them in a trusted location.", "zh-CN": "导出所选 {count} 个项目？导出文件包含明文。请保存至可信位置。", "zh-TW": "匯出所選 {count} 個項目？匯出檔案包含明文。請儲存至可信任的位置。" },
  "transfer.progress": { en: "Saving imported items: {completed} / {total}", "zh-CN": "正在保存导入项目：{completed} / {total}", "zh-TW": "正在儲存匯入項目：{completed} / {total}" },
  "transfer.namesRepaired": {"en": "Added numbers to {count} conflicting names. All content was preserved.", "zh-CN": "已为 {count} 个同名项目自动编号。全部内容已保留。", "zh-TW": "已為 {count} 個同名項目自動編號。全部內容已保留。"},
  "transfer.completedWithIssues": {"en": "Imported {count} notes. Review warnings and unfinished items.", "zh-CN": "已导入 {count} 篇笔记。请查看警告及未完成项目。", "zh-TW": "已匯入 {count} 篇筆記。請查看警告及未完成項目。"},
  "transfer.exportFailed": {"en": "Export failed. Ensure all notes and attachments are readable before retrying.", "zh-CN": "导出失败。请确认笔记及全部附件可读取后重试。", "zh-TW": "匯出失敗。請確認筆記及全部附件可讀取後重試。"},
  "transfer.resultTitle": {"en": "Import results", "zh-CN": "导入结果", "zh-TW": "匯入結果"},
  "transfer.summary": {"en": "Imported {notes} notes and {folders} folders. Warnings: {warnings}. Unfinished items: {pending}.", "zh-CN": "已导入 {notes} 篇笔记及 {folders} 个文件夹。警告：{warnings} 条。未完成：{pending} 项。", "zh-TW": "已匯入 {notes} 篇筆記及 {folders} 個資料夾。警告：{warnings} 則。未完成：{pending} 項。"},
  "transfer.renamed": {"en": "Renamed items ({count})", "zh-CN": "自动改名（{count}）", "zh-TW": "自動改名（{count}）"},
  "transfer.source": {"en": "Source", "zh-CN": "来源", "zh-TW": "來源"},
  "transfer.originalName": {"en": "Original name", "zh-CN": "原名称", "zh-TW": "原名稱"},
  "transfer.finalName": {"en": "Imported name", "zh-CN": "导入名称", "zh-TW": "匯入名稱"},
  "transfer.warnings": {"en": "Warnings ({count}) — original references retained", "zh-CN": "警告（{count}）：已保留原引用", "zh-TW": "警告（{count}）：已保留原引用"},
  "transfer.pending": {"en": "Unfinished items ({count})", "zh-CN": "未完成项目（{count}）", "zh-TW": "未完成項目（{count}）"},
  "transfer.issue.unsafePath": {"en": "Unsafe archive path. No files were imported.", "zh-CN": "归档包含不安全路径。未导入任何文件。", "zh-TW": "封存檔包含不安全路徑。未匯入任何檔案。"},
  "transfer.issue.archiveInvalid": {"en": "The archive is damaged, encrypted, or uses an unsupported format.", "zh-CN": "归档已损坏、已加密或使用不支持的格式。", "zh-TW": "封存檔已損壞、已加密或使用不支援的格式。"},
  "transfer.issue.fileLimit": {"en": "An import can contain at most 4,000 files.", "zh-CN": "每次最多导入 4,000 个文件。", "zh-TW": "每次最多匯入 4,000 個檔案。"},
  "transfer.issue.manifestInvalid": {"en": "The export manifest is invalid or ambiguous.", "zh-CN": "导出清单无效或存在歧义。", "zh-TW": "匯出清單無效或存在歧義。"},
  "transfer.issue.missingImage": {"en": "Image not found in the imported files.", "zh-CN": "导入文件中未找到该图片。", "zh-TW": "匯入檔案中未找到該圖片。"},
  "transfer.issue.ambiguousImage": {"en": "Multiple archive entries match this image reference.", "zh-CN": "归档中有多个条目匹配该图片引用。", "zh-TW": "封存檔中有多個項目符合該圖片引用。"},
  "transfer.issue.invalidImage": {"en": "The file is empty or is not a supported raster image.", "zh-CN": "文件为空或不是支持的栅格图片。", "zh-TW": "檔案為空或不是支援的點陣圖片。"},
  "transfer.issue.largeImage": {"en": "The image exceeds the 25 MiB attachment limit.", "zh-CN": "图片超过 25 MiB 附件限制。", "zh-TW": "圖片超過 25 MiB 附件限制。"},
  "transfer.issue.invalidUrl": {"en": "The image path cannot be decoded or leaves the archive.", "zh-CN": "图片路径无法解码或超出归档范围。", "zh-TW": "圖片路徑無法解碼或超出封存檔範圍。"},
  "transfer.issue.unmappedImage": {"en": "The image reference could not be safely located in the source.", "zh-CN": "无法准确定位图片引用的源码范围。", "zh-TW": "無法準確定位圖片引用的原始碼範圍。"},
  "transfer.issue.writeFailed": {"en": "Saving stopped. Completed items were preserved. Retry unfinished items.", "zh-CN": "保存已停止。已保留完成项目。请重试未完成项目。", "zh-TW": "儲存已停止。已保留完成項目。請重試未完成項目。"},
  "transfer.issue.cancelled": {"en": "Import was cancelled.", "zh-CN": "导入已取消。", "zh-TW": "匯入已取消。"},
  "notice.importing": { en: "Parsing and encrypting imported files…", "zh-CN": "正在解析并加密导入文件…", "zh-TW": "正在解析並加密匯入檔案…" },
  "notice.imported": { en: "{count} notes imported and saved locally.", "zh-CN": "已导入 {count} 篇笔记并保存到本机。", "zh-TW": "已匯入 {count} 篇筆記並儲存到本機。" },
  "notice.importFailed": { en: "Import failed", "zh-CN": "导入失败", "zh-TW": "匯入失敗" },
  "notice.configurePin": { en: "Set a device PIN under Settings > Security > Set PIN first.", "zh-CN": "请先在“设置 > 安全 > 设置 PIN”中设置本机 PIN。", "zh-TW": "請先在「設定 > 安全性 > 設定 PIN」中設定本機 PIN。" },

  "history.title": { en: "History", "zh-CN": "历史", "zh-TW": "歷史" },
  "history.list": { en: "Note history", "zh-CN": "笔记历史", "zh-TW": "筆記歷史" },
  "history.saveNow": { en: "Create snapshot", "zh-CN": "创建快照", "zh-TW": "建立快照" },
  "history.clearNote": { en: "Clear history", "zh-CN": "清空历史", "zh-TW": "清空歷史" },
  "history.empty": { en: "No history saved for this note.", "zh-CN": "此笔记暂无历史版本。", "zh-TW": "此筆記暫無歷史版本。" },
  "history.loading": { en: "Loading history…", "zh-CN": "正在加载历史…", "zh-TW": "正在載入歷史…" },
  "history.loadMore": { en: "Load older versions", "zh-CN": "加载更早版本", "zh-TW": "載入更早版本" },
  "history.pending": { en: "Pending sync", "zh-CN": "等待同步", "zh-TW": "等待同步" },
  "history.openMenu": { en: "History actions", "zh-CN": "历史版本操作", "zh-TW": "歷史版本操作" },
  "history.rename": { en: "Rename", "zh-CN": "重命名", "zh-TW": "重新命名" },
  "history.protect": { en: "Protect", "zh-CN": "保护", "zh-TW": "保護" },
  "history.unprotect": { en: "Remove protection", "zh-CN": "取消保护", "zh-TW": "取消保護" },
  "history.protectedBadge": { en: "Protected history", "zh-CN": "受保护的历史版本", "zh-TW": "受保護的歷史版本" },
  "history.protectedDeleteHint": { en: "Remove protection before deleting this version", "zh-CN": "取消保护后可删除此版本", "zh-TW": "取消保護後可刪除此版本" },
  "history.kindBaseline": { en: "Before editing", "zh-CN": "编辑前基线", "zh-TW": "編輯前基線" },
  "history.kindInterval": { en: "Saved automatically", "zh-CN": "自动保存", "zh-TW": "自動儲存" },
  "history.kindIdle": { en: "End of editing", "zh-CN": "编辑结束", "zh-TW": "編輯結束" },
  "history.kindManual": { en: "Saved manually", "zh-CN": "手动保存", "zh-TW": "手動儲存" },
  "history.kindRestoreSafety": { en: "Before restore", "zh-CN": "恢复前保护", "zh-TW": "復原前保護" },
  "history.deleteOne": { en: "Delete this version", "zh-CN": "删除此版本", "zh-TW": "刪除此版本" },
  "history.deleteConfirm": { en: "Permanently delete the history version from {date}?", "zh-CN": "永久删除 {date} 的历史版本？", "zh-TW": "永久刪除 {date} 的歷史版本？" },
  "history.clearNoteConfirm": { en: "Permanently clear unprotected history for “{title}”? Protected versions will be kept.", "zh-CN": "永久清空“{title}”中未保护的历史版本？受保护版本将保留。", "zh-TW": "永久清空「{title}」中未保護的歷史版本？受保護版本將保留。" },
  "history.clearAllConfirm": { en: "Permanently clear all unprotected note history for this account? Protected versions will be kept.", "zh-CN": "永久清空此账户中所有未保护的笔记历史？受保护版本将保留。", "zh-TW": "永久清空此帳戶中所有未保護的筆記歷史？受保護版本將保留。" },
  "history.preview": { en: "Historical preview", "zh-CN": "历史版本预览", "zh-TW": "歷史版本預覽" },
  "history.exitPreview": { en: "Exit preview", "zh-CN": "退出预览", "zh-TW": "退出預覽" },
  "history.restoreCopy": { en: "Restore as copy", "zh-CN": "恢复为副本", "zh-TW": "復原為副本" },
  "history.restoreCurrent": { en: "Restore current note", "zh-CN": "恢复为当前版本", "zh-TW": "復原為目前版本" },
  "history.restoreMissingAttachments": { en: "{count} referenced attachments are unavailable. Restore text only?", "zh-CN": "{count} 个引用附件不可用。是否仅恢复文本？", "zh-TW": "{count} 個引用附件無法使用。是否僅復原文字？" },
  "history.copyMissingAttachment": { en: "Attachment {attachment} is unavailable. Unable to restore the copy.", "zh-CN": "附件 {attachment} 不可用。无法恢复副本。", "zh-TW": "附件 {attachment} 無法使用。無法復原副本。" },
  "history.restoredCopyTitle": { en: "{title} (restored {date})", "zh-CN": "{title}（恢复副本 {date}）", "zh-TW": "{title}（復原副本 {date}）" },
  "history.unsupported": { en: "Unsupported history format.", "zh-CN": "不支持此历史版本格式。", "zh-TW": "不支援此歷史版本格式。" },

  "settings.history": { en: "Note history", "zh-CN": "笔记历史", "zh-TW": "筆記歷史" },
  "settings.historyHelp": { en: "History is encrypted in the browser and saved locally before syncing across devices.", "zh-CN": "历史版本在浏览器中加密并保存到本地。随后跨设备同步。", "zh-TW": "歷史版本在瀏覽器中加密並儲存至本機。隨後跨裝置同步。" },
  "settings.historyAutomatic": { en: "Automatic history", "zh-CN": "自动保存历史", "zh-TW": "自動儲存歷史" },
  "settings.historyFrequency": { en: "Active editing interval", "zh-CN": "持续编辑保存间隔", "zh-TW": "持續編輯儲存間隔" },
  "settings.historyRetention": { en: "Keep history for", "zh-CN": "历史保留时间", "zh-TW": "歷史保留時間" },
  "settings.historyTiered": { en: "Automatic versions rotate by time and capacity: all for 24 hours, then hourly through day 7 and daily afterwards. Manual and protected versions are retained; rotation pauses in the trash.", "zh-CN": "自动版本按时间和容量轮转：24小时内保留完整版本，第2至第7天每小时保留一份，此后每天一份。手动及保护版本保留，回收期间暂停轮转。", "zh-TW": "自動版本按時間與容量輪轉：24小時內保留完整版本，第2至第7天每小時保留一份，此後每天一份。手動及保護版本保留，回收期間暫停輪轉。" },
  "settings.historyStorage": { en: "Note history usage", "zh-CN": "笔记历史占用", "zh-TW": "筆記歷史用量" },
  "settings.historyVersionCount": { en: "{count} versions", "zh-CN": "{count} 个版本", "zh-TW": "{count} 個版本" },
  "settings.historyClearAll": { en: "Clear all history", "zh-CN": "清空全部历史", "zh-TW": "清空全部歷史" },

  "notice.historySaved": { en: "The current version was encrypted and saved locally.", "zh-CN": "当前版本已加密并保存到本地。", "zh-TW": "目前版本已加密並儲存到本機。" },
  "notice.historyUnchanged": { en: "This content is already the latest saved version.", "zh-CN": "当前内容与最新历史版本相同。", "zh-TW": "目前內容與最新歷史版本相同。" },
  "notice.historySaveFailed": { en: "Unable to save note history", "zh-CN": "无法保存笔记历史", "zh-TW": "無法儲存筆記歷史" },
  "notice.historyLoadFailed": { en: "Unable to load note history", "zh-CN": "无法加载笔记历史", "zh-TW": "無法載入筆記歷史" },
  "notice.historyDecryptFailed": { en: "Unable to decrypt this history version. Other versions remain available.", "zh-CN": "此历史版本解密失败。其他版本仍可使用。", "zh-TW": "此歷史版本解密失敗。其他版本仍可使用。" },
  "notice.historyDeleteOnlineOnly": { en: "History deletion requires an internet connection.", "zh-CN": "删除历史记录需要联网。", "zh-TW": "刪除歷史記錄需要連線。" },
  "notice.historyDeleted": { en: "History version deleted.", "zh-CN": "历史版本已删除。", "zh-TW": "歷史版本已刪除。" },
  "notice.historyDeleteFailed": { en: "Unable to delete the history version", "zh-CN": "无法删除历史版本", "zh-TW": "無法刪除歷史版本" },
  "notice.historyCleared": { en: "This note's history was cleared.", "zh-CN": "当前笔记的历史已清空。", "zh-TW": "目前筆記的歷史已清空。" },
  "notice.historyAllCleared": { en: "All note history was cleared.", "zh-CN": "全部笔记历史已清空。", "zh-TW": "全部筆記歷史已清空。" },
  "notice.historyClearFailed": { en: "Unable to clear note history", "zh-CN": "无法清空笔记历史", "zh-TW": "無法清空筆記歷史" },
  "notice.historyRestored": { en: "The historical content is now the current version.", "zh-CN": "历史内容已恢复为当前版本。", "zh-TW": "歷史內容已復原為目前版本。" },
  "notice.historyRestoreFailed": { en: "Unable to restore this history version", "zh-CN": "无法恢复此历史版本", "zh-TW": "無法復原此歷史版本" },
  "notice.historyCopyRestored": { en: "The history version was restored as a new note.", "zh-CN": "历史版本已恢复为一篇新笔记。", "zh-TW": "歷史版本已復原為一篇新筆記。" },
  "notice.historyCopyFailed": { en: "Unable to restore the history version as a copy", "zh-CN": "无法将历史版本恢复为副本", "zh-TW": "無法將歷史版本復原為副本" },
  "notice.historyQuotaReached": { en: "History storage quota reached. Automatic history is paused until space is freed.", "zh-CN": "历史存储配额已用尽。释放空间前将暂停自动保存历史版本。", "zh-TW": "歷史儲存配額已用盡。釋放空間前將暫停自動儲存歷史版本。" },
  "notice.historySettingsSaved": { en: "Note history settings saved.", "zh-CN": "笔记历史设置已保存。", "zh-TW": "筆記歷史設定已儲存。" },
  "notice.historySettingsLoadFailed": { en: "Unable to load note history settings", "zh-CN": "无法加载笔记历史设置", "zh-TW": "無法載入筆記歷史設定" },
  "notice.historySettingsSaveFailed": { en: "Unable to save note history settings", "zh-CN": "无法保存笔记历史设置", "zh-TW": "無法儲存筆記歷史設定" },
  "notice.historyNameRequired": { en: "History names cannot be empty.", "zh-CN": "历史版本名称不能为空。", "zh-TW": "歷史版本名稱不能為空。" },
  "notice.historyUpdateFailed": { en: "Unable to update the history version", "zh-CN": "无法更新历史版本", "zh-TW": "無法更新歷史版本" },
  "notice.historyProtected": { en: "History version protected.", "zh-CN": "历史版本已保护。", "zh-TW": "歷史版本已保護。" },
  "notice.historyUnprotected": { en: "History protection removed.", "zh-CN": "历史版本保护已取消。", "zh-TW": "歷史版本保護已取消。" },
  "notice.historyProtectedDeleteBlocked": { en: "Remove protection before deleting this history version.", "zh-CN": "取消保护后可删除此历史版本。", "zh-TW": "取消保護後可刪除此歷史版本。" },
  "notice.historyProtectionSyncRequired": { en: "Protection changes must finish synchronizing before history can be cleared.", "zh-CN": "保护状态同步完成后才能清空历史。", "zh-TW": "保護狀態同步完成後才能清空歷史。" },
  "notice.historyProtectedMissingAttachments": { en: "History version protected. {count} referenced attachments were already unavailable.", "zh-CN": "历史版本已保护。其中 {count} 个引用附件此前已不可用。", "zh-TW": "歷史版本已保護。其中 {count} 個引用附件先前已無法使用。" },

  "error.pinMin": { en: "The PIN must contain at least 4 characters", "zh-CN": "PIN 至少需要 4 个字符", "zh-TW": "PIN 至少需要 4 個字元" },
  "error.deviceCredentialMissing": { en: "No local unlock credential is available for this device", "zh-CN": "当前设备无可用的本机解锁凭据", "zh-TW": "目前裝置無可用的本機解鎖憑證" },
  "error.autoLockUnsupported": { en: "Unsupported automatic locking duration", "zh-CN": "不支持的自动锁定时间", "zh-TW": "不支援的自動鎖定時間" },
  "error.avatarProcess": { en: "Unable to process avatar image", "zh-CN": "无法处理头像图片", "zh-TW": "無法處理頭像圖片" },
  "error.avatarTooLarge": { en: "The source avatar image cannot exceed 10 MiB", "zh-CN": "头像原图不能超过 10 MiB", "zh-TW": "頭像原圖不能超過 10 MiB" },
  "error.avatarFormat": { en: "Choose a PNG, JPEG, GIF, WebP, or AVIF image", "zh-CN": "请选择 PNG、JPEG、GIF、WebP 或 AVIF 图片", "zh-TW": "請選擇 PNG、JPEG、GIF、WebP 或 AVIF 圖片" },
  "error.avatarBrowser": { en: "This browser cannot process the avatar image", "zh-CN": "当前浏览器无法处理头像图片", "zh-TW": "目前瀏覽器無法處理頭像圖片" },
  "error.attachmentEmpty": { en: "The attachment is empty", "zh-CN": "附件为空", "zh-TW": "附件是空的" },
  "error.attachmentFileTooLarge": { en: "An attachment cannot exceed 25 MiB", "zh-CN": "单个附件不能超过 25 MiB", "zh-TW": "單一附件不能超過 25 MiB" },
  "error.attachmentFormat": { en: "Only PNG, JPEG, GIF, WebP, and AVIF images are supported. File formats are verified.", "zh-CN": "仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片。文件格式须通过校验。", "zh-TW": "僅支援 PNG、JPEG、GIF、WebP 和 AVIF 圖片。檔案格式須通過驗證。" },
  "error.attachmentOffline": { en: "Attachment “{name}” is not cached. Offline access is unavailable.", "zh-CN": "附件“{name}”未缓存。离线时无法读取。", "zh-TW": "附件「{name}」未快取。離線時無法讀取。" },
  "error.missingAttachment": { en: "Note “{title}” is missing attachment {attachment}", "zh-CN": "笔记“{title}”缺少附件 {attachment}", "zh-TW": "筆記「{title}」缺少附件 {attachment}" },

  "api.crossOrigin": { en: "Cross-origin state change rejected", "zh-CN": "已拒绝跨来源状态变更", "zh-TW": "已拒絕跨來源狀態變更" },
  "api.authRequired": { en: "Authentication required", "zh-CN": "需要登录", "zh-TW": "需要登入" },
  "api.sessionInvalid": { en: "Session is no longer valid", "zh-CN": "登录会话已失效", "zh-TW": "登入工作階段已失效" },
  "api.adminRequired": { en: "Administrator access required", "zh-CN": "需要管理员权限", "zh-TW": "需要管理員權限" },
  "api.invalidRegistration": { en: "Invalid registration data", "zh-CN": "注册资料无效", "zh-TW": "註冊資料無效" },
  "api.registrationClosed": { en: "Registration is closed", "zh-CN": "注册已关闭", "zh-TW": "註冊已關閉" },
  "api.usernameReserved": { en: "Username is reserved for account activation", "zh-CN": "该用户名已预留给账户激活", "zh-TW": "該使用者名稱已保留給帳戶啟用" },
  "api.usernameUnavailable": { en: "Username is unavailable", "zh-CN": "用户名不可用", "zh-TW": "使用者名稱不可用" },
  "api.invalidActivation": { en: "Invalid account activation", "zh-CN": "账户激活资料无效", "zh-TW": "帳戶啟用資料無效" },
  "api.activationInvalid": { en: "Activation code is invalid or expired", "zh-CN": "激活码无效或已过期", "zh-TW": "啟用碼無效或已過期" },
  "api.accountNotFound": { en: "Account not found", "zh-CN": "未找到账户", "zh-TW": "找不到帳戶" },
  "api.invalidCredentials": { en: "Incorrect username or password", "zh-CN": "用户名或密码不正确", "zh-TW": "使用者名稱或密碼不正確" },
  "api.invalidRecovery": { en: "Invalid recovery request", "zh-CN": "密码恢复请求无效", "zh-TW": "密碼復原請求無效" },
  "api.recoveryFailed": { en: "Recovery failed", "zh-CN": "密码恢复失败", "zh-TW": "密碼復原失敗" },
  "api.invalidPasswordChange": { en: "Invalid password change", "zh-CN": "密码修改请求无效", "zh-TW": "密碼變更請求無效" },
  "api.currentPasswordIncorrect": { en: "Current password is incorrect", "zh-CN": "当前密码不正确", "zh-TW": "目前密碼不正確" },
  "api.invalidRecoveryReset": { en: "Invalid recovery key reset", "zh-CN": "恢复密钥重置请求无效", "zh-TW": "復原金鑰重設請求無效" },
  "api.invalidUsernameChange": { en: "Invalid username change", "zh-CN": "用户名修改请求无效", "zh-TW": "使用者名稱變更請求無效" },
  "api.recoveryKeyIncorrect": { en: "Recovery key is incorrect", "zh-CN": "恢复密钥不正确", "zh-TW": "復原金鑰不正確" },
  "api.usernameUnchanged": { en: "Username is unchanged", "zh-CN": "用户名没有变化", "zh-TW": "使用者名稱沒有變更" },
  "api.invalidProfile": { en: "Invalid profile", "zh-CN": "个人资料无效", "zh-TW": "個人資料無效" },
  "api.invalidAvatar": { en: "Invalid encrypted avatar", "zh-CN": "加密头像无效", "zh-TW": "加密頭像無效" },
  "api.invalidTrashRetention": { en: "Invalid trash retention", "zh-CN": "回收站保留设置无效", "zh-TW": "垃圾桶保留設定無效" },
  "api.invalidHistorySettings": { en: "Invalid note history settings", "zh-CN": "笔记历史设置无效", "zh-TW": "筆記歷史設定無效" },
  "api.invalidHistoryRequest": { en: "Invalid note history request", "zh-CN": "笔记历史请求无效", "zh-TW": "筆記歷史請求無效" },
  "api.invalidEncryptedHistory": { en: "Invalid encrypted note history", "zh-CN": "加密笔记历史无效", "zh-TW": "加密筆記歷史無效" },
  "api.noteNotFound": { en: "Note not found", "zh-CN": "未找到笔记", "zh-TW": "找不到筆記" },
  "api.historyNotFound": { en: "History snapshot not found", "zh-CN": "未找到历史版本", "zh-TW": "找不到歷史版本" },
  "api.historyCleared": { en: "History snapshot was cleared", "zh-CN": "历史版本已被清除", "zh-TW": "歷史版本已被清除" },
  "api.historyExists": { en: "History snapshot already exists", "zh-CN": "历史版本已存在", "zh-TW": "歷史版本已存在" },
  "api.historyQuota": { en: "Note history quota exceeded", "zh-CN": "笔记历史配额已用尽", "zh-TW": "筆記歷史配額已用盡" },
  "api.protectedHistory": { en: "Protected history blocks this operation", "zh-CN": "受保护的历史版本阻止了此操作", "zh-TW": "受保護的歷史版本阻止了此操作" },
  "api.endpointNotFound": { en: "Device not found", "zh-CN": "未找到设备", "zh-TW": "找不到裝置" },
  "api.endpointTooNew": { en: "This device must be signed in for 24 hours before this action is available", "zh-CN": "当前设备登录满 24 小时后才能执行此操作", "zh-TW": "目前裝置登入滿 24 小時後才能執行此操作" },
  "api.logoutCurrentEndpoint": { en: "Use Log out to end the current device session", "zh-CN": "请使用“登出”结束当前设备会话", "zh-TW": "請使用「登出」結束目前裝置工作階段" },
  "api.endpointAlreadySignedOut": { en: "Device already signed out", "zh-CN": "该设备已登出", "zh-TW": "該裝置已登出" },
  "api.invalidSyncEvent": { en: "Invalid synchronization event request", "zh-CN": "同步事件请求无效", "zh-TW": "同步事件請求無效" },
  "api.invalidEncryptedObject": { en: "Invalid encrypted object", "zh-CN": "加密对象无效", "zh-TW": "加密物件無效" },
  "api.invalidEncryptedObjectBatch": { en: "Invalid encrypted object batch", "zh-CN": "批量加密对象无效", "zh-TW": "批次加密物件無效" },
  "api.invalidPurge": { en: "Invalid purge request", "zh-CN": "永久删除请求无效", "zh-TW": "永久刪除請求無效" },
  "api.objectTypeChange": { en: "Object type cannot change", "zh-CN": "对象类型不能更改", "zh-TW": "物件類型不能變更" },
  "api.revisionConflict": { en: "Revision conflict", "zh-CN": "版本冲突", "zh-TW": "版本衝突" },
  "api.purgeConflict": { en: "Purge conflict", "zh-CN": "永久删除发生冲突", "zh-TW": "永久刪除發生衝突" },
  "api.invalidAttachmentChunk": { en: "Invalid encrypted attachment chunk", "zh-CN": "加密附件分块无效", "zh-TW": "加密附件分塊無效" },
  "api.attachmentTooLarge": { en: "Attachment chunk is too large", "zh-CN": "附件分块过大", "zh-TW": "附件分塊過大" },
  "api.attachmentExists": { en: "Attachment chunk already exists", "zh-CN": "附件分块已存在", "zh-TW": "附件分塊已存在" },
  "api.attachmentNotFound": { en: "Attachment chunk not found", "zh-CN": "未找到附件分块", "zh-TW": "找不到附件分塊" },
  "api.quotaExceeded": { en: "User storage quota exceeded", "zh-CN": "用户存储配额已用尽", "zh-TW": "使用者儲存配額已用盡" },
  "api.invalidUserSetup": { en: "Invalid user setup", "zh-CN": "用户激活资料无效", "zh-TW": "使用者啟用資料無效" },
  "api.setupNotFound": { en: "Account setup not found", "zh-CN": "未找到账户激活资料", "zh-TW": "找不到帳戶啟用資料" },
  "api.invalidUserUpdate": { en: "Invalid user update", "zh-CN": "用户更新请求无效", "zh-TW": "使用者更新請求無效" },
  "api.cannotDisableSelf": { en: "You cannot disable your own account", "zh-CN": "不能禁用自己的账户", "zh-TW": "不能停用自己的帳戶" },
  "api.userNotFound": { en: "User not found", "zh-CN": "未找到用户", "zh-TW": "找不到使用者" },
  "api.invalidUserDeletion": { en: "Invalid user deletion", "zh-CN": "用户删除请求无效", "zh-TW": "使用者刪除請求無效" },
  "api.cannotDeleteSelf": { en: "You cannot delete your own account", "zh-CN": "不能删除自己的账户", "zh-TW": "不能刪除自己的帳戶" },
  "api.usernameMismatch": { en: "Username confirmation does not match", "zh-CN": "确认用户名不匹配", "zh-TW": "確認使用者名稱不相符" },
  "api.lastAdmin": { en: "The last administrator cannot be deleted", "zh-CN": "不能删除最后一位管理员", "zh-TW": "不能刪除最後一位管理員" }
} as const;

export type MessageKey = keyof typeof messages;
export type Translate = (key: MessageKey, values?: TranslationValues) => string;

export const LANGUAGE_OPTIONS: ReadonlyArray<{ value: LanguagePreference; label: string }> = [
  { value: "system", label: "" },
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" }
];

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "system" || SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

export function detectBrowserLocale(languages?: readonly string[]): SupportedLocale {
  const candidates = languages?.length
    ? languages
    : typeof navigator !== "undefined"
      ? (navigator.languages.length ? navigator.languages : [navigator.language])
      : ["en"];
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase().replace("_", "-");
    if (normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-mo" || normalized.startsWith("zh-hant")) return "zh-TW";
    if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-sg" || normalized.startsWith("zh-hans")) return "zh-CN";
    if (normalized === "en" || normalized.startsWith("en-")) return "en";
  }
  return "en";
}

export function getLanguagePreference(): LanguagePreference {
  if (typeof localStorage === "undefined") return "system";
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguagePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function storeLanguagePreference(preference: LanguagePreference): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
  } catch {
    // Language selection remains active for this page when storage is unavailable.
  }
}

export function resolveLocale(preference: LanguagePreference, languages?: readonly string[]): SupportedLocale {
  return preference === "system" ? detectBrowserLocale(languages) : preference;
}

export function translateMessage(locale: SupportedLocale, key: MessageKey, values: TranslationValues = {}): string {
  let text: string = messages[key][locale];
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

export function translateCurrent(key: MessageKey, values?: TranslationValues): string {
  return translateMessage(resolveLocale(getLanguagePreference()), key, values);
}

const errorMessages: Record<string, MessageKey> = {
  "HISTORY_LOCAL_BUDGET_EXCEEDED": "notice.historyQuotaReached",
  "PIN 至少需要 4 个字符": "error.pinMin",
  "当前设备没有可用的本机解锁凭据": "error.deviceCredentialMissing",
  "不支持的自动锁定时间": "error.autoLockUnsupported",
  "无法处理头像图片": "error.avatarProcess",
  "头像原图不能超过 10 MiB": "error.avatarTooLarge",
  "请选择 PNG、JPEG、GIF、WebP 或 AVIF 图片": "error.avatarFormat",
  "当前浏览器无法处理头像图片": "error.avatarBrowser",
  "附件为空": "error.attachmentEmpty",
  "单个附件不能超过 25 MiB": "error.attachmentFileTooLarge",
  "仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片，且会校验真实文件格式": "error.attachmentFormat",
  "Cross-origin state change rejected": "api.crossOrigin",
  "Authentication required": "api.authRequired",
  "Session is no longer valid": "api.sessionInvalid",
  "Administrator access required": "api.adminRequired",
  "Invalid registration data": "api.invalidRegistration",
  "Registration is closed": "api.registrationClosed",
  "Username is reserved for account activation": "api.usernameReserved",
  "Username is unavailable": "api.usernameUnavailable",
  "Invalid account activation": "api.invalidActivation",
  "Activation code is invalid or expired": "api.activationInvalid",
  "Account not found": "api.accountNotFound",
  "Invalid credentials": "api.invalidCredentials",
  "Invalid recovery request": "api.invalidRecovery",
  "Recovery failed": "api.recoveryFailed",
  "Invalid password change": "api.invalidPasswordChange",
  "Current password is incorrect": "api.currentPasswordIncorrect",
  "Invalid recovery key reset": "api.invalidRecoveryReset",
  "Invalid username change": "api.invalidUsernameChange",
  "Recovery key is incorrect": "api.recoveryKeyIncorrect",
  "Username is unchanged": "api.usernameUnchanged",
  "Invalid profile": "api.invalidProfile",
  "Invalid encrypted avatar": "api.invalidAvatar",
  "Invalid trash retention": "api.invalidTrashRetention",
  "Invalid note history settings": "api.invalidHistorySettings",
  "Invalid note history request": "api.invalidHistoryRequest",
  "Invalid encrypted note history": "api.invalidEncryptedHistory",
  "Note not found": "api.noteNotFound",
  "History snapshot not found": "api.historyNotFound",
  "History snapshot was cleared": "api.historyCleared",
  "History snapshot already exists": "api.historyExists",
  "Protected history cannot be deleted": "api.protectedHistory",
  "Protected history blocks purge": "api.protectedHistory",
  "Note history quota exceeded": "api.historyQuota",
  "Endpoint not found": "api.endpointNotFound",
  "Current endpoint must be at least 24 hours old": "api.endpointTooNew",
  "Use logout to end the current endpoint": "api.logoutCurrentEndpoint",
  "Endpoint is already signed out": "api.endpointAlreadySignedOut",
  "Invalid synchronization event request": "api.invalidSyncEvent",
  "Invalid encrypted object": "api.invalidEncryptedObject",
  "Invalid encrypted object batch": "api.invalidEncryptedObjectBatch",
  "Invalid purge request": "api.invalidPurge",
  "Object type cannot change": "api.objectTypeChange",
  "Revision conflict": "api.revisionConflict",
  "Purge conflict": "api.purgeConflict",
  "Invalid encrypted attachment chunk": "api.invalidAttachmentChunk",
  "Attachment chunk is too large": "api.attachmentTooLarge",
  "Attachment chunk already exists": "api.attachmentExists",
  "Attachment chunk not found": "api.attachmentNotFound",
  "User storage quota exceeded": "api.quotaExceeded",
  "Invalid user setup": "api.invalidUserSetup",
  "Account setup not found": "api.setupNotFound",
  "Invalid user update": "api.invalidUserUpdate",
  "You cannot disable your own account": "api.cannotDisableSelf",
  "User not found": "api.userNotFound",
  "Invalid user deletion": "api.invalidUserDeletion",
  "You cannot delete your own account": "api.cannotDeleteSelf",
  "Username confirmation does not match": "api.usernameMismatch",
  "The last administrator cannot be deleted": "api.lastAdmin"
};

export function translateError(error: unknown, t: Translate, fallback: MessageKey): string {
  if (!(error instanceof Error)) return t(fallback);
  const code = (error as Error & { data?: { code?: string } }).data?.code;
  if (code === "PROTOCOL_UPGRADE_REQUIRED") return t("notice.syncUpgradeRequired");
  if (code === "METADATA_QUOTA_EXCEEDED") return t("notice.metadataQuotaReached");
  if (code === "OPERATION_EXPIRED") return t("notice.operationExpired");
  if (code === "OWNERSHIP_INCOMPLETE") return t("notice.ownershipIncomplete");
  const key = errorMessages[error.message];
  if (key) return t(key);
  const offlineAttachment = /^附件“(.+)”尚未缓存，离线时无法读取$/.exec(error.message);
  if (offlineAttachment) return t("error.attachmentOffline", { name: offlineAttachment[1] });
  const missingAttachment = /^笔记“(.+)”缺少附件 (.+)$/.exec(error.message);
  if (missingAttachment) return t("error.missingAttachment", { title: missingAttachment[1], attachment: missingAttachment[2] });
  return error.message || t(fallback);
}

interface I18nValue {
  languagePreference: LanguagePreference;
  locale: SupportedLocale;
  setLanguagePreference: (preference: LanguagePreference) => void;
  t: Translate;
  formatDateTime: (value: string | number | Date) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [languagePreference, setPreferenceState] = useState<LanguagePreference>(getLanguagePreference);
  const [browserLocale, setBrowserLocale] = useState(() => detectBrowserLocale());
  const locale = languagePreference === "system" ? browserLocale : languagePreference;

  const setLanguagePreference = useCallback((preference: LanguagePreference) => {
    setPreferenceState(preference);
    storeLanguagePreference(preference);
  }, []);

  useEffect(() => {
    const update = () => setBrowserLocale(detectBrowserLocale());
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback<Translate>((key, values) => translateMessage(locale, key, values), [locale]);
  const formatDateTime = useCallback((value: string | number | Date) => (
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  ), [locale]);

  const value = useMemo<I18nValue>(() => ({
    languagePreference,
    locale,
    setLanguagePreference,
    t,
    formatDateTime
  }), [formatDateTime, languagePreference, locale, setLanguagePreference, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
