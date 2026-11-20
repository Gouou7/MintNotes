import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { LanguagePreference } from "../types";

export const SUPPORTED_LOCALES = ["en", "zh-CN", "zh-TW"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type { LanguagePreference } from "../types";
export type TranslationValues = Record<string, string | number>;

const LANGUAGE_STORAGE_KEY = "webmd-notes-language";

const messages = {
  "storage.bodyDownload": { en: "Note downloads", "zh-CN": "正文下载", "zh-TW": "正文下載" },
  "storage.bodyDownloadHelp": { en: "The note you open downloads first.", "zh-CN": "优先下载当前打开的笔记。", "zh-TW": "優先下載目前開啟的筆記。" },
  "storage.bodyDemand": { en: "Download on demand", "zh-CN": "仅需要时下载", "zh-TW": "僅需要時下載" },
  "storage.bodyRecent": { en: "Download recent notes", "zh-CN": "下载最近的笔记", "zh-TW": "下載最近的筆記" },
  "storage.bodyAll": { en: "Download all", "zh-CN": "下载全部", "zh-TW": "下載全部" },
  "storage.bodyRecentLimit": { en: "Number of recently updated notes", "zh-CN": "最近更新的笔记数量", "zh-TW": "最近更新的筆記數量" },
  "storage.bodyRecentLimitHelp": { en: "Enter a number from 1 to 200.", "zh-CN": "输入 1 至 200。", "zh-TW": "輸入 1 至 200。" },
  "storage.bodyCoverage": { en: "{count} of {total} note bodies available on this device", "zh-CN": "本机已有 {count} 篇正文，共 {total} 篇", "zh-TW": "本機已有 {count} 篇正文，共 {total} 篇" },
  "storage.loadingCatalog": { en: "Syncing the note list…", "zh-CN": "正在同步笔记列表…", "zh-TW": "正在同步筆記列表…" },
  "storage.bodyLoading": { en: "Downloading note…", "zh-CN": "正在下载正文…", "zh-TW": "正在下載正文…" },
  "storage.bodyOffline": { en: "This note has no current offline copy.", "zh-CN": "当前版本尚未下载，联网后可打开。", "zh-TW": "目前版本尚未下載，連線後可開啟。" },
  "storage.bodyCachedVersion": { en: "Showing the last downloaded version.", "zh-CN": "正在显示上次下载的版本。", "zh-TW": "正在顯示上次下載的版本。" },
  "storage.bodyFailed": { en: "Could not load this note. Try again.", "zh-CN": "无法加载正文，请重试。", "zh-TW": "無法載入正文，請重試。" },
  "storage.bodyRetry": { en: "Retry download", "zh-CN": "重试下载", "zh-TW": "重試下載" },
  "storage.searchCoverage": { en: "Searching titles and downloaded text", "zh-CN": "搜索标题和已下载正文", "zh-TW": "搜尋標題和已下載正文" },
  "storage.searchAllBodies": { en: "Search all note text", "zh-CN": "搜索全库正文", "zh-TW": "搜尋全庫正文" },
  "storage.cancelBodySearch": { en: "Cancel full text search", "zh-CN": "取消全文搜索", "zh-TW": "取消全文搜尋" },
  "storage.searchBodiesFailed": { en: "Some notes could not be searched. Results include downloaded notes.", "zh-CN": "部分正文未能搜索，结果已包含已下载的笔记。", "zh-TW": "部分正文未能搜尋，結果已包含已下載的筆記。" },
  "storage.browserStorage": {"en": "Browser storage", "zh-CN": "浏览器存储", "zh-TW": "瀏覽器儲存"},
  "storage.databaseDetails": {"en": "Details", "zh-CN": "详细信息", "zh-TW": "詳細資訊"},
  "storage.retentionRules": {"en": "Retention rules", "zh-CN": "保留规则", "zh-TW": "保留規則"},
  "storage.pending": {"en": "Pending sync", "zh-CN": "待同步", "zh-TW": "待同步"},
  "storage.recoveryTitle": { "en": "Kept originals", "zh-CN": "已保留的原稿", "zh-TW": "已保留的原稿" },
  "storage.recoverySection": { en: "Data recovery", "zh-CN": "数据恢复", "zh-TW": "資料復原" },
  "storage.recoveryHelp": { "en": "On this device there are {count} retained originals. You can retry recovery or export them.", "zh-CN": "本机保留了 {count} 份原稿，可以重试恢复或导出。", "zh-TW": "本機保留了 {count} 份原稿，可以重試復原或匯出。" },
  "storage.upgradeBlocked": { "en": "Another tab is blocking the local data upgrade. Save your changes and close that tab, then return here. Keep this site’s data.", "zh-CN": "其他标签页仍在使用本地数据。请保存内容并关闭这些标签页，然后返回此页。请勿清除站点数据。", "zh-TW": "其他分頁仍在使用本機資料。請儲存內容並關閉這些分頁，再返回此頁。請勿清除網站資料。" },
  "storage.recoveryRetry": { "en": "Retry synchronization", "zh-CN": "重试同步", "zh-TW": "重試同步" },
  "storage.recoveryExport": { "en": "Export retained sources", "zh-CN": "导出保留原稿", "zh-TW": "匯出保留原稿" },
  "storage.objects": { en: "Objects", "zh-CN": "对象", "zh-TW": "物件" },
  "storage.pendingCounts": {"en": "Objects {objects}, attachments {attachments}, history versions {history}", "zh-CN": "{objects} 个对象，{attachments} 个附件，{history} 个历史版本", "zh-TW": "{objects} 個物件，{attachments} 個附件，{history} 個歷史版本"},
  "storage.unsaved": {"en": "Not yet saved locally", "zh-CN": "尚未保存到本地", "zh-TW": "尚未儲存至本機"},
  "storage.noteCount": {"en": "{count} notes", "zh-CN": "{count} 篇", "zh-TW": "{count} 篇"},
  "storage.localEstimate": {"en": "Estimated local data size", "zh-CN": "本地数据用量估算", "zh-TW": "本機資料用量估算"},
  "storage.lastCompleteSync": {"en": "Last complete sync", "zh-CN": "上次完整同步", "zh-TW": "上次完整同步"},
  "storage.siteEstimateLabel": {"en": "Estimated site usage and capacity", "zh-CN": "站点用量与容量估算", "zh-TW": "網站用量與容量估算"},
  "storage.pendingUnknown": {"en": "Checking for unsynced changes…", "zh-CN": "正在检查待同步数据…", "zh-TW": "正在檢查待同步資料…"},
  "storage.title": {"en": "Notes and storage", "zh-CN": "笔记和存储", "zh-TW": "筆記與儲存"},
  "storage.refresh": {"en": "Refresh", "zh-CN": "刷新", "zh-TW": "重新整理"},
  "storage.total": {"en": "Total storage", "zh-CN": "总存储用量", "zh-TW": "總儲存用量"},
  "storage.serverUsage": { en: "Server usage", "zh-CN": "服务器用量", "zh-TW": "伺服器用量" },
  "storage.breakdown": { en: "Usage breakdown", "zh-CN": "用量构成", "zh-TW": "用量組成" },
  "storage.quotaLabel": { en: "Quota: {size}", "zh-CN": "配额：{size}", "zh-TW": "配額：{size}" },
  "storage.totalQuota": {"en": "Total quota", "zh-CN": "总配额", "zh-TW": "總配額"},
  "storage.notes": {"en": "Notes", "zh-CN": "笔记", "zh-TW": "筆記"},
  "storage.attachments": {"en": "Attachments", "zh-CN": "附件", "zh-TW": "附件"},
  "storage.avatar": {"en": "Avatar", "zh-CN": "头像", "zh-TW": "頭像"},
  "storage.activeData": { en: "Active data", "zh-CN": "未删除数据", "zh-TW": "未刪除資料" },
  "storage.updatedAt": {"en": "Updated {date}", "zh-CN": "更新于{date}", "zh-TW": "更新於{date}"},
  "storage.cachedAt": {"en": "Cached {date}", "zh-CN": "缓存于{date}", "zh-TW": "快取於{date}"},
  "storage.local": {"en": "Local status", "zh-CN": "本地状态", "zh-TW": "本機狀態"},
  "storage.localPayload": {"en": "Estimated local encrypted data for this account: {size}", "zh-CN": "当前账户的本地加密数据约为 {size}", "zh-TW": "目前帳戶的本機加密資料約為 {size}"},
  "storage.pendingSummary": {"en": "Waiting to sync: {objects} objects, {attachments} attachments and {history} history versions. Notes not yet saved locally: {unsaved}.", "zh-CN": "待同步的内容包括 {objects} 个对象、{attachments} 个附件和 {history} 个历史版本。另有 {unsaved} 篇笔记尚未完成本地保存。", "zh-TW": "待同步的內容包括 {objects} 個物件、{attachments} 個附件與 {history} 個歷史版本。另有 {unsaved} 篇筆記尚未完成本機儲存。"},
  "storage.lastSync": {"en": "Last complete sync at {date}", "zh-CN": "上次完整同步于 {date}", "zh-TW": "上次完整同步於 {date}"},
  "storage.neverSynced": {"en": "Not recorded yet", "zh-CN": "尚无记录", "zh-TW": "尚無記錄"},
  "storage.siteEstimate": {"en": "Site usage: about {used}. Browser capacity: about {quota}.", "zh-CN": "站点用量约为 {used}，浏览器估算容量约为 {quota}", "zh-TW": "網站用量約為 {used}，瀏覽器估算容量約為 {quota}"},
  "storage.unknown": {"en": "Unknown", "zh-CN": "未知", "zh-TW": "未知"},
  "storage.estimateUnavailable": {"en": "The browser could not estimate storage usage.", "zh-CN": "浏览器暂时无法提供存储估算。", "zh-TW": "瀏覽器暫時無法提供儲存估算。"},
  "storage.estimateHelp": {"en": "This estimate includes all accounts and caches on this site. It is separate from account usage and free disk space.", "zh-CN": "此估算包括本站所有账户和缓存。账户用量与磁盘剩余空间需分别查看。", "zh-TW": "此估算包括本站所有帳戶與快取。帳戶用量與磁碟剩餘空間需分別查看。"},
  "storage.requestPersistence": {"en": "Request persistence", "zh-CN": "申请持久存储", "zh-TW": "申請持久儲存"},
  "storage.persistenceLabel": { en: "Persistent storage", "zh-CN": "持久存储", "zh-TW": "持久儲存" },
  "storage.persistence.unsupported": {"en": "Persistence unavailable", "zh-CN": "不支持持久存储", "zh-TW": "不支援持久儲存"},
  "storage.persistence.granted": {"en": "Persistent storage granted", "zh-CN": "持久存储已授权", "zh-TW": "持久儲存已授權"},
  "storage.persistence.best-effort": {"en": "Persistent storage not granted", "zh-CN": "持久存储未授权", "zh-TW": "持久儲存未授權"},
  "storage.persistence.denied": {"en": "Persistence request declined", "zh-CN": "持久存储申请未获准", "zh-TW": "持久儲存申請未獲准"},
  "storage.persistenceHelp": {"en": "Persistent storage reduces the chance that the browser clears local data automatically. You can still clear it manually. Keep a backup of your data.", "zh-CN": "持久存储可降低浏览器自动清理本地数据的风险。数据仍可手动清除，请保留备份。", "zh-TW": "持久儲存可降低瀏覽器自動清理本機資料的風險。資料仍可手動清除，請保留備份。"},
  "storage.noServerUsage": {"en": "Connect to the server to view usage.", "zh-CN": "连接服务器后可查看用量。", "zh-TW": "連線至伺服器後即可查看用量。"},
  "storage.level.normal": {"en": "Within quota", "zh-CN": "空间充足", "zh-TW": "空間充足"},
  "storage.level.warning": {"en": "At least 80% of quota used", "zh-CN": "用量已达配额的 80%", "zh-TW": "用量已達配額的 80%"},
  "storage.level.critical": {"en": "At least 95% of quota used", "zh-CN": "用量已达配额的 95%", "zh-TW": "用量已達配額的 95%"},
  "storage.level.full": {"en": "Quota reached. Uploads that add to usage are paused.", "zh-CN": "已达配额。会增加用量的上传已暂停。", "zh-TW": "已達配額。會增加用量的上傳已暫停。"},
  "storage.level.unlimited": {"en": "No total quota limit", "zh-CN": "总配额不限", "zh-TW": "總配額不限"},
  "storage.warningNotice": {"en": "Storage usage has reached 80% of the quota.", "zh-CN": "存储用量已达配额的 80%。", "zh-TW": "儲存用量已達配額的 80%。"},
  "storage.criticalNotice": {"en": "Storage usage has reached 95% of the quota. Free up space or ask an administrator to raise the quota.", "zh-CN": "存储用量已达配额的 95%。请释放空间，或联系管理员提高配额。", "zh-TW": "儲存用量已達配額的 95%。請釋出空間，或聯絡管理員提高配額。"},
  "storage.fullNotice": {"en": "The storage quota has been reached. Saved changes remain on this device. Free up space to resume uploads that require more storage.", "zh-CN": "存储用量已达配额，已保存的修改仍在本地。释放空间后可继续上传需要更多空间的内容。", "zh-TW": "儲存用量已達配額，已儲存的變更仍在本機。釋出空間後可繼續上傳需要更多空間的內容。"},
  "storage.inherit": {"en": "Use server default", "zh-CN": "使用服务器默认值", "zh-TW": "使用伺服器預設值"},
  "storage.customLimit": {"en": "Custom", "zh-CN": "自定义", "zh-TW": "自訂"},
  "storage.unlimited": {"en": "Unlimited", "zh-CN": "不限", "zh-TW": "不限"},
  "storage.capacityMiB": {"en": "Capacity (MiB)", "zh-CN": "容量（MiB）", "zh-TW": "容量（MiB）"},
  "storage.historyBudget": {"en": "Note history quota", "zh-CN": "笔记历史配额", "zh-TW": "筆記歷史配額"},
  "storage.historyBudgetHelp": {"en": "History uses the total quota even when its own limit is set to Unlimited.", "zh-CN": "即使历史配额设为不限，历史仍计入总配额。", "zh-TW": "即使歷史配額設為不限，歷史仍計入總配額。"},
  "storage.saveQuota": {"en": "Save quota", "zh-CN": "保存配额", "zh-TW": "儲存配額"},
  "storage.editQuota": {"en": "Edit quota", "zh-CN": "设置配额", "zh-TW": "設定配額"},
  "storage.userQuota": {"en": "Storage quota for {name}", "zh-CN": "{name}的存储配额", "zh-TW": "{name}的儲存配額"},
  "storage.lowerQuotaWarning": {"en": "The new quota is below current usage. I understand that existing data will stay and uploads that increase usage will be restricted.", "zh-CN": "我确认新配额低于当前用量。现有数据会保留，增加用量的上传将受限。", "zh-TW": "我確認新配額低於目前用量。現有資料會保留，增加用量的上傳將受限。"},
  "storage.quotaSaved": {"en": "Storage quota updated", "zh-CN": "存储配额已更新", "zh-TW": "儲存配額已更新"},
  "storage.quotaSaveFailed": {"en": "Could not update the storage quota", "zh-CN": "无法更新存储配额", "zh-TW": "無法更新儲存配額"},
  "storage.migration": {"en": "Note migration", "zh-CN": "笔记迁移", "zh-TW": "筆記遷移"},
  "storage.importNotes": { en: "Import notes", "zh-CN": "导入笔记", "zh-TW": "匯入筆記" },
  "storage.exportNotes": { en: "Export notes", "zh-CN": "导出笔记", "zh-TW": "匯出筆記" },
  "storage.importHelp": { en: "Supports Markdown, plain text and ZIP files.", "zh-CN": "支持Markdown、纯文本及ZIP文件。", "zh-TW": "支援Markdown、純文字及ZIP檔案。" },
  "storage.exportAll": {"en": "Export complete ZIP", "zh-CN": "导出完整压缩包", "zh-TW": "匯出完整壓縮包"},
  "storage.importPackage": {"en": "Import ZIP or notes", "zh-CN": "导入压缩包或笔记", "zh-TW": "匯入壓縮包或筆記"},
  "storage.exportScope": {"en": "The ZIP file includes current notes and attachments. It is unencrypted and excludes history and Trash.", "zh-CN": "ZIP 文件包含当前笔记及附件，未加密且不包含历史和回收站内容。", "zh-TW": "ZIP 檔案包含目前的筆記與附件，未加密且不包含歷史與垃圾桶內容。"},
  "storage.transferFailed": {"en": "Could not complete the import or export. The original data was kept.", "zh-CN": "导入或导出未完成。原始数据已保留。", "zh-TW": "匯入或匯出未完成。原始資料已保留。"},
  "storage.databaseFailed": {"en": "Could not read the database status. Refresh to try again.", "zh-CN": "无法读取数据库状态。请刷新后重试。", "zh-TW": "無法讀取資料庫狀態。請重新整理後重試。"},
  "storage.databaseState": {"en": "SQLite {sqlite} · Schema {schema} · {journal}", "zh-CN": "SQLite {sqlite} · 结构{schema} · {journal}", "zh-TW": "SQLite {sqlite} · 結構{schema} · {journal}"},
  "storage.databaseReady": {"en": "Database available", "zh-CN": "数据库连接正常", "zh-TW": "資料庫連線正常"},
  "storage.databaseFiles": {"en": "Database files total", "zh-CN": "数据库文件总占用", "zh-TW": "資料庫檔案總佔用"},
  "storage.logicalHelp": { en: "Encrypted data counted toward account quotas.", "zh-CN": "计入账户配额的加密数据。", "zh-TW": "計入帳戶配額的加密資料。" },
  "storage.backupsSeparate": { en: "Stored separately from the database files above.", "zh-CN": "独立存储，不计入上方数据库文件用量。", "zh-TW": "獨立儲存，不計入上方資料庫檔案用量。" },
  "storage.databaseFile": {"en": "Main database file", "zh-CN": "数据库主文件", "zh-TW": "資料庫主檔案"},
  "storage.wal": {"en": "WAL file", "zh-CN": "WAL日志文件", "zh-TW": "WAL日誌檔案"},
  "storage.shm": {"en": "Shared memory file", "zh-CN": "共享内存文件", "zh-TW": "共用記憶體檔案"},
  "storage.reusable": {"en": "Reusable space inside database", "zh-CN": "数据库内部可复用空间", "zh-TW": "資料庫內部可重用空間"},
  "storage.allUserData": {"en": "All users' logical data", "zh-CN": "全部用户逻辑数据用量", "zh-TW": "全部使用者邏輯資料用量"},
  "storage.databaseReadOnly": {"en": "Reusable space is included in the database file. Maintenance requires the stopped-service tools.", "zh-CN": "可复用空间已计入文件大小。维护需停机执行。", "zh-TW": "可重用空間已計入檔案大小。維護需停機執行。"},
  "notice.metadataQuotaReached": { en: "The sync record limit has been reached. Some changes cannot sync. You can still permanently delete synced items in Trash.", "zh-CN": "同步记录已达上限，部分修改无法同步。仍可永久删除回收站中已同步的项目。", "zh-TW": "同步記錄已達上限，部分變更無法同步。仍可永久刪除垃圾桶中已同步的項目。" },
  "notice.historyClearResult": { en: "Deleted {deleted} history versions and kept {preserved} protected versions.", "zh-CN": "已删除 {deleted} 个历史版本，保留 {preserved} 个受保护的版本。", "zh-TW": "已刪除 {deleted} 個歷史版本，保留 {preserved} 個受保護的版本。" },
  "storage.logical": { en: "Storage usage", "zh-CN": "存储用量", "zh-TW": "儲存用量" },
  "storage.content": { en: "Current notes and attachments", "zh-CN": "当前笔记与附件", "zh-TW": "目前筆記與附件" },
  "storage.physical": { en: "Server disk usage", "zh-CN": "服务器磁盘占用", "zh-TW": "伺服器磁碟用量" },
  "storage.physicalHelp": { en: "Disk usage includes database files with reusable space and any backups. Account quota is calculated separately.", "zh-CN": "磁盘用量包括数据库文件和备份，也计入数据库内可复用的空间。账户配额另行计算。", "zh-TW": "磁碟用量包括資料庫檔案與備份，也計入資料庫內可重複使用的空間。帳戶配額另行計算。" },
  "storage.database": { en: "Database", "zh-CN": "数据库", "zh-TW": "資料庫" },
  "storage.backups": { en: "Backups", "zh-CN": "备份", "zh-TW": "備份" },
  "storage.unavailable": { en: "Connect to the server to refresh usage.", "zh-CN": "连接服务器后可刷新用量。", "zh-TW": "連線伺服器後可更新用量。" },
  "storage.cacheHelp": { en: "The browser caches up to 128 MiB of synced attachments and 64 MiB of history content. Older content may need to be downloaded again. Changes waiting to sync stay on this device.", "zh-CN": "浏览器最多缓存 128 MiB 的已同步附件和 64 MiB 的历史正文。较早的内容可能需要联网重新下载。待同步数据仍保留在本地。", "zh-TW": "瀏覽器最多快取 128 MiB 的已同步附件與 64 MiB 的歷史正文。較早的內容可能需要連網重新下載。待同步資料仍保留在本機。" },
  "notice.recoveredHistoryMetadata": { en: "History version “{name}” from {date}. Its original content is no longer available on the server.", "zh-CN": "历史版本“{name}”保存于 {date}。原正文在服务器上已不可用。", "zh-TW": "歷史版本「{name}」儲存於 {date}。原正文在伺服器上已無法取得。" },
  "history.kindApplicationEdit": { en: "Before application edit", "zh-CN": "应用编辑前", "zh-TW": "應用編輯前" },
  "history.offlineAvailable": { en: "Available offline", "zh-CN": "可离线读取", "zh-TW": "可離線讀取" },
  "history.downloadRequired": { en: "Download required", "zh-CN": "需联网下载", "zh-TW": "需連線下載" },
  "notice.recoveryMissingAttachments": { en: "The recovery copy was saved. {count} attachments could not be recovered, but their references remain in the note.", "zh-CN": "恢复副本已保存。{count} 个附件无法恢复，正文仍保留附件引用。", "zh-TW": "復原副本已儲存。{count} 個附件無法復原，正文仍保留附件引用。" },
  "notice.syncUpgradeRequired": { en: "Update Mint Notes to resume syncing. Local data has been kept.", "zh-CN": "请更新 Mint Notes 后继续同步。本地数据已保留。", "zh-TW": "請更新 Mint Notes 後繼續同步。本機資料已保留。" },
  "notice.operationExpired": { en: "The operation expired. Its local data has been kept.", "zh-CN": "操作已过期。本地数据已保留。", "zh-TW": "操作已過期。本機資料已保留。" },
  "notice.ownershipIncomplete": { en: "Open and unlock Mint Notes, then let sync finish before permanently deleting notes.", "zh-CN": "请打开并解锁 Mint Notes，待同步完成后再永久删除笔记。", "zh-TW": "請開啟並解鎖 Mint Notes，待同步完成後再永久刪除筆記。" },
  "applications.title": {"en": "Application connections", "zh-CN": "应用连接", "zh-TW": "應用連線"},
  "applications.help": {"en": "Use an application key to connect trusted apps. Apps can only read locked notes. Revoking access leaves existing offline copies intact.", "zh-CN": "使用应用密钥连接可信应用。应用只能读取已锁定的笔记。撤销连接后，已有的离线副本仍会保留。", "zh-TW": "使用應用程式金鑰連接可信的應用程式。應用程式只能讀取已鎖定的筆記。撤銷連線後，既有的離線副本仍會保留。"},
  "applications.authorization": { en: "Application access", "zh-CN": "应用授权", "zh-TW": "應用程式授權" },
  "applications.permissionHelp": { en: "Writing requires an online connection. To change permissions, create a new connection.", "zh-CN": "写入需联网。更改权限需新建连接。", "zh-TW": "寫入需連網。變更權限需建立新連線。" },
  "applications.idleHelp": { en: "The idle period starts at the last online data access.", "zh-CN": "从上次通过网络访问数据时起计算。", "zh-TW": "從上次透過網路存取資料時起計算。" },
  "applications.add": {"en": "Add a connection", "zh-CN": "添加连接", "zh-TW": "新增連線"},
  "applications.refresh": {"en": "Refresh", "zh-CN": "刷新", "zh-TW": "重新整理"},
  "applications.revokeAll": {"en": "Revoke all connections", "zh-CN": "撤销所有连接", "zh-TW": "撤銷所有連線"},
  "applications.failed": {"en": "Unable to complete the request. Please retry.", "zh-CN": "操作失败。请重试。", "zh-TW": "操作失敗。請重試。"},
  "applications.name": {"en": "Application name", "zh-CN": "应用名称", "zh-TW": "應用名稱"},
  "applications.permission": {"en": "Permission", "zh-CN": "权限", "zh-TW": "權限"},
  "applications.readWrite": {"en": "Read and write", "zh-CN": "读写", "zh-TW": "讀寫"},
  "applications.readOnly": {"en": "Read only", "zh-CN": "只读", "zh-TW": "唯讀"},
  "applications.idleExpiry": {"en": "Idle time limit", "zh-CN": "闲置期限", "zh-TW": "閒置期限"},
  "applications.days": {"en": "{count} days", "zh-CN": "{count} 天", "zh-TW": "{count} 天"},
  "applications.never": {"en": "No limit", "zh-CN": "不限", "zh-TW": "不限"},
  "applications.fixedExpiry": {"en": "Expiry date (optional)", "zh-CN": "指定到期时间（可选）", "zh-TW": "指定到期時間（選填）"},
  "applications.policyHelp": {"en": "Inactivity is measured from the last online data access. Permission changes require a new connection. Writing requires an online connection.", "zh-CN": "闲置时间从最近一次在线数据访问起计算。更改权限需新建连接。写入数据需联网。", "zh-TW": "閒置時間自最近一次線上資料存取起計算。變更權限需建立新連線。寫入資料需連網。"},
  "applications.retry": {"en": "Retry creation", "zh-CN": "重试创建", "zh-TW": "重試建立"},
  "applications.generate": {"en": "Generate application key", "zh-CN": "生成应用密钥", "zh-TW": "產生應用金鑰"},
  "applications.newKey": {"en": "New application key", "zh-CN": "新应用密钥", "zh-TW": "新應用金鑰"},
  "applications.once": {"en": "The key is shown only once. Copy it to the application before closing. If you lose it, create a new connection.", "zh-CN": "应用密钥仅显示一次。请在关闭前将它保存到应用中。丢失后需新建连接。", "zh-TW": "應用程式金鑰僅顯示一次。請在關閉前將它儲存至應用程式。遺失後需建立新連線。"},
  "applications.serverUrl": {"en": "Server address", "zh-CN": "服务地址", "zh-TW": "服務位址"},
  "applications.key": {"en": "Application key", "zh-CN": "应用密钥", "zh-TW": "應用金鑰"},
  "applications.copyUrl": {"en": "Copy address", "zh-CN": "复制地址", "zh-TW": "複製位址"},
  "applications.copyKey": {"en": "Copy key", "zh-CN": "复制密钥", "zh-TW": "複製金鑰"},
  "applications.savedKey": {"en": "Confirm key saved", "zh-CN": "确认已保存密钥", "zh-TW": "確認已儲存金鑰"},
  "applications.copied": {"en": "Copied", "zh-CN": "已复制", "zh-TW": "已複製"},
  "applications.copyFailed": {"en": "Unable to copy. Select the content and copy it manually.", "zh-CN": "复制失败。请选中内容后手动复制。", "zh-TW": "複製失敗。請選取內容後手動複製。"},
  "applications.removeDevice": {"en": "Remove record", "zh-CN": "移除记录", "zh-TW": "移除記錄"},
  "applications.revoke": {"en": "Revoke", "zh-CN": "撤销", "zh-TW": "撤銷"},
  "applications.confirmAll": {"en": "Revoke all connections? Connected apps will lose online access. Any offline copies they already have will remain.", "zh-CN": "要撤销所有连接吗？已连接的应用将失去在线访问权限，已有离线副本仍会保留。", "zh-TW": "要撤銷所有連線嗎？已連線的應用程式將失去線上存取權限，既有離線副本仍會保留。"},
  "applications.confirmOne": {"en": "Revoke this connection? The app will lose online access. Any offline copies it already has will remain.", "zh-CN": "要撤销此连接吗？应用将失去在线访问权限，已有离线副本仍会保留。", "zh-TW": "要撤銷此連線嗎？應用程式將失去線上存取權限，既有離線副本仍會保留。"},
  "applications.empty": {"en": "No application connections", "zh-CN": "尚无应用连接", "zh-TW": "尚無應用連線"},
  "applications.active": {"en": "Active", "zh-CN": "有效", "zh-TW": "有效"},
  "applications.expired": {"en": "Expired", "zh-CN": "已到期", "zh-TW": "已到期"},
  "applications.revoked": {"en": "Revoked", "zh-CN": "已撤销", "zh-TW": "已撤銷"},
  "applications.created": {"en": "Created: {date}", "zh-CN": "创建：{date}", "zh-TW": "建立：{date}"},
  "applications.lastUsed": {"en": "Last used: {date}", "zh-CN": "最近使用：{date}", "zh-TW": "最近使用：{date}"},
  "applications.unused": {"en": "Not yet used", "zh-CN": "尚未使用", "zh-TW": "尚未使用"},
  "applications.idlePolicy": {"en": "Inactivity timeout: {value}", "zh-CN": "闲置期限：{value}", "zh-TW": "閒置期限：{value}"},
  "applications.expires": {"en": "Expires: {date}", "zh-CN": "到期时间：{date}", "zh-TW": "到期時間：{date}"},
  "applications.edit": {"en": "Edit", "zh-CN": "编辑", "zh-TW": "編輯"},
  "editor.backToFootnote": { en: "Back to footnote reference", "zh-CN": "返回脚注引用", "zh-TW": "返回註腳引用" },
  "editor.sourceLabel": { en: "Markdown source", "zh-CN": "Markdown 源码", "zh-TW": "Markdown 原始碼" },
  "editor.toggleCallout": { en: "Toggle callout", "zh-CN": "展开或折叠 Callout", "zh-TW": "展開或摺疊 Callout" },
  "editor.diagramRendering": { en: "Rendering diagram…", "zh-CN": "正在渲染图表…", "zh-TW": "正在繪製圖表…" },
  "editor.diagramFailed": { en: "Unable to render Mermaid diagram", "zh-CN": "无法渲染 Mermaid 图表", "zh-TW": "無法繪製 Mermaid 圖表" },
  "editor.diagramAlt": { en: "Mermaid diagram", "zh-CN": "Mermaid 图表", "zh-TW": "Mermaid 圖表" },
  "editor.insertRetry": { en: "The insertion position changed. Try inserting the attachment again.", "zh-CN": "插入位置已变化。请重新插入附件。", "zh-TW": "插入位置已改變。請重新插入附件。" },
  "editor.tableSize": { en: "Resize table", "zh-CN": "调整表格大小", "zh-TW": "調整表格大小" },
  "editor.tableDelete": { en: "Delete table", "zh-CN": "删除表格", "zh-TW": "刪除表格" },
  "editor.alignLeft": { en: "Align left", "zh-CN": "左对齐", "zh-TW": "靠左對齊" },
  "editor.alignCenter": { en: "Align center", "zh-CN": "居中对齐", "zh-TW": "置中對齊" },
  "editor.alignRight": { en: "Align right", "zh-CN": "右对齐", "zh-TW": "靠右對齊" },
  "editor.rows": { en: "Rows", "zh-CN": "行数", "zh-TW": "列數" },
  "editor.columns": { en: "Columns", "zh-CN": "列数", "zh-TW": "欄數" },
  "editor.codeLanguage": { en: "Code language", "zh-CN": "代码语言", "zh-TW": "程式碼語言" },
  "editor.invalidCodeLanguage": { en: "Remove backticks and line breaks from the code language.", "zh-CN": "请删除代码语言中的反引号或换行。", "zh-TW": "請移除程式碼語言中的反引號或換行。" },
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
    en: "Make sure your notes are saved locally before updating.",
    "zh-CN": "更新前，请确认笔记已保存到本地。",
    "zh-TW": "更新前，請確認筆記已儲存至本機。"
  },
  "pwa.update.title": { en: "Update available", "zh-CN": "有可用更新", "zh-TW": "有可用更新" },
  "pwa.update.action": { en: "Update now", "zh-CN": "立即更新", "zh-TW": "立即更新" },

  "auth.recovery.title": { en: "Save your recovery key", "zh-CN": "保存恢复密钥", "zh-TW": "儲存復原金鑰" },
  "auth.recovery.description": {
    en: "Save this key in a password manager or a secure offline location. The server cannot recover your encrypted notes for you.",
    "zh-CN": "请将恢复密钥保存到密码管理器或安全的离线位置。服务器无法代为恢复加密笔记。",
    "zh-TW": "請將復原金鑰儲存至密碼管理員或安全的離線位置。伺服器無法代為復原加密筆記。"
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
    en: "I saved the recovery key in a secure location.",
    "zh-CN": "我已将恢复密钥保存在安全位置。",
    "zh-TW": "我已將復原金鑰儲存在安全位置。"
  },
  "auth.recovery.saved": { en: "Recovery key saved", "zh-CN": "已保存恢复密钥", "zh-TW": "已儲存復原金鑰" },
  "auth.register.title": { en: "Create encrypted account", "zh-CN": "创建加密账户", "zh-TW": "建立加密帳戶" },
  "auth.activate.title": { en: "Register with activation code", "zh-CN": "使用激活码注册", "zh-TW": "使用啟用碼註冊" },
  "auth.recover.title": { en: "Reset your master password", "zh-CN": "重置主密码", "zh-TW": "重設主密碼" },
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
    en: "Use your recovery key to reset your master password. If you lose both, your notes cannot be recovered.",
    "zh-CN": "可用恢复密钥重置主密码。如果两者均丢失，笔记将无法恢复。",
    "zh-TW": "可用復原金鑰重設主密碼。如果兩者均遺失，筆記將無法復原。"
  },
  "auth.username": { en: "Username", "zh-CN": "用户名", "zh-TW": "使用者名稱" },
  "auth.displayName": { en: "Display name", "zh-CN": "显示名称", "zh-TW": "顯示名稱" },
  "auth.activationCode": { en: "Activation code", "zh-CN": "激活码", "zh-TW": "啟用碼" },
  "auth.recoveryKey": { en: "Recovery key", "zh-CN": "恢复密钥", "zh-TW": "復原金鑰" },
  "auth.masterPassword": { en: "Master password", "zh-CN": "主密码", "zh-TW": "主密碼" },
  "auth.newMasterPassword": { en: "New master password", "zh-CN": "新主密码", "zh-TW": "新主密碼" },
  "auth.confirmPassword": { en: "Confirm master password", "zh-CN": "确认主密码", "zh-TW": "確認主密碼" },
  "auth.confirmNewPassword": { en: "Confirm new master password", "zh-CN": "确认新主密码", "zh-TW": "確認新主密碼" },
  "auth.currentPassword": { en: "Current master password", "zh-CN": "当前主密码", "zh-TW": "目前主密碼" },
  "auth.rememberDevice": { en: "Remember this device", "zh-CN": "记住此设备", "zh-TW": "記住此裝置" },
  "auth.processingKeys": { en: "Preparing encryption keys…", "zh-CN": "正在准备加密密钥…", "zh-TW": "正在準備加密金鑰…" },
  "auth.login": { en: "Log in", "zh-CN": "登录", "zh-TW": "登入" },
  "auth.register": { en: "Register", "zh-CN": "注册", "zh-TW": "註冊" },
  "auth.createAccount": { en: "Create account", "zh-CN": "创建账户", "zh-TW": "建立帳戶" },
  "auth.activateCreate": { en: "Activate account", "zh-CN": "激活账户", "zh-TW": "啟用帳戶" },
  "auth.resetPassword": { en: "Reset master password", "zh-CN": "重置主密码", "zh-TW": "重設主密碼" },
  "auth.forgotPassword": { en: "Forgot password", "zh-CN": "忘记密码", "zh-TW": "忘記密碼" },
  "auth.normalRegistration": { en: "Standard registration", "zh-CN": "普通注册", "zh-TW": "一般註冊" },
  "auth.configError": {
    en: "Could not load registration settings. Select Register to try again.",
    "zh-CN": "无法加载注册设置。请选择“注册”重试。",
    "zh-TW": "無法載入註冊設定。請選擇「註冊」重試。"
  },
  "auth.offlineUnavailable": {
    en: "Before using Mint Notes offline, sign in online on this version and remember this device.",
    "zh-CN": "离线使用前，请先在当前版本联网登录并记住此设备。",
    "zh-TW": "離線使用前，請先在目前版本連網登入並記住此裝置。"
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
    en: "Checking sign-in status…",
    "zh-CN": "正在检查登录状态…",
    "zh-TW": "正在檢查登入狀態…"
  },
  "lock.title": { en: "Notes locked", "zh-CN": "笔记已锁定", "zh-TW": "筆記已鎖定" },
  "lock.offline": {
    en: "Connect to the internet to unlock with your master password.",
    "zh-CN": "联网后可使用主密码解锁。",
    "zh-TW": "連網後即可使用主密碼解鎖。"
  },
  "lock.devicePin": { en: "Device PIN", "zh-CN": "本机 PIN", "zh-TW": "本機 PIN" },
  "lock.unlocking": { en: "Unlocking…", "zh-CN": "正在解锁…", "zh-TW": "正在解鎖…" },
  "lock.unlockWithPin": { en: "Unlock with PIN", "zh-CN": "使用 PIN 解锁", "zh-TW": "使用 PIN 解鎖" },
  "lock.usePassword": { en: "Use master password", "zh-CN": "改用主密码", "zh-TW": "改用主密碼" },
  "lock.verifying": { en: "Verifying…", "zh-CN": "正在验证…", "zh-TW": "正在驗證…" },
  "lock.unlockWithPassword": { en: "Unlock with master password", "zh-CN": "使用主密码解锁", "zh-TW": "使用主密碼解鎖" },
  "lock.backToPin": { en: "Back to PIN unlock", "zh-CN": "返回 PIN 解锁", "zh-TW": "返回 PIN 解鎖" },
  "account.switch": { en: "Switch account", "zh-CN": "切换账户", "zh-TW": "切換帳戶" },
  "account.current": { en: "Current account", "zh-CN": "当前账户", "zh-TW": "目前帳戶" },
  "account.back": { en: "Back", "zh-CN": "返回", "zh-TW": "返回" },
  "account.otherLogin": { en: "Sign in to another account", "zh-CN": "登录其他账户", "zh-TW": "登入其他帳戶" },
  "account.rememberFailed": { en: "Could not remember this device. Sign in again to retry.", "zh-CN": "无法记住此设备。请重新登录后重试。", "zh-TW": "無法記住此裝置。請重新登入後重試。" },
  "account.reauth": { en: "Sign in again to use this account online.", "zh-CN": "请重新登录后在线使用此账户。", "zh-TW": "請重新登入後在線上使用此帳戶。" },
  "account.switchFailed": { en: "Could not switch or close the account. Check other Mint Notes tabs and try again.", "zh-CN": "无法切换或关闭账户。请检查其他 Mint Notes 标签页后重试。", "zh-TW": "無法切換或關閉帳戶。請檢查其他 Mint Notes 分頁後重試。" },
  "account.deviceResumable": { en: "Sign-in can be restored", "zh-CN": "可恢复登录", "zh-TW": "可恢復登入" },
  "lock.logout": { en: "Sign out", "zh-CN": "退出登录", "zh-TW": "登出" },
  "lock.invalidPin": { en: "Incorrect PIN", "zh-CN": "PIN 不正确", "zh-TW": "PIN 不正確" },
  "lock.cannotUnlock": { en: "Unable to unlock", "zh-CN": "无法解锁", "zh-TW": "無法解鎖" },
  "lock.invalidPassword": { en: "Incorrect master password", "zh-CN": "主密码不正确", "zh-TW": "主密碼不正確" },

  "settings.title": { en: "Settings", "zh-CN": "设置", "zh-TW": "設定" },
  "settings.localOnly": {
    en: "Some settings are unavailable until your sign-in is verified.",
    "zh-CN": "部分设置需验证登录状态后才能更改。",
    "zh-TW": "部分設定需驗證登入狀態後才能變更。"
  },
  "settings.close": { en: "Close settings", "zh-CN": "关闭设置", "zh-TW": "關閉設定" },
  "settings.general": { en: "General", "zh-CN": "通用", "zh-TW": "通用" },
  "settings.security": { en: "Account and security", "zh-CN": "用户和安全", "zh-TW": "使用者與安全" },
  "settings.trash": { en: "Trash", "zh-CN": "回收站", "zh-TW": "垃圾桶" },
  "settings.data": { en: "Data migration", "zh-CN": "数据迁移", "zh-TW": "資料移轉" },
  "settings.about": { en: "About", "zh-CN": "关于", "zh-TW": "關於" },
  "settings.admin": { en: "Administrator settings", "zh-CN": "管理员设置", "zh-TW": "管理員設定" },
  "settings.logoutTitle": { en: "Sign out of this device?", "zh-CN": "要退出此设备的登录吗？", "zh-TW": "要從此裝置登出嗎？" },
  "settings.logoutWarning": {
    en: "Signing out clears this account’s local notes, attachments and changes from this browser. Unsynced data will be lost. Synced data stays on the server.",
    "zh-CN": "退出登录会清除此浏览器中当前账户的本地笔记、附件和修改。未同步的数据将无法恢复。已同步的数据保留在服务器上。",
    "zh-TW": "登出會清除此瀏覽器中目前帳戶的本機筆記、附件和變更。未同步的資料將無法復原。已同步的資料會保留在伺服器上。"
  },
  "settings.profile": { en: "Profile", "zh-CN": "个人资料", "zh-TW": "個人資料" },
  "settings.editProfile": { en: "Edit profile", "zh-CN": "编辑资料", "zh-TW": "編輯資料" },
  "settings.name": { en: "Display name", "zh-CN": "显示名称", "zh-TW": "顯示名稱" },
  "settings.changeDisplayName": { en: "Change display name", "zh-CN": "修改显示名称", "zh-TW": "修改顯示名稱" },
  "settings.changeUsername": { en: "Change username", "zh-CN": "修改用户名", "zh-TW": "變更使用者名稱" },
  "settings.newUsername": { en: "New username", "zh-CN": "新用户名", "zh-TW": "新使用者名稱" },
  "settings.changeUsernameHelp": {
    en: "Changing the username requires other devices to log in again with the new username.",
    "zh-CN": "修改用户名后，其他设备需使用新用户名重新登录。",
    "zh-TW": "變更使用者名稱後，其他裝置需使用新使用者名稱重新登入。"
  },
  "settings.verifyUsernameChange": { en: "Verify username change", "zh-CN": "验证用户名修改", "zh-TW": "驗證使用者名稱變更" },
  "settings.usernameVerificationHelp": {
    en: "Enter your current master password and recovery key. If you no longer have the key, you can reset it to continue.",
    "zh-CN": "请输入当前主密码和恢复密钥。如果无法取得恢复密钥，可重置后继续。",
    "zh-TW": "請輸入目前的主密碼與復原金鑰。如果無法取得復原金鑰，可重設後繼續。"
  },
  "settings.resetRecoveryAndContinue": { en: "Reset recovery key and continue", "zh-CN": "重置恢复密钥并继续", "zh-TW": "重設復原金鑰並繼續" },
  "settings.confirmUsernameChange": { en: "Confirm change", "zh-CN": "确认修改", "zh-TW": "確認變更" },
  "settings.saveReplacementRecovery": { en: "Save the new recovery key", "zh-CN": "保存新的恢复密钥", "zh-TW": "儲存新的復原金鑰" },
  "settings.replacementRecoveryHelp": {
    en: "Save the new recovery key before continuing. The old key will stop working once your username changes.",
    "zh-CN": "请先保存新恢复密钥。用户名修改成功后，旧密钥将失效。",
    "zh-TW": "請先儲存新的復原金鑰。使用者名稱修改成功後，舊金鑰將失效。"
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
  "settings.autoDelete": { en: "Trash retention period", "zh-CN": "回收站保留时间", "zh-TW": "垃圾桶保留時間" },
  "settings.days": { en: "{count} days", "zh-CN": "{count} 天", "zh-TW": "{count} 天" },
  "settings.daysDefault": { en: "{count} days (default)", "zh-CN": "{count} 天（默认）", "zh-TW": "{count} 天（預設）" },
  "settings.keepForever": { en: "Keep indefinitely", "zh-CN": "永久保留", "zh-TW": "永久保留" },
  "settings.deletedItems": { en: "Deleted items", "zh-CN": "已删除项目", "zh-TW": "已刪除項目" },
  "settings.trashSummary": { en: "{roots} top-level items, {total} in total", "zh-CN": "顶层 {roots} 项，共 {total} 项", "zh-TW": "最上層 {roots} 項，共 {total} 項" },
  "settings.trashFilterSummary": { en: "{count} matching items", "zh-CN": "{count} 个匹配项", "zh-TW": "{count} 個符合項目" },
  "settings.clearingTrash": { en: "Clearing…", "zh-CN": "正在清空…", "zh-TW": "正在清空…" },
  "settings.clearTrash": { en: "Clear trash", "zh-CN": "清空回收站", "zh-TW": "清空垃圾桶" },
  "settings.trashEmpty": { en: "Trash is empty", "zh-CN": "回收站为空", "zh-TW": "垃圾桶是空的" },
  "settings.noTrashMatches": { en: "No items match the filters", "zh-CN": "没有符合筛选条件的项目", "zh-TW": "沒有符合篩選條件的項目" },
  "settings.searchTrash": { en: "Search trash", "zh-CN": "搜索回收站", "zh-TW": "搜尋垃圾桶" },
  "settings.trashTypeFilter": { en: "Filter by item type", "zh-CN": "按项目类型筛选", "zh-TW": "依項目類型篩選" },
  "settings.allTypes": { en: "All types", "zh-CN": "全部类型", "zh-TW": "全部類型" },
  "settings.foldersOnly": { en: "Folders", "zh-CN": "文件夹", "zh-TW": "資料夾" },
  "settings.notesOnly": { en: "Notes", "zh-CN": "笔记", "zh-TW": "筆記" },
  "settings.trashSort": { en: "Sort Trash", "zh-CN": "回收站排序", "zh-TW": "垃圾桶排序" },
  "settings.deletedNewest": { en: "Most recently deleted", "zh-CN": "最近删除优先", "zh-TW": "最近刪除優先" },
  "settings.deletedOldest": { en: "Oldest deletions first", "zh-CN": "最早删除优先", "zh-TW": "最早刪除優先" },
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
  "settings.deviceSecurity": { en: "Device security", "zh-CN": "本机安全", "zh-TW": "本機安全" },
  "settings.recoveryKey": { en: "Recovery key", "zh-CN": "恢复密钥", "zh-TW": "復原金鑰" },
  "settings.setPin": { en: "Set PIN", "zh-CN": "设置 PIN", "zh-TW": "設定 PIN" },
  "settings.pinHelp": {
    en: "Set a PIN to unlock your remembered account on this device.",
    "zh-CN": "设置本机 PIN 后，打开此设备上已记住的账户时需解锁。",
    "zh-TW": "設定本機 PIN 後，開啟此裝置上已記住的帳戶時需解鎖。"
  },
  "settings.pinConfiguredHelp": {
    en: "You can unlock Mint Notes on this device with your PIN.",
    "zh-CN": "此设备可使用本机 PIN 解锁。",
    "zh-TW": "此裝置可使用本機 PIN 解鎖。"
  },
  "settings.pinVerificationHelp": {
    en: "Enter your master password and the new PIN.",
    "zh-CN": "请输入当前主密码和新 PIN。",
    "zh-TW": "請輸入目前的主密碼與新 PIN。"
  },
  "settings.removePinHelp": {
    en: "Enter your current master password to remove the device PIN. This also turns off automatic lock.",
    "zh-CN": "请输入当前主密码。移除本机 PIN 后，自动锁定也会关闭。",
    "zh-TW": "請輸入目前的主密碼。移除本機 PIN 後，自動鎖定也會關閉。"
  },
  "settings.newPin": { en: "New PIN", "zh-CN": "新 PIN", "zh-TW": "新 PIN" },
  "settings.pinMin": { en: "At least 4 characters", "zh-CN": "至少 4 个字符", "zh-TW": "至少 4 個字元" },
  "settings.changePin": { en: "Change PIN", "zh-CN": "更改 PIN", "zh-TW": "變更 PIN" },
  "settings.removePin": { en: "Remove PIN", "zh-CN": "移除 PIN", "zh-TW": "移除 PIN" },
  "settings.autoLock": { en: "Automatic locking", "zh-CN": "自动锁定", "zh-TW": "自動鎖定" },
  "settings.autoLockHelp": {
    en: "Set a device PIN to use automatic lock. You can unlock with the PIN or your master password.",
    "zh-CN": "自动锁定需要先设置本机 PIN。锁定后，可用 PIN 或主密码解锁。",
    "zh-TW": "自動鎖定需要先設定本機 PIN。鎖定後，可用 PIN 或主密碼解鎖。"
  },
  "settings.autoLockAfter": { en: "Auto-lock after", "zh-CN": "自动锁定时间", "zh-TW": "自動鎖定時間" },
  "settings.offDefault": { en: "Off (default)", "zh-CN": "关闭（默认）", "zh-TW": "關閉（預設）" },
  "settings.minutes": { en: "{count} minutes", "zh-CN": "{count} 分钟", "zh-TW": "{count} 分鐘" },
  "settings.minute": { en: "1 minute", "zh-CN": "1 分钟", "zh-TW": "1 分鐘" },
  "settings.loginDevices": { en: "Login devices", "zh-CN": "登录设备", "zh-TW": "登入裝置" },
  "settings.loginDevicesHelp": {
    en: "A device must be signed in for 24 hours before it can sign out other devices.",
    "zh-CN": "当前设备登录满 24 小时后，可让其他设备退出登录。",
    "zh-TW": "目前裝置登入滿 24 小時後，可讓其他裝置登出。"
  },
  "settings.inactiveDeviceRetention": {
    en: "Signed-out and expired records are removed after {count} days. You can also remove them manually.",
    "zh-CN": "已退出登录或已过期的设备记录将在 {count} 天后自动移除，也可手动移除。",
    "zh-TW": "已登出或已過期的裝置記錄將在 {count} 天後自動移除，也可手動移除。"
  },
  "settings.loadingDevices": { en: "Loading login devices…", "zh-CN": "正在加载登录设备…", "zh-TW": "正在載入登入裝置…" },
  "settings.revokeAfter": { en: "You can sign out other devices after {date}.", "zh-CN": "{date} 后可让其他设备退出登录。", "zh-TW": "{date} 後可讓其他裝置登出。" },
  "settings.currentDevice": { en: "Current device", "zh-CN": "当前设备", "zh-TW": "目前裝置" },
  "settings.remembered": { en: "Remembered", "zh-CN": "已记住", "zh-TW": "已記住" },
  "settings.lastOnline": { en: "Last online: {date}", "zh-CN": "上次上线：{date}", "zh-TW": "上次上線：{date}" },
  "settings.deviceDetails": {
    en: "First login: {first} · Recent login: {last} · {count} logins · IP {ip} · {status}",
    "zh-CN": "首次登录：{first} · 最近登录：{last} · 共 {count} 次 · IP {ip} · {status}",
    "zh-TW": "首次登入：{first} · 最近登入：{last} · 共 {count} 次 · IP {ip} · {status}"
  },
  "settings.deviceActive": { en: "Active session", "zh-CN": "会话有效", "zh-TW": "工作階段有效" },
  "settings.deviceSignedOut": { en: "Signed out", "zh-CN": "已退出登录", "zh-TW": "已登出" },
  "settings.deviceExpired": { en: "Expired", "zh-CN": "已过期", "zh-TW": "已過期" },
  "settings.signOut": { en: "Sign out device", "zh-CN": "让设备退出登录", "zh-TW": "讓裝置登出" },
  "settings.accountCredentials": { en: "Account credentials", "zh-CN": "账户凭据", "zh-TW": "帳戶憑證" },
  "settings.accountCredentialsHelp": {
    en: "Changing your master password or recovery key requires identity verification.",
    "zh-CN": "修改主密码或重置恢复密钥前需验证身份。",
    "zh-TW": "修改主密碼或重設復原金鑰前需驗證身分。"
  },
  "settings.changePassword": { en: "Change master password", "zh-CN": "修改主密码", "zh-TW": "變更主密碼" },
  "settings.changePasswordHelp": {
    en: "Changing the master password requires other devices to log in again. The recovery key remains valid.",
    "zh-CN": "修改主密码后其他设备需重新登录。恢复密钥仍然有效。",
    "zh-TW": "變更主密碼後其他裝置需重新登入。復原金鑰仍然有效。"
  },
  "settings.recoveryHelp": {
    en: "Use your recovery key to reset a forgotten master password. Resetting the key makes the old one invalid. Save the new key securely.",
    "zh-CN": "忘记主密码时，可用恢复密钥重置。重置恢复密钥会使旧密钥失效，请妥善保存新密钥。",
    "zh-TW": "忘記主密碼時，可用復原金鑰重設。重設復原金鑰會使舊金鑰失效，請妥善儲存新金鑰。"
  },
  "settings.resetRecovery": { en: "Reset recovery key", "zh-CN": "重置恢复密钥", "zh-TW": "重設復原金鑰" },
  "settings.recoveryShownOnce": { en: "The new recovery key is shown only once.", "zh-CN": "新恢复密钥仅显示一次。", "zh-TW": "新的復原金鑰僅顯示一次。" },
  "settings.savedRecovery": { en: "I have saved it", "zh-CN": "我已保存", "zh-TW": "我已儲存" },
  "settings.portableHelp": {
    en: "The ZIP file contains unencrypted Markdown files and attachments. It preserves your folder structure and empty folders. Save it in a secure location.",
    "zh-CN": "ZIP 文件包含未加密的 Markdown 和附件，并保留目录结构及空文件夹。请保存到安全位置。",
    "zh-TW": "ZIP 檔案包含未加密的 Markdown 與附件，並保留目錄結構與空資料夾。請儲存至安全位置。"
  },
  "settings.import": { en: "Import Markdown or ZIP files", "zh-CN": "导入 Markdown 或 ZIP", "zh-TW": "匯入 Markdown 或 ZIP" },
  "settings.export": { en: "Export complete ZIP", "zh-CN": "导出完整 ZIP", "zh-TW": "匯出完整 ZIP" },
  "settings.aboutHelp": {
    en: "Thanks to the following open-source projects.",
    "zh-CN": "感谢以下开源项目。",
    "zh-TW": "感謝以下開源專案。"
  },
  "settings.version": { en: "Version", "zh-CN": "版本", "zh-TW": "版本" },
  "settings.aboutDescription": {
    en: "Mint Notes is a self-hosted Markdown note app for multiple users. It supports offline editing and sync across devices.",
    "zh-CN": "Mint Notes 是可自托管的多用户 Markdown 笔记应用，支持离线编辑和跨设备同步。",
    "zh-TW": "Mint Notes 是可自行架設的多人 Markdown 筆記應用程式，支援離線編輯與跨裝置同步。"
  },
  "settings.acknowledgements": { en: "Acknowledgements", "zh-CN": "致谢", "zh-TW": "致謝" },
  "settings.editorCoreOrigin": { en: "Upstream editor project", "zh-CN": "编辑器上游项目", "zh-TW": "編輯器上游專案" },
  "settings.mathFormulaRendering": { en: "Math rendering", "zh-CN": "数学公式渲染", "zh-TW": "數學公式渲染" },
  "settings.diagramRendering": { en: "Diagram rendering", "zh-CN": "图表渲染", "zh-TW": "圖表渲染" },
  "settings.uiComponentLibrary": { en: "Interface component library", "zh-CN": "界面组件库", "zh-TW": "介面元件庫" },
  "settings.iconLibrary": { en: "Interface icons", "zh-CN": "界面图标", "zh-TW": "介面圖示" },

  "notice.loadDevicesFailed": { en: "Unable to load login devices", "zh-CN": "无法加载登录设备", "zh-TW": "無法載入登入裝置" },
  "notice.loadTrashRetentionFailed": { en: "Unable to load trash retention settings", "zh-CN": "无法加载回收站保留设置", "zh-TW": "無法載入垃圾桶保留設定" },
  "notice.trashForever": { en: "Trash items will be kept forever", "zh-CN": "回收站内容将永久保留", "zh-TW": "垃圾桶內容將永久保留" },
  "notice.trashDeleteAfter": { en: "Items in Trash will be permanently deleted after {count} days.", "zh-CN": "回收站内容将在保留 {count} 天后永久删除。", "zh-TW": "垃圾桶內容將在保留 {count} 天後永久刪除。" },
  "notice.settingRestored": { en: "{message}. Previous setting restored.", "zh-CN": "{message}。已恢复原设置。", "zh-TW": "{message}。已復原原設定。" },
  "notice.saveTrashFailed": { en: "Could not save the Trash setting.", "zh-CN": "无法保存回收站设置", "zh-TW": "無法儲存垃圾桶設定" },
  "notice.displayNameUpdated": { en: "Display name updated", "zh-CN": "显示名称已更新", "zh-TW": "顯示名稱已更新" },
  "notice.displayNameFailed": { en: "Could not update the display name", "zh-CN": "无法更新显示名称", "zh-TW": "無法更新顯示名稱" },
  "notice.usernameUpdated": { en: "Username updated. Use it to sign in again on your other devices.", "zh-CN": "用户名已更新。其他设备需使用新用户名重新登录。", "zh-TW": "使用者名稱已更新。其他裝置需使用新使用者名稱重新登入。" },
  "notice.usernameRecoveryReset": { en: "Username and recovery key updated. Sign in again on your other devices.", "zh-CN": "用户名和恢复密钥已更新。其他设备需使用新用户名重新登录。", "zh-TW": "使用者名稱和復原金鑰已更新。其他裝置需使用新使用者名稱重新登入。" },
  "notice.usernameFailed": { en: "Unable to update username", "zh-CN": "无法更新用户名", "zh-TW": "無法更新使用者名稱" },
  "notice.usernameUnchanged": { en: "Enter a different username", "zh-CN": "请输入不同的用户名", "zh-TW": "請輸入不同的使用者名稱" },
  "notice.avatarUpdated": { en: "Avatar updated", "zh-CN": "头像已更新", "zh-TW": "頭像已更新" },
  "notice.avatarUpdateFailed": { en: "Could not update the profile picture", "zh-CN": "无法更新头像", "zh-TW": "無法更新頭像" },
  "notice.avatarRemoved": { en: "Avatar removed", "zh-CN": "头像已移除", "zh-TW": "頭像已移除" },
  "notice.avatarRemoveFailed": { en: "Unable to remove avatar", "zh-CN": "无法移除头像", "zh-TW": "無法移除頭像" },
  "notice.signOutDeviceConfirm": { en: "Sign out {device}? This device will need to sign in again.", "zh-CN": "要让“{device}”退出登录吗？此设备之后需重新登录。", "zh-TW": "要讓「{device}」登出嗎？此裝置之後需重新登入。" },
  "notice.deviceSignedOut": { en: "Signed out {device}", "zh-CN": "“{device}”已退出登录", "zh-TW": "「{device}」已登出" },
  "notice.deviceSignOutFailed": { en: "Could not sign out the device", "zh-CN": "无法让设备退出登录", "zh-TW": "無法讓裝置登出" },
  "notice.removeDeviceConfirm": { en: "Remove the inactive sign-in record for {device}?", "zh-CN": "要移除“{device}”的失效登录记录吗？", "zh-TW": "要移除「{device}」的失效登入記錄嗎？" },
  "notice.deviceRemoved": { en: "Removed the sign-in record for {device}", "zh-CN": "“{device}”的登录记录已移除", "zh-TW": "「{device}」的登入記錄已移除" },
  "notice.deviceRemoveFailed": { en: "Unable to remove device record", "zh-CN": "移除设备记录失败", "zh-TW": "移除裝置記錄失敗" },
  "notice.pinSaved": { en: "Device PIN saved", "zh-CN": "本机 PIN 已保存", "zh-TW": "本機 PIN 已儲存" },
  "notice.pinSaveFailed": { en: "Unable to save PIN", "zh-CN": "无法保存 PIN", "zh-TW": "無法儲存 PIN" },
  "notice.pinRemoved": { en: "Removing the device PIN also turned off automatic lock.", "zh-CN": "本机 PIN 已移除，自动锁定也已关闭。", "zh-TW": "本機 PIN 已移除，自動鎖定也已關閉。" },
  "notice.pinRemoveFailed": { en: "Unable to remove PIN", "zh-CN": "无法移除 PIN", "zh-TW": "無法移除 PIN" },
  "notice.setPinFirst": { en: "Set a device PIN before enabling automatic lock.", "zh-CN": "请先设置本机 PIN，再开启自动锁定。", "zh-TW": "請先設定本機 PIN，再啟用自動鎖定。" },
  "notice.autoLockEnabled": { en: "Mint Notes will lock after {count} min of inactivity.", "zh-CN": "连续 {count} 分钟无操作后将自动锁定。", "zh-TW": "連續閒置 {count} 分鐘後將自動鎖定。" },
  "notice.autoLockDisabled": { en: "Automatic locking disabled. Device PIN retained.", "zh-CN": "自动锁定已关闭。本机 PIN 已保留。", "zh-TW": "自動鎖定已關閉。本機 PIN 已保留。" },
  "notice.autoLockSaveFailed": { en: "Unable to save automatic locking settings", "zh-CN": "无法保存自动锁定设置", "zh-TW": "無法儲存自動鎖定設定" },
  "notice.passwordChanged": { en: "Master password updated. Other devices must sign in again. Your recovery key still works.", "zh-CN": "主密码已修改。其他设备需重新登录，恢复密钥仍然有效。", "zh-TW": "主密碼已修改。其他裝置需重新登入，復原金鑰仍然有效。" },
  "notice.passwordChangeFailed": { en: "Could not change the master password", "zh-CN": "无法修改主密码", "zh-TW": "無法修改主密碼" },
  "notice.recoveryReset": { en: "Recovery key reset. The old key is no longer valid.", "zh-CN": "恢复密钥已重置。旧密钥已失效。", "zh-TW": "復原金鑰已重設。舊金鑰已失效。" },
  "notice.recoveryResetFailed": { en: "Unable to reset recovery key", "zh-CN": "无法重置恢复密钥", "zh-TW": "無法重設復原金鑰" },
  "notice.itemRestored": { en: "“{title}” restored locally", "zh-CN": "“{title}”已恢复到本地", "zh-TW": "「{title}」已復原至本機" },
  "notice.itemRestoreFailed": { en: "Unable to restore “{title}”", "zh-CN": "无法恢复“{title}”", "zh-TW": "無法復原「{title}」" },

  "admin.description": {
    en: "Create and manage accounts. Administrators cannot read users’ notes.",
    "zh-CN": "创建和管理账户。管理员无法读取用户的笔记。",
    "zh-TW": "建立和管理帳戶。管理員無法讀取使用者的筆記。"
  },
  "admin.userManagement": { en: "User management", "zh-CN": "用户管理", "zh-TW": "使用者管理" },
  "admin.createPending": { en: "Add user", "zh-CN": "新增用户", "zh-TW": "新增使用者" },
  "admin.createPendingHelp": {
    en: "Enter a username and display name. The activation code is valid for 72 hours.",
    "zh-CN": "输入用户名和显示名称以生成激活码。激活码有效期为 72 小时。",
    "zh-TW": "輸入使用者名稱與顯示名稱以產生啟用碼。啟用碼有效期為 72 小時。"
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
    en: "The account, notes, history, attachments and sign-in records will be permanently deleted from the server. This cannot be undone. Separate backups and encrypted browser copies will remain.",
    "zh-CN": "服务器上的账户、笔记、历史版本、附件和登录记录将永久删除。此操作无法撤销。独立备份和浏览器中的本地加密数据仍会保留。",
    "zh-TW": "伺服器上的帳戶、筆記、歷史版本、附件與登入記錄將永久刪除。此操作無法復原。獨立備份與瀏覽器中的本機加密資料仍會保留。"
  },
  "admin.confirmUsername": { en: "Username to confirm deletion", "zh-CN": "输入要删除的用户名", "zh-TW": "輸入要刪除的使用者名稱" },
  "admin.yourPassword": { en: "Your master password", "zh-CN": "当前管理员的主密码", "zh-TW": "目前管理員的主密碼" },
  "admin.cancelActivationConfirm": { en: "Cancel the activation code for @{username}?", "zh-CN": "要撤销 @{username} 的激活码吗？", "zh-TW": "要撤銷 @{username} 的啟用碼嗎？" },
  "admin.loadFailed": { en: "Unable to load administrator settings", "zh-CN": "无法加载管理员设置", "zh-TW": "無法載入管理員設定" },
  "admin.codeCreated": { en: "Activation code created. Save it now.", "zh-CN": "激活码已创建。请立即保存。", "zh-TW": "啟用碼已建立。請立即儲存。" },
  "admin.createFailed": { en: "Unable to create user", "zh-CN": "无法创建用户", "zh-TW": "無法建立使用者" },
  "admin.userEnabled": { en: "{name} enabled", "zh-CN": "{name} 已启用", "zh-TW": "{name} 已啟用" },
  "admin.userDisabled": { en: "{name} disabled", "zh-CN": "{name} 已禁用", "zh-TW": "{name} 已停用" },
  "admin.updateFailed": { en: "Unable to update user status", "zh-CN": "无法更新用户状态", "zh-TW": "無法更新使用者狀態" },
  "admin.activationCancelled": { en: "Activation code for @{username} revoked", "zh-CN": "已撤销 @{username} 的激活码", "zh-TW": "已撤銷 @{username} 的啟用碼" },
  "admin.cancelFailed": { en: "Could not revoke the activation code", "zh-CN": "无法撤销激活码", "zh-TW": "無法撤銷啟用碼" },
  "admin.userDeleted": { en: "@{username} permanently deleted", "zh-CN": "@{username} 已永久删除", "zh-TW": "@{username} 已永久刪除" },
  "admin.deleteFailed": { en: "Unable to delete user", "zh-CN": "无法删除用户", "zh-TW": "無法刪除使用者" },

  "app.save.saving": { en: "Saving locally…", "zh-CN": "正在保存到本地…", "zh-TW": "正在儲存到本機…" },
  "app.save.local": { en: "Saved locally · pending sync", "zh-CN": "已保存到本地 · 等待同步", "zh-TW": "已儲存至本機 · 等待同步" },
  "app.save.pending": { en: "Waiting to sync", "zh-CN": "等待同步", "zh-TW": "等待同步" },
  "app.save.syncing": { en: "Syncing…", "zh-CN": "正在同步…", "zh-TW": "正在同步…" },
  "app.save.synced": { en: "Synced", "zh-CN": "已同步", "zh-TW": "已同步" },
  "app.save.offline": { en: "Offline", "zh-CN": "离线", "zh-TW": "離線" },
  "app.save.unverified": { en: "Sign-in not verified", "zh-CN": "登录状态尚未验证", "zh-TW": "登入狀態尚未驗證" },
  "app.save.unverifiedDetail": {
    en: "Sync will start once sign-in status is verified. Verification retries automatically.",
    "zh-CN": "登录状态尚未验证。系统将自动重试验证，验证后即可同步。",
    "zh-TW": "登入狀態尚未驗證。系統將自動重試驗證，驗證後即可同步。"
  },
  "app.save.error": { en: "Sync failed", "zh-CN": "同步失败", "zh-TW": "同步失敗" },
  "app.save.syncingDetail": { en: "Synchronizing with the server…", "zh-CN": "正在与服务器同步…", "zh-TW": "正在與伺服器同步…" },
  "app.save.offlineDetail": {
    en: "Offline. Saved changes will sync when you reconnect.",
    "zh-CN": "当前离线。已保存的修改将在联网后同步。",
    "zh-TW": "目前離線。已儲存的變更將在連網後同步。"
  },
  "app.save.unreachableDetail": {
    en: "Sync is temporarily unavailable. Saved changes remain on this device. Sync will retry automatically.",
    "zh-CN": "暂时无法同步。已保存的修改仍在本地，系统将自动重试。",
    "zh-TW": "暫時無法同步。已儲存的變更仍在本機，系統將自動重試。"
  },
  "app.save.serverErrorDetail": {
    en: "{reason}. Saved changes remain on this device. Sync will retry automatically.",
    "zh-CN": "{reason}。已保存的修改仍在本地，系统将自动重试。",
    "zh-TW": "{reason}。已儲存的變更仍在本機，系統將自動重試。"
  },
  "app.save.localFailureDetail": {
    en: "Could not save the latest changes to this device. Keep this page open and copy your changes as a backup.",
    "zh-CN": "最新修改尚未保存到本地。请保留此页面，并复制修改内容作为备份。",
    "zh-TW": "最新變更尚未儲存至本機。請保持此頁面開啟，並複製變更內容作為備份。"
  },
  "app.loadingNotes": { en: "Loading local notes…", "zh-CN": "正在加载本地笔记…", "zh-TW": "正在載入本機筆記…" },
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
  "app.notifications": { en: "Notifications", "zh-CN": "通知", "zh-TW": "通知" },
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
  "app.sortCreated": { en: "Created", "zh-CN": "创建时间", "zh-TW": "建立時間" },
  "app.sortUpdated": { en: "Last modified", "zh-CN": "修改时间", "zh-TW": "修改時間" },
  "app.sortManual": { en: "Manual", "zh-CN": "手动", "zh-TW": "手動" },
  "app.noMatches": { en: "No matching notes", "zh-CN": "没有匹配的笔记", "zh-TW": "沒有相符的筆記" },
  "app.lock": { en: "Lock", "zh-CN": "锁定", "zh-TW": "鎖定" },
  "app.lockNote": { en: "Lock note", "zh-CN": "锁定笔记", "zh-TW": "鎖定筆記" },
  "app.unlockNote": { en: "Unlock note", "zh-CN": "解锁笔记", "zh-TW": "解鎖筆記" },
  "app.unlockToEdit": { en: "Unlock this note to edit", "zh-CN": "解锁笔记后可编辑", "zh-TW": "解鎖筆記後可編輯" },
  "app.noteLockedBadge": { en: "Locked note", "zh-CN": "已锁定笔记", "zh-TW": "已鎖定筆記" },
  "app.logout": { en: "Sign out", "zh-CN": "退出登录", "zh-TW": "登出" },
  "app.resizeLeft": { en: "Resize left sidebar", "zh-CN": "调整左侧栏宽度", "zh-TW": "調整左側欄寬度" },
  "app.openLeft": { en: "Open left sidebar", "zh-CN": "打开左侧栏", "zh-TW": "開啟左側欄" },
  "app.noteTitle": { en: "Note title", "zh-CN": "笔记标题", "zh-TW": "筆記標題" },
  "app.selectNote": { en: "Select a note", "zh-CN": "选择一篇笔记", "zh-TW": "選擇一篇筆記" },
  "app.editorMode": { en: "Editor mode", "zh-CN": "编辑模式", "zh-TW": "編輯模式" },
  "app.modeLive": { en: "Live", "zh-CN": "实时", "zh-TW": "即時" },
  "app.modeSource": { en: "Source", "zh-CN": "源码", "zh-TW": "原始碼" },
  "app.modeReading": { en: "Read-only", "zh-CN": "只读", "zh-TW": "唯讀" },
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
  "app.outlineEmpty": { en: "Add Markdown headings to show them here.", "zh-CN": "添加 Markdown 标题后即可查看大纲。", "zh-TW": "新增 Markdown 標題後即可查看大綱。" },
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
  "app.moveToTrash": { en: "Move to Trash", "zh-CN": "移到回收站", "zh-TW": "移到垃圾桶" },
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
    en: "Could not read the YAML properties. The original text was kept.",
    "zh-CN": "无法读取 YAML 属性。原文已保留。",
    "zh-TW": "無法讀取 YAML 屬性。原文已保留。"
  },
  "properties.sourceHint": {
    en: "Switch to source mode to edit the original YAML.",
    "zh-CN": "请切换到源码模式编辑原始 YAML。",
    "zh-TW": "請切換至原始碼模式編輯原始 YAML。"
  },
  "properties.complexValue": { en: "Structured YAML value", "zh-CN": "结构化 YAML 值", "zh-TW": "結構化 YAML 值" },
  "properties.complexHint": {
    en: "Edit this structured value in source mode.",
    "zh-CN": "请在源码模式中编辑此结构化值。",
    "zh-TW": "請在原始碼模式中編輯此結構化值。"
  },
  "app.attachmentNotLoaded": { en: "Attachment not loaded: {name}", "zh-CN": "附件“{name}”尚未加载", "zh-TW": "附件「{name}」尚未載入" },

  "notice.attachmentConflict": { en: "Could not save the conflict copy with its attachments. The local changes are still available for recovery.", "zh-CN": "无法保存包含附件的冲突副本。本地修改仍可恢复。", "zh-TW": "無法儲存含附件的衝突副本。本機變更仍可復原。" },
  "notice.documentConflict": { en: "“{title}” has a sync conflict. Your local changes were saved as a conflict copy.", "zh-CN": "“{title}”存在同步冲突。本地修改已保存为冲突副本。", "zh-TW": "「{title}」發生同步衝突。本機變更已儲存為衝突副本。" },
  "notice.activeRemoteDeleted": { en: "This note was deleted elsewhere. The deletion will appear when you leave the note.", "zh-CN": "此笔记已在其他设备上删除。离开笔记后，列表将更新。", "zh-TW": "此筆記已在其他裝置上刪除。離開筆記後，清單將更新。" },
  "notice.activeRemoteUpdated": { en: "This note was edited elsewhere. The server version will load when you leave the note.", "zh-CN": "此笔记已在其他设备上修改。离开笔记后将加载服务器版本。", "zh-TW": "此筆記已在其他裝置上修改。離開筆記後將載入伺服器版本。" },
  "notice.remoteIntegrity": { en: "Could not verify {count} items from the server. Readable local versions were kept.", "zh-CN": "服务器上的 {count} 项数据未通过校验。已保留本地可读取的版本。", "zh-TW": "伺服器上的 {count} 項資料未通過驗證。已保留本機可讀取的版本。" },
  "notice.syncFailed": { en: "Sync failed. Saved changes remain on this device. Sync will retry automatically.", "zh-CN": "同步失败。已保存的修改仍在本地，系统将自动重试。", "zh-TW": "同步失敗。已儲存的變更仍在本機，系統將自動重試。" },
  "notice.localSaveFailed": {
    en: "Could not save the latest changes to this device. Keep this page open and copy your changes as a backup.",
    "zh-CN": "最新修改尚未保存到本地。请保留此页面，并复制修改内容作为备份。",
    "zh-TW": "最新變更尚未儲存至本機。請保持此頁面開啟，並複製變更內容作為備份。"
  },
  "notice.localDecryptFailed": { en: "Could not load {count} encrypted items from this device. {detail}", "zh-CN": "无法加载 {count} 项本地加密数据。{detail}", "zh-TW": "無法載入 {count} 項本機加密資料。{detail}" },
  "notice.pendingDecryptFailed": { en: "{count} of these items contain unsynced changes. The encrypted data was kept.", "zh-CN": "其中 {count} 项包含未同步的修改。原始加密数据已保留。", "zh-TW": "其中 {count} 項含有未同步的變更。原始加密資料已保留。" },
  "notice.ciphertextRetained": { en: "The original encrypted data has been retained.", "zh-CN": "原始加密数据已保留。", "zh-TW": "原始加密資料已保留。" },
  "notice.ignoreRevision": { en: "Do not show this version again", "zh-CN": "不再提示此版本", "zh-TW": "不再提示此版本" },
  "notice.remoteIntegrityOthers": { en: "Could not verify {count} items from the server. Readable local versions were kept.", "zh-CN": "服务器上的 {count} 项数据未通过校验。已保留本地可读取的版本。", "zh-TW": "伺服器上的 {count} 項資料未通過驗證。已保留本機可讀取的版本。" },
  "notice.loadedOffline": { en: "Local notes loaded. Sync will resume when you reconnect.", "zh-CN": "已加载本地笔记。重新联网后将自动同步。", "zh-TW": "已載入本機筆記。重新連網後將自動同步。" },
  "notice.onlineSessionRequired": {
    en: "Connect to the server and verify your sign-in to continue.",
    "zh-CN": "连接服务器并完成登录验证后可继续。",
    "zh-TW": "連線至伺服器並完成登入驗證後即可繼續。"
  },
  "notice.openDatabaseFailed": { en: "Could not read local notes", "zh-CN": "无法读取本地笔记", "zh-TW": "無法讀取本機筆記" },
  "notice.logoutLocalClearFailed": { en: "Could not clear local account data. You are still signed in.", "zh-CN": "无法清除本地账户数据。当前账户仍处于登录状态。", "zh-TW": "無法清除本機帳戶資料。目前帳戶仍處於登入狀態。" },
  "notice.attachmentLoadFailed": { en: "Unable to load attachment", "zh-CN": "附件加载失败", "zh-TW": "附件載入失敗" },
  "notice.attachmentSaveFailed": { en: "Unable to save attachment", "zh-CN": "附件保存失败", "zh-TW": "附件儲存失敗" },
  "notice.restoreNameConflict": { en: "Could not restore the item. An item named “{title}” already exists in the destination folder.", "zh-CN": "无法恢复。目标文件夹中已存在同名项目“{title}”。", "zh-TW": "無法復原。目的地資料夾中已存在同名項目「{title}」。" },
  "notice.wikiLinkNotFound": { en: "Could not find the note linked as “{target}”", "zh-CN": "找不到“{target}”指向的笔记", "zh-TW": "找不到「{target}」指向的筆記" },
  "notice.purgeSingleLabel": { en: "“{title}”", "zh-CN": "“{title}”", "zh-TW": "「{title}」" },
  "notice.purgeMultipleLabel": { en: "the {count} selected items", "zh-CN": "所选的 {count} 个项目", "zh-TW": "所選的 {count} 個項目" },
  "notice.purgeConfirm": { en: "Permanently delete {label}? This also deletes their contents, attachments and all history, including protected versions. This cannot be undone.", "zh-CN": "要永久删除{label}吗？其中的子项目、附件及所有历史版本均会删除，包括受保护的版本。此操作无法撤销。", "zh-TW": "要永久刪除{label}嗎？其中的子項目、附件及所有歷史版本均會刪除，包括受保護的版本。此操作無法復原。" },
  "notice.clearTrashConfirm": { en: "Permanently delete everything in Trash? Attachments and all history, including protected versions, will also be deleted. This cannot be undone.", "zh-CN": "要永久删除回收站中的全部内容吗？附件及所有历史版本也会删除，包括受保护的版本。此操作无法撤销。", "zh-TW": "要永久刪除垃圾桶中的全部內容嗎？附件及所有歷史版本也會刪除，包括受保護的版本。此操作無法復原。" },
  "notice.purgeOnlineOnly": { en: "Reconnect to permanently delete items from Trash.", "zh-CN": "重新联网后才能永久删除回收站中的项目。", "zh-TW": "重新連網後才能永久刪除垃圾桶中的項目。" },
  "notice.purgeWaitSync": { en: "Wait for the selected items to sync before permanently deleting them.", "zh-CN": "请等待所选项目同步完成，再永久删除。", "zh-TW": "請等待所選項目同步完成，再永久刪除。" },
  "notice.purgeTargetsChanged": { en: "Trash contents changed. Review the items and confirm permanent deletion again.", "zh-CN": "回收站内容已变化。请重新确认要永久删除的项目。", "zh-TW": "資源回收筒內容已變更。請重新確認要永久刪除的項目。" },
  "notice.purgeComplete": { en: "Selected items permanently deleted", "zh-CN": "所选项目已永久删除", "zh-TW": "所選項目已永久刪除" },
  "notice.purgeFailed": { en: "Permanent deletion failed", "zh-CN": "永久删除失败", "zh-TW": "永久刪除失敗" },
  "notice.moveIntoDescendant": { en: "A folder cannot be moved into itself or a subfolder.", "zh-CN": "文件夹不能移入自身或其子文件夹。", "zh-TW": "資料夾不能移入自身或其子資料夾。" },
  "notice.moveNameConflict": { en: "Could not move the item. An item named “{title}” already exists in the destination folder.", "zh-CN": "无法移动。目标文件夹中已存在同名项目“{title}”。", "zh-TW": "無法移動。目的地資料夾中已存在同名項目「{title}」。" },
  "notice.batchMoveIntoDescendant": { en: "Selected folders cannot be moved into themselves or their subfolders.", "zh-CN": "所选文件夹不能移入自身或其子文件夹。", "zh-TW": "所選資料夾不能移入自身或其子資料夾。" },
  "notice.batchMoveNameConflict": { en: "Could not move the selection. The destination would contain duplicate items named “{title}”.", "zh-CN": "无法移动所选项目。移动后会出现同名项目“{title}”。", "zh-TW": "無法移動所選項目。移動後會出現同名項目「{title}」。" },
  "notice.encryptingAttachment": { en: "Encrypting “{name}”…", "zh-CN": "正在加密“{name}”…", "zh-TW": "正在加密「{name}」…" },
  "notice.attachmentSaved": { en: "“{name}” saved locally. Waiting to sync.", "zh-CN": "附件“{name}”已保存到本地，等待同步。", "zh-TW": "附件「{name}」已儲存至本機，等待同步。" },
  "notice.noteLocked": { en: "“{title}” locked", "zh-CN": "已锁定“{title}”", "zh-TW": "已鎖定「{title}」" },
  "notice.noteUnlocked": { en: "“{title}” unlocked", "zh-CN": "已解锁“{title}”", "zh-TW": "已解鎖「{title}」" },
  "notice.noteLockedEdit": { en: "Unlock “{title}” to edit", "zh-CN": "解锁“{title}”后可编辑", "zh-TW": "解鎖「{title}」後可編輯" },
  "notice.noteLockFailed": { en: "Could not change the note’s lock status", "zh-CN": "无法更改笔记的锁定状态", "zh-TW": "無法變更筆記的鎖定狀態" },
  "notice.lockedTrashBlocked": { en: "Unlock “{title}” before moving the selection to Trash.", "zh-CN": "请先解锁“{title}”，再将所选内容移到回收站。", "zh-TW": "請先解鎖「{title}」，再將所選內容移到垃圾桶。" },
  "notice.copiesCreated": { en: "Created {count} copies", "zh-CN": "已创建 {count} 个副本", "zh-TW": "已建立 {count} 個副本" },
  "notice.nameRequired": { en: "Enter a name", "zh-CN": "请输入名称", "zh-TW": "請輸入名稱" },
  "notice.renameConflict": { en: "An item named “{title}” already exists in this folder.", "zh-CN": "此文件夹中已有同名项目“{title}”。", "zh-TW": "此資料夾中已有同名項目「{title}」。" },
  "notice.allNotes": { en: "all notes", "zh-CN": "全部笔记", "zh-TW": "全部筆記" },
  "notice.exportConfirm": { en: "Export {label}? The exported files are unencrypted. Save them in a secure location.", "zh-CN": "要导出{label}吗？导出文件未加密，请保存到安全位置。", "zh-TW": "要匯出{label}嗎？匯出檔案未加密，請儲存至安全位置。" },
  "notice.exportSelectionConfirm": { en: "Export the {count} selected items? The exported files are unencrypted. Save them in a secure location.", "zh-CN": "要导出所选的 {count} 个项目吗？导出文件未加密，请保存到安全位置。", "zh-TW": "要匯出所選的 {count} 個項目嗎？匯出檔案未加密，請儲存至安全位置。" },
  "transfer.progress": { en: "Saving imported items ({completed} of {total})…", "zh-CN": "正在保存导入项目，已完成 {completed} 项，共 {total} 项…", "zh-TW": "正在儲存匯入項目，已完成 {completed} 項，共 {total} 項…" },
  "transfer.namesRepaired": {"en": "Added numbers to {count} duplicate names. All affected items were kept.", "zh-CN": "已为 {count} 个同名项目编号，相关项目均已保留。", "zh-TW": "已為 {count} 個同名項目編號，相關項目均已保留。"},
  "transfer.completedWithIssues": {"en": "Notes imported: {count}. Review the warnings and unfinished items.", "zh-CN": "已导入 {count} 篇笔记。请查看导入警告及未完成的项目。", "zh-TW": "已匯入 {count} 篇筆記。請查看匯入警告及未完成的項目。"},
  "transfer.exportFailed": {"en": "Export failed. Ensure all notes and attachments are readable before retrying.", "zh-CN": "导出失败。请确认笔记及全部附件可读取后重试。", "zh-TW": "匯出失敗。請確認筆記及全部附件可讀取後重試。"},
  "transfer.resultTitle": {"en": "Import results", "zh-CN": "导入结果", "zh-TW": "匯入結果"},
  "transfer.summary": {"en": "Imported {notes} notes and {folders} folders. There are {warnings} warnings and {pending} unfinished items.", "zh-CN": "已导入 {notes} 篇笔记和 {folders} 个文件夹。共有 {warnings} 条警告，另有 {pending} 项未完成。", "zh-TW": "已匯入 {notes} 篇筆記與 {folders} 個資料夾。共有 {warnings} 則警告，另有 {pending} 項未完成。"},
  "transfer.renamed": {"en": "Renamed items ({count})", "zh-CN": "自动改名（{count}）", "zh-TW": "自動改名（{count}）"},
  "transfer.source": {"en": "Source", "zh-CN": "来源", "zh-TW": "來源"},
  "transfer.originalName": {"en": "Original name", "zh-CN": "原名称", "zh-TW": "原名稱"},
  "transfer.finalName": {"en": "Imported name", "zh-CN": "导入名称", "zh-TW": "匯入名稱"},
  "transfer.warnings": {"en": "Warnings ({count}). Original references kept.", "zh-CN": "{count} 条警告，相关引用已保留", "zh-TW": "{count} 則警告，相關引用已保留"},
  "transfer.pending": {"en": "Unfinished items ({count})", "zh-CN": "未完成项目（{count}）", "zh-TW": "未完成項目（{count}）"},
  "transfer.issue.unsafePath": {"en": "Unsafe archive path. No files were imported.", "zh-CN": "归档包含不安全路径。未导入任何文件。", "zh-TW": "封存檔包含不安全路徑。未匯入任何檔案。"},
  "transfer.issue.archiveInvalid": {"en": "Could not read the archive. It may be damaged, encrypted or in an unsupported format.", "zh-CN": "无法读取压缩包。文件可能已损坏、已加密或格式不受支持。", "zh-TW": "無法讀取壓縮檔。檔案可能已損壞、已加密或格式不受支援。"},
  "transfer.issue.fileLimit": {"en": "An import can contain at most 4,000 files.", "zh-CN": "每次最多导入 4,000 个文件。", "zh-TW": "每次最多匯入 4,000 個檔案。"},
  "transfer.issue.manifestInvalid": {"en": "Could not read the contents list in the archive.", "zh-CN": "无法读取压缩包中的内容清单。", "zh-TW": "無法讀取壓縮檔中的內容清單。"},
  "transfer.issue.missingImage": {"en": "Image not found in the imported files.", "zh-CN": "导入文件中未找到该图片。", "zh-TW": "匯入檔案中未找到該圖片。"},
  "transfer.issue.ambiguousImage": {"en": "This image reference matches more than one file in the archive.", "zh-CN": "压缩包中有多个文件与此图片引用匹配。", "zh-TW": "壓縮檔中有多個檔案與此圖片引用相符。"},
  "transfer.issue.invalidImage": {"en": "The file is empty or is not a supported raster image.", "zh-CN": "文件为空或不是支持的栅格图片。", "zh-TW": "檔案為空或不是支援的點陣圖片。"},
  "transfer.issue.largeImage": {"en": "The image exceeds the 25 MiB attachment limit.", "zh-CN": "图片超过 25 MiB 附件限制。", "zh-TW": "圖片超過 25 MiB 附件限制。"},
  "transfer.issue.invalidUrl": {"en": "The image path cannot be decoded or leaves the archive.", "zh-CN": "图片路径无法解码或超出归档范围。", "zh-TW": "圖片路徑無法解碼或超出封存檔範圍。"},
  "transfer.issue.unmappedImage": {"en": "Could not update this image reference. The original reference was kept.", "zh-CN": "无法更新此图片引用。原引用已保留。", "zh-TW": "無法更新此圖片引用。原引用已保留。"},
  "transfer.issue.writeFailed": {"en": "Import stopped while saving. Completed items were kept. Retry the unfinished items.", "zh-CN": "导入在保存时中断。已完成的项目保留，可重试未完成的项目。", "zh-TW": "匯入在儲存時中斷。已完成的項目保留，可重試未完成的項目。"},
  "transfer.issue.cancelled": {"en": "Import was cancelled.", "zh-CN": "导入已取消。", "zh-TW": "匯入已取消。"},
  "notice.importing": { en: "Preparing files for import…", "zh-CN": "正在准备导入文件…", "zh-TW": "正在準備匯入檔案…" },
  "notice.imported": { en: "Notes imported and saved on this device: {count}", "zh-CN": "已导入 {count} 篇笔记并保存到本地", "zh-TW": "已匯入 {count} 篇筆記並儲存至本機" },
  "notice.importFailed": { en: "Import failed", "zh-CN": "导入失败", "zh-TW": "匯入失敗" },
  "notice.configurePin": { en: "Set a device PIN under User and security first.", "zh-CN": "请先在“用户和安全”中设置本机 PIN。", "zh-TW": "請先在「使用者與安全性」中設定本機 PIN。" },

  "history.title": { en: "History", "zh-CN": "历史", "zh-TW": "歷史" },
  "history.list": { en: "Note history", "zh-CN": "笔记历史", "zh-TW": "筆記歷史" },
  "history.saveNow": { en: "Save history version", "zh-CN": "保存历史版本", "zh-TW": "儲存歷史版本" },
  "history.clearNote": { en: "Clear history", "zh-CN": "清空历史", "zh-TW": "清空歷史" },
  "history.empty": { en: "No history saved for this note.", "zh-CN": "此笔记暂无历史版本。", "zh-TW": "此筆記暫無歷史版本。" },
  "history.loading": { en: "Loading history…", "zh-CN": "正在加载历史…", "zh-TW": "正在載入歷史…" },
  "history.loadMore": { en: "Load older versions", "zh-CN": "加载更早版本", "zh-TW": "載入更早版本" },
  "history.pending": { en: "Waiting to sync", "zh-CN": "等待同步", "zh-TW": "等待同步" },
  "history.openMenu": { en: "History actions", "zh-CN": "历史版本操作", "zh-TW": "歷史版本操作" },
  "history.rename": { en: "Rename", "zh-CN": "重命名", "zh-TW": "重新命名" },
  "history.protect": { en: "Protect", "zh-CN": "保护", "zh-TW": "保護" },
  "history.unprotect": { en: "Remove protection", "zh-CN": "取消保护", "zh-TW": "取消保護" },
  "history.protectedBadge": { en: "Protected history", "zh-CN": "受保护的历史版本", "zh-TW": "受保護的歷史版本" },
  "history.protectedDeleteHint": { en: "Remove protection before deleting this version", "zh-CN": "取消保护后可删除此版本", "zh-TW": "取消保護後可刪除此版本" },
  "history.kindBaseline": { en: "Before editing", "zh-CN": "编辑前", "zh-TW": "編輯前" },
  "history.kindInterval": { en: "Saved automatically", "zh-CN": "自动保存", "zh-TW": "自動儲存" },
  "history.kindIdle": { en: "End of editing", "zh-CN": "编辑结束", "zh-TW": "編輯結束" },
  "history.kindManual": { en: "Saved manually", "zh-CN": "手动保存", "zh-TW": "手動儲存" },
  "history.kindRestoreSafety": { en: "Before restoring", "zh-CN": "恢复前", "zh-TW": "復原前" },
  "history.deleteOne": { en: "Delete this version", "zh-CN": "删除此版本", "zh-TW": "刪除此版本" },
  "history.deleteConfirm": { en: "Permanently delete the history version from {date}? This cannot be undone.", "zh-CN": "要永久删除 {date} 的历史版本吗？此操作无法撤销。", "zh-TW": "要永久刪除 {date} 的歷史版本嗎？此操作無法復原。" },
  "history.clearNoteConfirm": { en: "Permanently delete the unprotected history versions of “{title}”? Protected versions will be kept.", "zh-CN": "要永久删除“{title}”中未受保护的历史版本吗？受保护的版本将保留。", "zh-TW": "要永久刪除「{title}」中未受保護的歷史版本嗎？受保護的版本將保留。" },
  "history.clearAllConfirm": { en: "Permanently delete all unprotected history versions in this account? Protected versions will be kept.", "zh-CN": "要永久删除此账户中所有未受保护的历史版本吗？受保护的版本将保留。", "zh-TW": "要永久刪除目前帳戶中所有未受保護的歷史版本嗎？受保護的版本將保留。" },
  "history.preview": { en: "Historical preview", "zh-CN": "历史版本预览", "zh-TW": "歷史版本預覽" },
  "history.exitPreview": { en: "Exit preview", "zh-CN": "退出预览", "zh-TW": "退出預覽" },
  "history.restoreCopy": { en: "Restore as copy", "zh-CN": "恢复为副本", "zh-TW": "復原為副本" },
  "history.restoreCurrent": { en: "Restore current note", "zh-CN": "恢复为当前版本", "zh-TW": "復原為目前版本" },
  "history.restoreMissingAttachments": { en: "{count} referenced attachments are unavailable. Restore the text only?", "zh-CN": "有 {count} 个引用的附件不可用。要仅恢复正文吗？", "zh-TW": "有 {count} 個引用的附件無法取得。要僅復原正文嗎？" },
  "history.copyMissingAttachment": { en: "Could not restore the copy because attachment {attachment} is unavailable.", "zh-CN": "附件“{attachment}”不可用，无法恢复为副本。", "zh-TW": "附件「{attachment}」無法取得，因此無法復原為副本。" },
  "history.restoredCopyTitle": { en: "{title} (restored {date})", "zh-CN": "{title}（恢复副本 {date}）", "zh-TW": "{title}（復原副本 {date}）" },
  "history.unsupported": { en: "Unsupported history format.", "zh-CN": "不支持此历史版本格式。", "zh-TW": "不支援此歷史版本格式。" },

  "settings.history": { en: "Note history", "zh-CN": "笔记历史", "zh-TW": "筆記歷史" },
  "settings.historyHelp": { en: "History versions are encrypted in your browser, saved locally and synced across devices.", "zh-CN": "历史版本在浏览器中加密并保存到本地，随后同步到其他设备。", "zh-TW": "歷史版本在瀏覽器中加密並儲存至本機，隨後同步至其他裝置。" },
  "settings.historyAutomatic": { en: "Automatic history", "zh-CN": "自动保存历史", "zh-TW": "自動儲存歷史" },
  "settings.historyFrequency": { en: "Auto-save interval while editing", "zh-CN": "持续编辑时的自动保存间隔", "zh-TW": "持續編輯時的自動儲存間隔" },
  "settings.historyRetention": { en: "Keep history for", "zh-CN": "历史保留时间", "zh-TW": "歷史保留時間" },
  "settings.historyTiered": { en: "All automatic versions are kept for 24 hours, then one per hour through day 7 and one per day after that. Storage limits apply. Manual and protected versions are kept. Retention pauses while a note is in Trash.", "zh-CN": "自动保存的版本在 24 小时内全部保留，第 2 至第 7 天每小时保留一份，之后每天保留一份，并受容量限制。手动保存和受保护的版本继续保留。笔记在回收站期间暂停清理历史。", "zh-TW": "自動儲存的版本在 24 小時內全部保留，第 2 至第 7 天每小時保留一份，之後每天保留一份，並受容量限制。手動儲存與受保護的版本繼續保留。筆記在垃圾桶期間暫停清理歷史。" },
  "settings.historyStorage": { en: "Note history usage", "zh-CN": "笔记历史占用", "zh-TW": "筆記歷史用量" },
  "settings.historyVersionCount": { en: "{count} versions", "zh-CN": "{count} 个版本", "zh-TW": "{count} 個版本" },
  "settings.historyClearAll": { en: "Clear all history", "zh-CN": "清空全部历史", "zh-TW": "清空全部歷史" },

  "notice.historySaved": { en: "History version saved locally", "zh-CN": "历史版本已保存到本地", "zh-TW": "歷史版本已儲存至本機" },
  "notice.historyUnchanged": { en: "No changes since the latest history version", "zh-CN": "与最新历史版本相同", "zh-TW": "與最新歷史版本相同" },
  "notice.historySaveFailed": { en: "Unable to save note history", "zh-CN": "无法保存笔记历史", "zh-TW": "無法儲存筆記歷史" },
  "notice.historyLoadFailed": { en: "Could not load history from the server. Only local versions are shown.", "zh-CN": "无法加载服务器上的历史。当前显示本地可用的版本。", "zh-TW": "無法載入伺服器上的歷史。目前顯示本機可用的版本。" },
  "notice.historyDecryptFailed": { en: "Unable to read this history version. Try viewing another version.", "zh-CN": "无法读取此历史版本。可尝试查看其他版本。", "zh-TW": "無法讀取此歷史版本。可嘗試查看其他版本。" },
  "notice.historyDeleteOnlineOnly": { en: "History deletion requires an internet connection.", "zh-CN": "删除历史记录需要联网。", "zh-TW": "刪除歷史記錄需要連線。" },
  "notice.historyDeleted": { en: "History version deleted", "zh-CN": "历史版本已删除", "zh-TW": "歷史版本已刪除" },
  "notice.historyDeleteFailed": { en: "Unable to delete the history version", "zh-CN": "无法删除历史版本", "zh-TW": "無法刪除歷史版本" },
  "notice.historyCleared": { en: "History cleared for this note", "zh-CN": "此笔记的历史已清空", "zh-TW": "此筆記的歷史已清空" },
  "notice.historyAllCleared": { en: "All note history cleared", "zh-CN": "全部笔记历史已清空", "zh-TW": "全部筆記歷史已清空" },
  "notice.historyClearFailed": { en: "Unable to clear note history", "zh-CN": "无法清空笔记历史", "zh-TW": "無法清空筆記歷史" },
  "notice.historyRestored": { en: "The note was restored to the selected version.", "zh-CN": "笔记已恢复为所选版本", "zh-TW": "筆記已復原為所選版本" },
  "notice.historyRestoreFailed": { en: "Unable to restore this history version", "zh-CN": "无法恢复此历史版本", "zh-TW": "無法復原此歷史版本" },
  "notice.historyCopyRestored": { en: "History version restored as a new note", "zh-CN": "历史版本已恢复为新笔记", "zh-TW": "歷史版本已復原為新筆記" },
  "notice.historyCopyFailed": { en: "Unable to restore the history version as a copy", "zh-CN": "无法将历史版本恢复为副本", "zh-TW": "無法將歷史版本復原為副本" },
  "notice.historyQuotaReached": { en: "The history quota has been reached. Automatic history saves will resume when space is available.", "zh-CN": "历史用量已达配额。释放空间后将恢复自动保存历史。", "zh-TW": "歷史用量已達配額。釋出空間後將恢復自動儲存歷史。" },
  "notice.historySettingsSaved": { en: "Note history settings saved", "zh-CN": "笔记历史设置已保存", "zh-TW": "筆記歷史設定已儲存" },
  "notice.historySettingsLoadFailed": { en: "Unable to load note history settings", "zh-CN": "无法加载笔记历史设置", "zh-TW": "無法載入筆記歷史設定" },
  "notice.historySettingsSaveFailed": { en: "Unable to save note history settings", "zh-CN": "无法保存笔记历史设置", "zh-TW": "無法儲存筆記歷史設定" },
  "notice.historyNameRequired": { en: "Enter a name for this history version", "zh-CN": "请输入历史版本名称", "zh-TW": "請輸入歷史版本名稱" },
  "notice.historyUpdateFailed": { en: "Unable to update the history version", "zh-CN": "无法更新历史版本", "zh-TW": "無法更新歷史版本" },
  "notice.historyProtected": { en: "History version protected", "zh-CN": "已保护此历史版本", "zh-TW": "已保護此歷史版本" },
  "notice.historyUnprotected": { en: "Protection removed from this version", "zh-CN": "已取消此历史版本的保护", "zh-TW": "已取消此歷史版本的保護" },
  "notice.historyProtectedDeleteBlocked": { en: "Remove protection before deleting this history version.", "zh-CN": "取消保护后可删除此历史版本。", "zh-TW": "取消保護後可刪除此歷史版本。" },
  "notice.historyProtectionSyncRequired": { en: "Wait for the protection changes to sync before clearing history.", "zh-CN": "请等待保护状态同步完成，再清空历史。", "zh-TW": "請等待保護狀態同步完成，再清空歷史。" },
  "notice.historyProtectedMissingAttachments": { en: "Could not protect this version because {count} referenced attachments are unavailable.", "zh-CN": "此历史版本引用的 {count} 个附件不可用，无法保护此版本。", "zh-TW": "此歷史版本引用的 {count} 個附件無法取得，因此無法保護此版本。" },

  "error.pinMin": { en: "The PIN must contain at least 4 characters", "zh-CN": "PIN 至少需要 4 个字符", "zh-TW": "PIN 至少需要 4 個字元" },
  "error.deviceCredentialMissing": { en: "No local unlock credential is available for this device", "zh-CN": "当前设备无可用的本机解锁凭据", "zh-TW": "目前裝置無可用的本機解鎖憑證" },
  "error.autoLockUnsupported": { en: "Unsupported automatic locking duration", "zh-CN": "不支持的自动锁定时间", "zh-TW": "不支援的自動鎖定時間" },
  "error.avatarProcess": { en: "Unable to process avatar image", "zh-CN": "无法处理头像图片", "zh-TW": "無法處理頭像圖片" },
  "error.avatarTooLarge": { en: "The source avatar image cannot exceed 10 MiB", "zh-CN": "头像原图不能超过 10 MiB", "zh-TW": "頭像原圖不能超過 10 MiB" },
  "error.avatarFormat": { en: "Choose a PNG, JPEG, GIF, WebP, or AVIF image", "zh-CN": "请选择 PNG、JPEG、GIF、WebP 或 AVIF 图片", "zh-TW": "請選擇 PNG、JPEG、GIF、WebP 或 AVIF 圖片" },
  "error.avatarBrowser": { en: "This browser cannot process the avatar image", "zh-CN": "当前浏览器无法处理头像图片", "zh-TW": "目前瀏覽器無法處理頭像圖片" },
  "error.attachmentEmpty": { en: "The attachment is empty", "zh-CN": "附件为空", "zh-TW": "附件是空的" },
  "error.attachmentFileTooLarge": { en: "An attachment cannot exceed 25 MiB", "zh-CN": "单个附件不能超过 25 MiB", "zh-TW": "單一附件不能超過 25 MiB" },
  "error.attachmentFormat": { en: "Choose a PNG, JPEG, GIF, WebP or AVIF image.", "zh-CN": "请选择 PNG、JPEG、GIF、WebP 或 AVIF 图片。", "zh-TW": "請選擇 PNG、JPEG、GIF、WebP 或 AVIF 圖片。" },
  "error.attachmentOffline": { en: "“{name}” is not cached on this device. Reconnect to load it.", "zh-CN": "本地没有附件“{name}”的缓存。请联网后加载。", "zh-TW": "本機沒有附件「{name}」的快取。請連網後載入。" },
  "error.missingAttachment": { en: "“{title}” is missing attachment {attachment}.", "zh-CN": "笔记“{title}”缺少附件 {attachment}。", "zh-TW": "筆記「{title}」缺少附件 {attachment}。" },

  "api.crossOrigin": { en: "Open Mint Notes at its usual address and try again.", "zh-CN": "请从 Mint Notes 的正常访问地址打开应用后重试。", "zh-TW": "請從 Mint Notes 的正常存取位址開啟應用程式後重試。" },
  "api.authRequired": { en: "Sign in to continue", "zh-CN": "请登录后继续", "zh-TW": "請登入後繼續" },
  "api.sessionInvalid": { en: "Your sign-in session has expired. Sign in again to continue.", "zh-CN": "登录已失效。请重新登录后继续。", "zh-TW": "登入已失效。請重新登入後繼續。" },
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
  "api.currentPasswordIncorrect": { en: "The current master password is incorrect", "zh-CN": "当前主密码不正确", "zh-TW": "目前的主密碼不正確" },
  "api.invalidRecoveryReset": { en: "Invalid recovery key reset", "zh-CN": "恢复密钥重置请求无效", "zh-TW": "復原金鑰重設請求無效" },
  "api.invalidUsernameChange": { en: "Invalid username change", "zh-CN": "用户名修改请求无效", "zh-TW": "使用者名稱變更請求無效" },
  "api.recoveryKeyIncorrect": { en: "Recovery key is incorrect", "zh-CN": "恢复密钥不正确", "zh-TW": "復原金鑰不正確" },
  "api.usernameUnchanged": { en: "Enter a different username", "zh-CN": "请输入不同的用户名", "zh-TW": "請輸入不同的使用者名稱" },
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
  "api.endpointTooNew": { en: "This device must be signed in for 24 hours to sign out other devices.", "zh-CN": "当前设备登录满 24 小时后，可让其他设备退出登录。", "zh-TW": "目前裝置登入滿 24 小時後，可讓其他裝置登出。" },
  "api.logoutCurrentEndpoint": { en: "Use Sign out to end this device’s session.", "zh-CN": "请选择“退出登录”以退出当前设备。", "zh-TW": "請選擇「登出」以結束目前裝置的登入。" },
  "api.endpointAlreadySignedOut": { en: "This device is already signed out", "zh-CN": "此设备已退出登录", "zh-TW": "此裝置已登出" },
  "api.invalidSyncEvent": { en: "Invalid synchronization event request", "zh-CN": "同步事件请求无效", "zh-TW": "同步事件請求無效" },
  "api.invalidEncryptedObject": { en: "Could not verify the encrypted data", "zh-CN": "无法验证加密数据", "zh-TW": "無法驗證加密資料" },
  "api.invalidEncryptedObjectBatch": { en: "Could not verify the encrypted data being synced", "zh-CN": "无法验证本次同步的加密数据", "zh-TW": "無法驗證本次同步的加密資料" },
  "api.invalidPurge": { en: "Invalid purge request", "zh-CN": "永久删除请求无效", "zh-TW": "永久刪除請求無效" },
  "api.objectTypeChange": { en: "Object type cannot change", "zh-CN": "对象类型不能更改", "zh-TW": "物件類型不能變更" },
  "api.revisionConflict": { en: "Revision conflict", "zh-CN": "版本冲突", "zh-TW": "版本衝突" },
  "api.purgeConflict": { en: "Purge conflict", "zh-CN": "永久删除发生冲突", "zh-TW": "永久刪除發生衝突" },
  "api.invalidAttachmentChunk": { en: "Invalid encrypted attachment chunk", "zh-CN": "加密附件分块无效", "zh-TW": "加密附件分塊無效" },
  "api.attachmentTooLarge": { en: "Attachment chunk is too large", "zh-CN": "附件分块过大", "zh-TW": "附件分塊過大" },
  "api.attachmentExists": { en: "Attachment chunk already exists", "zh-CN": "附件分块已存在", "zh-TW": "附件分塊已存在" },
  "api.attachmentNotFound": { en: "Attachment chunk not found", "zh-CN": "未找到附件分块", "zh-TW": "找不到附件分塊" },
  "api.quotaExceeded": { en: "The storage quota has been reached", "zh-CN": "存储用量已达配额", "zh-TW": "儲存用量已達配額" },
  "api.invalidStorageQuota": { en: "Enter a valid storage quota", "zh-CN": "请输入有效的存储配额", "zh-TW": "請輸入有效的儲存配額" },
  "api.invalidUserSetup": { en: "Invalid user setup", "zh-CN": "用户激活资料无效", "zh-TW": "使用者啟用資料無效" },
  "api.setupNotFound": { en: "Account setup not found", "zh-CN": "未找到账户激活资料", "zh-TW": "找不到帳戶啟用資料" },
  "api.invalidUserUpdate": { en: "Invalid user update", "zh-CN": "用户更新请求无效", "zh-TW": "使用者更新請求無效" },
  "api.cannotDisableSelf": { en: "You cannot disable your own account", "zh-CN": "不能禁用自己的账户", "zh-TW": "不能停用自己的帳戶" },
  "api.userNotFound": { en: "User not found", "zh-CN": "未找到用户", "zh-TW": "找不到使用者" },
  "api.invalidUserDeletion": { en: "Invalid user deletion", "zh-CN": "用户删除请求无效", "zh-TW": "使用者刪除請求無效" },
  "api.cannotDeleteSelf": { en: "You cannot delete your own account", "zh-CN": "不能删除自己的账户", "zh-TW": "不能刪除自己的帳戶" },
  "api.usernameMismatch": { en: "The username does not match the account you are deleting", "zh-CN": "输入的用户名与要删除的账户不符", "zh-TW": "輸入的使用者名稱與要刪除的帳戶不符" },
  "api.lastAdmin": { en: "The last administrator cannot be deleted", "zh-CN": "不能删除最后一位管理员", "zh-TW": "不能刪除最後一位管理員" }
} as const;

export type MessageKey = keyof typeof messages;
export type Translate = (key: MessageKey, values?: TranslationValues) => string;

export class UserFacingError extends Error {
  constructor(readonly key: MessageKey, readonly values?: TranslationValues) {
    super(key);
  }
}

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
  "Browser account change blocked": "account.switchFailed",
  "Browser session unavailable": "account.reauth",
  "Browser session changed": "account.switchFailed",
  "Local save failed": "notice.localSaveFailed",
  "Device authorization unavailable": "account.rememberFailed",
  "Device verification required": "account.reauth",
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
  "Invalid storage quota": "api.invalidStorageQuota",
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

export function translateError(error: unknown, t: Translate, fallback: MessageKey, fallbackValues?: TranslationValues): string {
  if (error instanceof UserFacingError) return t(error.key, error.values);
  if (!(error instanceof Error)) return t(fallback, fallbackValues);
  const code = (error as Error & { data?: { code?: string } }).data?.code;
  if (code === "PROTOCOL_UPGRADE_REQUIRED" || code === "BROWSER_UPGRADE_REQUIRED") return t("notice.syncUpgradeRequired");
  if (code === "METADATA_QUOTA_EXCEEDED") return t("notice.metadataQuotaReached");
  if (code === "OPERATION_EXPIRED") return t("notice.operationExpired");
  if (code === "OWNERSHIP_INCOMPLETE") return t("notice.ownershipIncomplete");
  if (Object.hasOwn(errorMessages, error.message)) return t(errorMessages[error.message]);
  const offlineAttachment = /^附件“(.+)”尚未缓存，离线时无法读取$/.exec(error.message);
  if (offlineAttachment) return t("error.attachmentOffline", { name: offlineAttachment[1] });
  const missingAttachment = /^笔记“(.+)”缺少附件 (.+)$/.exec(error.message);
  if (missingAttachment) return t("error.missingAttachment", { title: missingAttachment[1], attachment: missingAttachment[2] });
  return t(fallback, fallbackValues);
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
