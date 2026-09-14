# 错误与受限状态文案核对表

核对日期：2026-09-14。以下是当前工作区源码快照，包含刚修改的两条离线提示。此文件供文案修改审阅使用，不改变应用行为。

共整理 170 条已本地化文案（含拼接片段、相关受限状态和 2 条未使用文案），另列未本地化错误及展示缺口。可以用编号或文案键指定修改，例如：`A10 改为……`。`{title}`、`{count}`、`{reason}` 等是动态占位符。

## 阅读说明

- **兜底**：不是该操作失败时必然显示的文字。`translateError` 优先将已知错误翻译；未知且非空的 `Error.message` 直接显示原文；非 Error 或空错误信息才使用兜底。
- **警告／信息／严重通知**：Toast 分别在 7 秒／4 秒后自动消失／不自动消失，均可手动关闭。页面、表单和状态栏提示不适用这个时长。
- **API 错误**：由失败的操作决定显示在表单、Toast 或同步详情中；部分会被重试、冲突处理或会话清理吸收。表中标明已确认的特殊分支，不把所有服务端错误都算作必然弹窗。
- 收录失败、校验、冲突、离线与阻止操作的相关提示；普通成功提示、常规帮助文字及常规删除／导出确认不在本表。附件缺失的历史恢复确认作为异常情况保留。
- 触发情况基于源码静态核对，未逐项构造故障进行浏览器复现。消息文本直接取自翻译表；“入口”链接定位调用或抛出错误的位置。

实现依据：[错误翻译](../src/i18n/index.tsx#L891)、[通知时长](../src/components/Toast.tsx#L13)、[HTTP 错误与会话失效](../src/api.ts#L13)。

## 值得优先核对的差异

1. 两条简短离线提示按 `serverSessionVerified` 显示，所以网络已恢复但会话尚未验证时，仍可能显示“离线”。
2. 锁定页的“主密码不正确”是兜底；主密码认证失败时，实际通常是“用户名或密码不正确”。
3. “同步错误 · 已保存到本地”与“本地保存失败”是不同文案通道；本地失败有更高优先级的状态详情和严重通知。
4. 修改“无法更新名称”等兜底文案，不会同时改变它们收到的具体 API 错误和原始英文错误。
5. “受保护的历史版本阻止了此操作”由删除历史、永久清除两类错误共用；需要不同措辞时不能只改这一条翻译。
6. 导出附件缺失已有翻译映射，但导出入口缺少统一错误通知捕获；见 E05 和 J 的展示缺口。

## A · 登录、解锁与离线限制

| 编号／文案键 | 简体中文 | English | 繁體中文 | 出现情况 |
| --- | --- | --- | --- | --- |
| A01<br>[auth.configError](../src/i18n/index.tsx#L91) | 无法获取注册配置，点击“注册”重试。 | Registration settings could not be loaded. Select “Register” to retry. | 無法取得註冊設定，點選「註冊」重試。 | **页面提示**：登录页加载注册配置失败，且当前没有显示离线访问不可用提示。<br>[入口](../src/features/AuthScreen.tsx#L237) |
| A02<br>[auth.offlineUnavailable](../src/i18n/index.tsx#L96) | 离线访问仅适用于已记住、且已使用当前版本完成过一次在线验证的设备。 | Offline access is available only on a remembered device that has completed one online verification with this version. | 離線存取僅適用於已記住、且已使用目前版本完成過一次線上驗證的裝置。 | **页面提示**：无法连接服务器后尝试离线恢复，但找不到符合要求的已记住设备，或本机凭据无法恢复。<br>[入口](../src/features/AuthScreen.tsx#L236) |
| A03<br>[auth.passwordMin](../src/i18n/index.tsx#L101) | 主密码至少需要 10 个字符 | The master password must contain at least 10 characters | 主密碼至少需要 10 個字元 | **表单错误**：普通注册或激活注册时，主密码不足 10 个字符。<br>[入口](../src/features/AuthScreen.tsx#L84) |
| A04<br>[auth.passwordMismatch](../src/i18n/index.tsx#L111) | 两次输入的密码不一致 | The passwords do not match | 兩次輸入的密碼不一致 | **表单错误**：普通注册或激活注册时，两次主密码不同。<br>[入口](../src/features/AuthScreen.tsx#L85) |
| A05<br>[auth.newPasswordMin](../src/i18n/index.tsx#L106) | 新主密码至少需要 10 个字符 | The new master password must contain at least 10 characters | 新主密碼至少需要 10 個字元 | **表单／警告**：找回密码或设置中修改密码时，新主密码不足 10 个字符。<br>[入口1](../src/features/AuthScreen.tsx#L123)；[入口2](../src/features/SettingsPanel.tsx#L491) |
| A06<br>[auth.newPasswordMismatch](../src/i18n/index.tsx#L112) | 两次输入的新密码不一致 | The new passwords do not match | 兩次輸入的新密碼不一致 | **表单／警告**：找回密码或设置中修改密码时，两次新密码不同。<br>[入口1](../src/features/AuthScreen.tsx#L124)；[入口2](../src/features/SettingsPanel.tsx#L492) |
| A07<br>[auth.operationFailed](../src/i18n/index.tsx#L118) | 操作失败 | The operation failed | 操作失敗 | **兜底·表单**：登录、注册、激活或找回密码的异常没有可用错误信息。<br>[入口](../src/features/AuthScreen.tsx#L165) |
| A08<br>[auth.recovery.copyFailed](../src/i18n/index.tsx#L42) | 无法复制恢复密钥。请选中上方密钥并手动复制。 | The recovery key could not be copied. Select it above and copy it manually. | 無法複製復原金鑰。請選取上方金鑰並手動複製。 | **页面错误**：注册或激活后的恢复密钥复制失败，需要手动复制。<br>[入口](../src/features/AuthScreen.tsx#L201) |
| A09<br>[lock.offline](../src/i18n/index.tsx#L126) | 离线 · 暂无法使用主密码解锁 | Offline · Master password unlock is temporarily unavailable | 離線 · 暫無法使用主密碼解鎖 | **页面提示**：锁定页的服务器会话尚未通过验证；不只取决于浏览器是否断网。已按本次要求改短。<br>[入口](../src/features/LockScreen.tsx#L76) |
| A10<br>[lock.invalidPin](../src/i18n/index.tsx#L139) | PIN 不正确 | Incorrect PIN | PIN 不正確 | **表单错误**：PIN 解锁返回 invalid（错误 PIN、无可用 PIN 凭据等）；达到失败次数上限时走撤销设备信任流程，不显示这一条。<br>[入口](../src/features/LockScreen.tsx#L42) |
| A11<br>[lock.cannotUnlock](../src/i18n/index.tsx#L140) | 无法解锁 | Unable to unlock | 無法解鎖 | **兜底·表单**：PIN 解锁过程抛出没有可用错误信息的异常。<br>[入口](../src/features/LockScreen.tsx#L45) |
| A12<br>[lock.invalidPassword](../src/i18n/index.tsx#L141) | 主密码不正确 | Incorrect master password | 主密碼不正確 | **兜底·表单**：主密码解锁过程的通用兜底；服务器明确返回凭据错误时，通常显示 api.invalidCredentials。<br>[入口](../src/features/LockScreen.tsx#L65) |
| A13<br>[settings.localOnly](../src/i18n/index.tsx#L144) | 离线 · 某些设置无法更改 | Offline · Some settings cannot be changed | 離線 · 某些設定無法變更 | **页面提示**：设置页的服务器会话尚未通过验证。已按本次要求改短。<br>[入口](../src/features/SettingsPanel.tsx#L570) |
| A14<br>[notice.onlineSessionRequired](../src/i18n/index.tsx#L576) | 此操作需要联网并完成服务器会话验证。 | This action requires an online, verified server session. | 此操作需要連線並完成伺服器工作階段驗證。 | **警告／错误**：未验证服务器会话时尝试账户、远程历史等受限操作；部分入口直接提示，部分通过异常显示。<br>[入口1](../src/features/SettingsPanel.tsx#L149)；[入口2](../src/features/vault/VaultWorkspace.tsx#L317) |

## B · 保存、同步与数据恢复

| 编号／文案键 | 简体中文 | English | 繁體中文 | 出现情况 |
| --- | --- | --- | --- | --- |
| B01<br>[app.save.offline](../src/i18n/index.tsx#L432) | 离线 · 已保存到本地 | Offline · saved locally | 離線 · 已儲存在本機 | **状态栏**：保存／同步状态进入 offline 时的简短状态文案。<br>[入口](../src/features/vault/useSyncStatus.ts#L74) |
| B02<br>[app.save.offlineDetail](../src/i18n/index.tsx#L435) | 设备当前离线 · 修改已保存到本地，联网后自动同步 | Device is offline · changes are saved locally and will synchronize after reconnecting | 裝置目前離線 · 修改已儲存在本機，連線後自動同步 | **状态详情**：同步阶段为 offline，且没有更高优先级的本地保存失败时。<br>[入口](../src/features/vault/useSyncStatus.ts#L88) |
| B03<br>[app.save.error](../src/i18n/index.tsx#L433) | 同步错误 · 已保存到本地 | Sync error · saved locally | 同步錯誤 · 已儲存在本機 | **状态栏**：同步失败后显示的简短状态文案；本地保存失败另有详情和严重通知。<br>[入口](../src/features/vault/useSyncStatus.ts#L73) |
| B04<br>[app.save.unreachableDetail](../src/i18n/index.tsx#L440) | 无法连接服务器 · 修改已保存到本地，将自动重试 | Unable to connect to the server · changes are saved locally and synchronization will retry automatically | 無法連線到伺服器 · 修改已儲存在本機，將自動重試 | **状态详情**：同步抛出非 ApiError 异常，归类为服务器不可达；包含网络失败等情况。<br>[入口](../src/features/vault/useSyncStatus.ts#L86) |
| B05<br>[app.save.serverErrorDetail](../src/i18n/index.tsx#L445) | 服务器拒绝同步：{reason} · 修改已保存到本地，将自动重试 | The server rejected synchronization: {reason} · changes are saved locally and synchronization will retry automatically | 伺服器拒絕同步：{reason} · 修改已儲存在本機，將自動重試 | **状态详情**：同步抛出 ApiError，{reason} 为已翻译的具体服务端错误或原始错误。<br>[入口](../src/features/vault/useSyncStatus.ts#L85) |
| B06<br>[app.save.localFailureDetail](../src/i18n/index.tsx#L450) | 本地保存失败 · 最新修改尚未安全保存 | Local save failed · the latest changes are not yet safely stored | 本機儲存失敗 · 最新修改尚未安全儲存 | **状态详情**：存在至少一个尚未恢复的本地对象保存失败；优先于其他同步详情。<br>[入口](../src/features/vault/useSyncStatus.ts#L79) |
| B07<br>[notice.localSaveFailed](../src/i18n/index.tsx#L564) | 本地保存失败，最新修改仍在当前页面中，但尚未安全保存。 | Local save failed. The latest changes are still open but are not yet safely stored. | 本機儲存失敗，最新修改仍在目前頁面中，但尚未安全儲存。 | **严重通知**：笔记对象本地持久化失败；当前页面仍保留修改，但写入未成功。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L545) |
| B08<br>[notice.syncFailed](../src/i18n/index.tsx#L563) | 同步失败，修改仍保存在本地 | Synchronization failed. Changes remain saved locally. | 同步失敗，修改仍儲存在本機 | **通用／兜底·警告**：同步异常为非 ApiError 时直接显示；ApiError 优先显示具体错误。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L187) |
| B09<br>[notice.attachmentConflict](../src/i18n/index.tsx#L558) | 检测到附件元数据冲突；已保留服务器版本，本地附件分块仍未删除。 | Attachment metadata conflict detected. The server version was retained and local attachment chunks were not deleted. | 偵測到附件中繼資料衝突；已保留伺服器版本，本機附件分塊仍未刪除。 | **严重通知／兜底**：附件元数据同步冲突时直接显示；冲突处理异常时也用作兜底。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L731) |
| B10<br>[notice.documentConflict](../src/i18n/index.tsx#L559) | “{title}”存在多端冲突，本地修改已保存为冲突副本。 | “{title}” has a cross-device conflict. Local changes were saved as a conflict copy. | 「{title}」發生跨裝置衝突，本機修改已儲存為衝突副本。 | **严重通知**：多端文档冲突，本地修改已另存为冲突副本。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L752) |
| B11<br>[notice.activeRemoteDeleted](../src/i18n/index.tsx#L560) | 当前笔记已在其他设备上删除；为避免打断编辑，将在离开当前笔记后更新界面。 | The current note was deleted on another device. To avoid interrupting editing, the interface will update after you leave this note. | 目前筆記已在其他裝置上刪除；為避免中斷編輯，將在離開目前筆記後更新介面。 | **信息通知**：当前正编辑的笔记被远端删除，界面变更推迟到离开该笔记后。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L807) |
| B12<br>[notice.activeRemoteUpdated](../src/i18n/index.tsx#L561) | 当前笔记在其他设备上已更新；为避免打断编辑，将在离开当前笔记后应用远端版本。 | The current note was updated on another device. To avoid interrupting editing, the remote version will be applied after you leave this note. | 目前筆記已在其他裝置上更新；為避免中斷編輯，將在離開目前筆記後套用遠端版本。 | **信息通知**：当前正编辑的笔记收到远端更新，应用远端内容推迟到离开该笔记后。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L807) |
| B13<br>[notice.remoteIntegrity](../src/i18n/index.tsx#L562) | {count} 个服务器加密项目未能通过完整性校验；已保留本机最后一次可读版本。 | {count} encrypted server items failed integrity checks. The last readable local versions were retained. | {count} 個伺服器加密項目未通過完整性驗證；已保留本機最後一次可讀版本。 | **严重通知**：常规同步拉取中，有服务器加密对象无法通过认证／解密检查。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1086) |
| B14<br>[notice.localDecryptFailed](../src/i18n/index.tsx#L569) | {count} 个本地加密项目暂时无法解密，其他笔记已正常加载。{detail} | {count} local encrypted items could not be decrypted. Other notes loaded normally. {detail} | {count} 個本機加密項目暫時無法解密，其他筆記已正常載入。{detail} | **严重通知**：启动加载时仍有本地加密对象无法解密，且没有选择忽略这些版本；{detail} 由后两项之一组成。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1295) |
| B15<br>[notice.pendingDecryptFailed](../src/i18n/index.tsx#L570) | 其中 {count} 个含未同步修改，已原样保留。 | {count} contain unsynchronized changes and were retained unchanged. | 其中 {count} 個包含未同步修改，已原樣保留。 | **拼接片段**：本地解密失败对象中包含尚未同步的修改；作为 notice.localDecryptFailed 的 {detail}。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1298) |
| B16<br>[notice.ciphertextRetained](../src/i18n/index.tsx#L571) | 已保留原始密文。 | The original ciphertext was retained. | 已保留原始密文。 | **拼接片段**：本地解密失败对象中没有待同步修改；作为 notice.localDecryptFailed 的 {detail}。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1299) |
| B17<br>[notice.remoteIntegrityOthers](../src/i18n/index.tsx#L573) | {count} 个服务器加密项目未能通过完整性校验；其他笔记已正常加载，本机可读版本均已保留。 | {count} encrypted server items failed integrity checks. Other notes loaded normally and all readable local versions were retained. | {count} 個伺服器加密項目未通過完整性驗證；其他筆記已正常載入，本機可讀版本均已保留。 | **严重通知**：初始加载时没有未解决的本地解密失败，但存在服务器对象完整性失败。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1313) |
| B18<br>[notice.localRestoredSyncRetry](../src/i18n/index.tsx#L574) | 笔记已从本地恢复，但本次服务器同步失败，稍后会自动重试。 | Notes were restored locally, but server synchronization failed and will retry automatically. | 筆記已從本機復原，但本次伺服器同步失敗，稍後會自動重試。 | **警告**：初始拉取失败后已加载本地笔记，并且浏览器报告在线。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1315) |
| B19<br>[notice.loadedOffline](../src/i18n/index.tsx#L575) | 离线状态下已加载本地笔记。 | Local notes loaded while offline. | 已在離線狀態載入本機筆記。 | **警告**：初始拉取失败后已加载本地笔记，并且浏览器报告离线；它是状态说明，不表示本地读取失败。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1315) |
| B20<br>[notice.openDatabaseFailed](../src/i18n/index.tsx#L581) | 无法打开本地加密数据库 | Unable to open the local encrypted database | 無法開啟本機加密資料庫 | **兜底·加载失败页**：工作区初始化失败且没有可用错误信息；捕获范围不只限于数据库打开。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1357) |
| B21<br>[notice.logoutLocalClearFailed](../src/i18n/index.tsx#L582) | 无法删除当前账户的本地数据，尚未登出。 | Unable to delete this account's local data. You have not been logged out. | 無法刪除目前帳戶的本機資料，尚未登出。 | **兜底·严重通知**：工作区登出流程无法清理账户本地数据，异常没有可用信息；尚未完成登出。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L2261) |

## C · 设置、个人资料与设备安全

| 编号／文案键 | 简体中文 | English | 繁體中文 | 出现情况 |
| --- | --- | --- | --- | --- |
| C01<br>[notice.loadDevicesFailed](../src/i18n/index.tsx#L346) | 无法加载设备会话 | Unable to load device sessions | 無法載入裝置工作階段 | **兜底·警告**：加载设备会话列表失败。<br>[入口](../src/features/SettingsPanel.tsx#L157) |
| C02<br>[notice.loadTrashRetentionFailed](../src/i18n/index.tsx#L347) | 无法加载回收站保留设置 | Unable to load trash retention settings | 無法載入垃圾桶保留設定 | **兜底·警告**：加载回收站保留时长失败。<br>[入口](../src/features/SettingsPanel.tsx#L172) |
| C03<br>[notice.saveTrashFailed](../src/i18n/index.tsx#L351) | 无法保存回收站设置，已恢复原设置 | Unable to save trash settings. The previous setting was restored. | 無法儲存垃圾桶設定，已復原原設定 | **通用／兜底·警告**：保存回收站保留时长失败，并把界面值恢复为原设置。<br>[入口](../src/features/SettingsPanel.tsx#L187) |
| C04<br>[notice.settingRestored](../src/i18n/index.tsx#L350) | {message}，已恢复原设置 | {message}. The previous setting was restored. | {message}，已復原原設定 | **拼接片段**：回收站设置保存抛出 Error 时，将具体错误填入 {message} 后追加“已恢复原设置”。<br>[入口](../src/features/SettingsPanel.tsx#L187) |
| C05<br>[notice.displayNameFailed](../src/i18n/index.tsx#L353) | 无法更新名称 | Unable to update name | 無法更新名稱 | **兜底·警告**：更新显示名称失败。<br>[入口](../src/features/SettingsPanel.tsx#L232) |
| C06<br>[notice.usernameFailed](../src/i18n/index.tsx#L356) | 无法更新用户名 | Unable to update username | 無法更新使用者名稱 | **兜底·警告**：修改用户名，或同时修改用户名和恢复密钥失败。<br>[入口](../src/features/SettingsPanel.tsx#L291) |
| C07<br>[notice.avatarUpdateFailed](../src/i18n/index.tsx#L359) | 无法更新头像 | Unable to update avatar | 無法更新頭像 | **兜底·警告**：处理、加密或上传头像失败。<br>[入口](../src/features/SettingsPanel.tsx#L355) |
| C08<br>[notice.avatarRemoveFailed](../src/i18n/index.tsx#L361) | 无法移除头像 | Unable to remove avatar | 無法移除頭像 | **兜底·警告**：删除头像失败。<br>[入口](../src/features/SettingsPanel.tsx#L366) |
| C09<br>[error.avatarTooLarge](../src/i18n/index.tsx#L690) | 头像原图不能超过 10 MiB | The source avatar image cannot exceed 10 MiB | 頭像原圖不能超過 10 MiB | **具体错误·警告**：选择的头像原图大于 10 MiB。<br>[入口](../src/features/profileAvatar.ts#L15) |
| C10<br>[error.avatarFormat](../src/i18n/index.tsx#L691) | 请选择 PNG、JPEG、GIF、WebP 或 AVIF 图片 | Choose a PNG, JPEG, GIF, WebP, or AVIF image | 請選擇 PNG、JPEG、GIF、WebP 或 AVIF 圖片 | **具体错误·警告**：头像文件签名不属于允许的五种栅格图片格式。<br>[入口](../src/features/profileAvatar.ts#L18) |
| C11<br>[error.avatarBrowser](../src/i18n/index.tsx#L692) | 当前浏览器无法处理头像图片 | This browser cannot process the avatar image | 目前瀏覽器無法處理頭像圖片 | **具体错误·警告**：无法取得用于处理头像的 Canvas 2D 上下文。<br>[入口](../src/features/profileAvatar.ts#L28) |
| C12<br>[error.avatarProcess](../src/i18n/index.tsx#L689) | 无法处理头像图片 | Unable to process avatar image | 無法處理頭像圖片 | **具体错误·警告**：头像导出为 WebP 失败后回退 PNG，仍无法生成 Blob。<br>[入口](../src/features/profileAvatar.ts#L8) |
| C13<br>[notice.deviceSignOutFailed](../src/i18n/index.tsx#L364) | 登出设备失败 | Unable to sign out device | 登出裝置失敗 | **兜底·警告**：让另一台设备登出失败。<br>[入口](../src/features/SettingsPanel.tsx#L378) |
| C14<br>[notice.deviceRemoveFailed](../src/i18n/index.tsx#L367) | 移除设备记录失败 | Unable to remove device record | 移除裝置記錄失敗 | **兜底·警告**：移除失效设备记录失败。<br>[入口](../src/features/SettingsPanel.tsx#L390) |
| C15<br>[notice.pinSaveFailed](../src/i18n/index.tsx#L369) | 无法保存 PIN | Unable to save PIN | 無法儲存 PIN | **兜底·警告**：设置或更新本机 PIN 失败。<br>[入口](../src/features/SettingsPanel.tsx#L430) |
| C16<br>[notice.pinRemoveFailed](../src/i18n/index.tsx#L371) | 无法移除 PIN | Unable to remove PIN | 無法移除 PIN | **兜底·警告**：移除本机 PIN 失败。<br>[入口](../src/features/SettingsPanel.tsx#L445) |
| C17<br>[error.pinMin](../src/i18n/index.tsx#L686) | PIN 至少需要 4 个字符 | The PIN must contain at least 4 characters | PIN 至少需要 4 個字元 | **具体错误·警告**：设置本机 PIN 时，不满足至少 4 个字符的校验。<br>[入口](../src/crypto/deviceUnlock.ts#L330) |
| C18<br>[error.deviceCredentialMissing](../src/i18n/index.tsx#L687) | 当前设备没有可用的本机解锁凭据 | No device unlock credential is available on this device | 目前裝置沒有可用的本機解鎖憑證 | **具体错误·警告**：设置 PIN 或自动锁定时，读取不到本机解锁凭据。<br>[入口](../src/crypto/deviceUnlock.ts#L332) |
| C19<br>[notice.setPinFirst](../src/i18n/index.tsx#L372) | 请先在上方设置本机 PIN，再开启自动锁定 | Set a device PIN above before enabling automatic locking | 請先在上方設定本機 PIN，再開啟自動鎖定 | **警告**：尚未设置 PIN，却尝试开启自动锁定。<br>[入口](../src/features/SettingsPanel.tsx#L451) |
| C20<br>[error.autoLockUnsupported](../src/i18n/index.tsx#L688) | 不支持的自动锁定时间 | Unsupported automatic locking duration | 不支援的自動鎖定時間 | **具体错误·警告**：传入不支持的自动锁定分钟值；当前接受 0、1、2、5、10、15、30、60。<br>[入口](../src/crypto/deviceUnlock.ts#L450) |
| C21<br>[notice.autoLockSaveFailed](../src/i18n/index.tsx#L375) | 无法保存自动锁定设置 | Unable to save automatic locking settings | 無法儲存自動鎖定設定 | **兜底·警告**：保存自动锁定设置失败。<br>[入口](../src/features/SettingsPanel.tsx#L463) |
| C22<br>[notice.passwordChangeFailed](../src/i18n/index.tsx#L377) | 密码修改失败 | Unable to change password | 密碼變更失敗 | **兜底·警告**：设置中修改主密码失败。<br>[入口](../src/features/SettingsPanel.tsx#L502) |
| C23<br>[notice.recoveryResetFailed](../src/i18n/index.tsx#L379) | 无法重置恢复密钥 | Unable to reset recovery key | 無法重設復原金鑰 | **兜底·警告**：重置恢复密钥，或为用户名变更准备替代恢复密钥失败。<br>[入口](../src/features/SettingsPanel.tsx#L311) |
| C24<br>[notice.configurePin](../src/i18n/index.tsx#L615) | 请先在“设置 > 安全 > 设置 PIN”中设置本机 PIN。 | Set a device PIN under Settings > Security > Set PIN first. | 請先在「設定 > 安全性 > 設定 PIN」中設定本機 PIN。 | **警告**：点击立即锁定应用，但当前设备尚未配置 PIN。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L2296) |

## D · 笔记、目录与回收站

| 编号／文案键 | 简体中文 | English | 繁體中文 | 出现情况 |
| --- | --- | --- | --- | --- |
| D01<br>[notice.nameRequired](../src/i18n/index.tsx#L607) | 名称不能为空。 | The name cannot be empty. | 名稱不能為空。 | **警告**：重命名笔记或文件夹时，去除首尾空白后名称为空。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L2126) |
| D02<br>[notice.renameConflict](../src/i18n/index.tsx#L608) | 无法重命名：所在目录中已有名为“{title}”的项目。 | Cannot rename: an item named “{title}” already exists in this directory. | 無法重新命名：所在目錄中已有名為「{title}」的項目。 | **警告**：重命名后会与同目录的其他项目重名。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L2131) |
| D03<br>[notice.moveIntoDescendant](../src/i18n/index.tsx#L595) | 不能把文件夹移动到自身或其子文件夹中。 | A folder cannot be moved into itself or one of its descendants. | 不能將資料夾移動到自身或其子資料夾中。 | **警告**：单项移动时，目标为自身或后代目录。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1762) |
| D04<br>[notice.moveNameConflict](../src/i18n/index.tsx#L596) | 无法移动：目标目录中已有名为“{title}”的项目。 | Cannot move: an item named “{title}” already exists in the destination. | 無法移動：目標目錄中已有名為「{title}」的項目。 | **警告**：单项移动时，目标目录已有同名项目。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1766) |
| D05<br>[notice.batchMoveIntoDescendant](../src/i18n/index.tsx#L597) | 不能把所选文件夹移动到自身或其子文件夹中。 | Selected folders cannot be moved into themselves or their descendants. | 不能將所選資料夾移動到自身或其子資料夾中。 | **警告**：批量移动时，目标目录属于所选项目的子树。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1785) |
| D06<br>[notice.batchMoveNameConflict](../src/i18n/index.tsx#L598) | 无法批量移动：目标目录会出现名为“{title}”的重复项目。 | Cannot move selection: the destination would contain duplicate items named “{title}”. | 無法批次移動：目標目錄會出現名為「{title}」的重複項目。 | **警告**：批量移动后，目标目录中会出现重名项目。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1792) |
| D07<br>[notice.noteLockedEdit](../src/i18n/index.tsx#L603) | 请先解锁“{title}”再进行编辑 | Unlock “{title}” before editing it | 請先解鎖「{title}」再進行編輯 | **警告／错误**：尝试修改已锁定笔记的正文、标题、附件或用历史覆盖当前内容。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L656) |
| D08<br>[notice.noteLockFailed](../src/i18n/index.tsx#L604) | 无法更新笔记锁定状态 | Unable to update note lock | 無法更新筆記鎖定狀態 | **兜底·严重通知**：持久化笔记锁定／解锁状态失败。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L2180) |
| D09<br>[notice.lockedTrashBlocked](../src/i18n/index.tsx#L605) | 所选内容包含已锁定的“{title}”，请先解锁再移到回收站 | Unlock “{title}” before moving this selection to trash | 所選內容包含已鎖定的「{title}」，請先解鎖再移到垃圾桶 | **警告**：准备移到回收站的选择范围中包含已锁定笔记。<br>[入口1](../src/features/vault/VaultTree.tsx#L183)；[入口2](../src/features/vault/VaultWorkspace.tsx#L1672) |
| D10<br>[notice.restoreNameConflict](../src/i18n/index.tsx#L585) | 无法恢复：“{title}”所在目录中已有同名项目。 | Cannot restore: “{title}” already exists in that directory. | 無法復原：「{title}」所在目錄中已有同名項目。 | **警告**：从回收站恢复时，原目录中已经存在同名项目。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1684) |
| D11<br>[notice.itemRestoreFailed](../src/i18n/index.tsx#L381) | 无法恢复“{title}” | Unable to restore “{title}” | 無法復原「{title}」 | **兜底·警告**：设置页执行恢复操作失败；非 Error 分支会传入 {title}，Error 且信息为空的兜底分支未传标题。<br>[入口](../src/features/SettingsPanel.tsx#L535) |
| D12<br>[notice.purgeOnlineOnly](../src/i18n/index.tsx#L591) | 永久删除必须联网完成；离线时内容仍保留在回收站。 | Permanent deletion requires an online connection. The content remains in trash while offline. | 永久刪除必須連線完成；離線時內容仍保留在垃圾桶。 | **警告**：永久删除或清空回收站时，浏览器离线或服务器会话未经验证。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1724) |
| D13<br>[notice.purgeWaitSync](../src/i18n/index.tsx#L592) | 请等待删除状态同步完成后再永久删除。 | Wait for deletion status to synchronize before permanently deleting. | 請等待刪除狀態同步完成後再永久刪除。 | **警告／严重通知**：手动永久删除仍有待同步对象、附件或历史时；或拉取的远端清除因本地状态被推迟。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L809) |
| D14<br>[notice.purgeFailed](../src/i18n/index.tsx#L594) | 永久删除失败 | Permanent deletion failed | 永久刪除失敗 | **兜底·严重通知**：执行永久删除失败。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1755) |
| D15<br>[notice.wikiLinkNotFound](../src/i18n/index.tsx#L586) | 找不到 WikiLink 目标：{target} | WikiLink target not found: {target} | 找不到 WikiLink 目標：{target} | **警告**：点击 WikiLink 后找不到匹配的笔记目标。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1593) |

## E · 附件、导入与编辑器

| 编号／文案键 | 简体中文 | English | 繁體中文 | 出现情况 |
| --- | --- | --- | --- | --- |
| E01<br>[error.attachmentEmpty](../src/i18n/index.tsx#L693) | 附件为空 | The attachment is empty | 附件是空的 | **具体错误**：添加或导入图片附件时，文件大小为 0。<br>[入口](../src/features/attachments.ts#L35) |
| E02<br>[error.attachmentFileTooLarge](../src/i18n/index.tsx#L694) | 单个附件不能超过 25 MiB | An attachment cannot exceed 25 MiB | 單一附件不能超過 25 MiB | **具体错误**：添加附件时，单个文件大于 25 MiB。<br>[入口](../src/features/attachments.ts#L36) |
| E03<br>[error.attachmentFormat](../src/i18n/index.tsx#L695) | 仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片，且会校验真实文件格式 | Only PNG, JPEG, GIF, WebP, and AVIF images are supported, and their actual file format is verified | 僅支援 PNG、JPEG、GIF、WebP 和 AVIF 圖片，且會驗證實際檔案格式 | **具体错误**：添加附件时，文件签名不是 PNG、JPEG、GIF、WebP 或 AVIF。<br>[入口](../src/features/attachments.ts#L40) |
| E04<br>[error.attachmentOffline](../src/i18n/index.tsx#L696) | 附件“{name}”尚未缓存，离线时无法读取 | Attachment “{name}” is not cached and cannot be read while offline | 附件「{name}」尚未快取，離線時無法讀取 | **具体错误**：本地分块不全，且浏览器离线或不允许远程请求；读取、恢复或导出附件的不同入口可能触发。 |
| E05<br>[error.missingAttachment](../src/i18n/index.tsx#L697) | 笔记“{title}”缺少附件 {attachment} | Note “{title}” is missing attachment {attachment} | 筆記「{title}」缺少附件 {attachment} | **已映射·展示缺口**：导出时正文引用了不存在的附件元数据；当前导出入口没有统一错误通知捕获，不能保证显示此翻译。 |
| E06<br>[notice.attachmentLoadFailed](../src/i18n/index.tsx#L583) | 附件加载失败 | Unable to load attachment | 附件載入失敗 | **兜底·警告**：为当前笔记加载、获取或解密附件失败。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1538) |
| E07<br>[notice.attachmentSaveFailed](../src/i18n/index.tsx#L584) | 附件保存失败 | Unable to save attachment | 附件儲存失敗 | **兜底·严重通知**：通过编辑器添加／粘贴／拖入附件失败。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L2433) |
| E08<br>[app.attachmentNotLoaded](../src/i18n/index.tsx#L556) | 附件尚未加载：{name} | Attachment not loaded: {name} | 附件尚未載入：{name} | **内容占位**：Markdown 引用了附件，但还没有可显示的解密 URL；不一定是错误，也可能正在加载。<br>[入口](../src/editor/ReadingEditor.tsx#L261) |
| E09<br>[notice.importFailed](../src/i18n/index.tsx#L614) | 导入失败 | Import failed | 匯入失敗 | **兜底·警告**：解析 ZIP、导入文本、创建笔记或加密附件过程中出错。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L2237) |
| E10<br>[editor.codeCopyFailed](../src/i18n/index.tsx#L17) | 无法复制代码 | Could not copy code | 無法複製程式碼 | **按钮反馈**：阅读模式代码块复制时，剪贴板 API 不可用或写入失败。<br>[入口](../src/editor/ReadingEditor.tsx#L48) |
| E11<br>[properties.keyRequired](../src/i18n/index.tsx#L538) | 属性名称不能为空。 | A property name is required. | 屬性名稱不能為空。 | **字段错误**：属性面板修改属性名时，名称为空。<br>[入口](../src/editor/FrontmatterProperties.tsx#L74) |
| E12<br>[properties.keyDuplicate](../src/i18n/index.tsx#L539) | 该属性名称已存在。 | That property name already exists. | 該屬性名稱已存在。 | **字段错误**：属性面板修改属性名时，新名称与现有属性重名。<br>[入口](../src/editor/FrontmatterProperties.tsx#L80) |
| E13<br>[properties.invalid](../src/i18n/index.tsx#L540) | 这段 YAML 元数据无效，内容已原样保留。 | This YAML frontmatter is invalid and has been left unchanged. | 這段 YAML 中繼資料無效，內容已原樣保留。 | **面板错误**：Front Matter 解析发现 YAML 错误／警告，或顶层不是映射；保留原文显示。<br>[入口](../src/editor/FrontmatterProperties.tsx#L211) |
| E14<br>[properties.sourceHint](../src/i18n/index.tsx#L545) | 请切换到源码模式编辑原始 YAML。 | Switch to Source mode to edit the original YAML. | 請切換到原始碼模式編輯原始 YAML。 | **辅助提示**：YAML 无效的属性面板中，提示去源码模式修正。<br>[入口](../src/editor/FrontmatterProperties.tsx#L213) |

## F · 历史版本

| 编号／文案键 | 简体中文 | English | 繁體中文 | 出现情况 |
| --- | --- | --- | --- | --- |
| F01<br>[notice.historySaveFailed](../src/i18n/index.tsx#L661) | 无法保存笔记历史 | Unable to save note history | 無法儲存筆記歷史 | **兜底·警告／严重通知**：自动保存历史失败时为警告；手动保存当前版本失败时为严重通知。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L619) |
| F02<br>[notice.historyLoadFailed](../src/i18n/index.tsx#L662) | 无法加载笔记历史 | Unable to load note history | 無法載入筆記歷史 | **兜底·警告**：加载远端历史失败后尝试显示本地历史；API 404 在这一入口被静默处理。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L475) |
| F03<br>[notice.historyDecryptFailed](../src/i18n/index.tsx#L663) | 无法解密这个历史版本，其他版本仍可使用。 | This history version could not be decrypted. Other versions remain available. | 無法解密這個歷史版本，其他版本仍可使用。 | **兜底·严重通知**：读取并解密历史版本失败；具体异常信息通常优先显示。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L505) |
| F04<br>[history.unsupported](../src/i18n/index.tsx#L647) | 不支持这个历史版本格式。 | This history format is not supported. | 不支援這個歷史版本格式。 | **具体错误·严重通知**：解密后的历史正文 schemaVersion 不是 1。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L501) |
| F05<br>[notice.historyDeleteOnlineOnly](../src/i18n/index.tsx#L664) | 删除历史记录需要联网。 | History deletion requires an internet connection. | 刪除歷史記錄需要連線。 | **警告**：删除单个历史、清空当前笔记或全部历史时，离线或会话未验证。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1951) |
| F06<br>[history.protectedDeleteHint](../src/i18n/index.tsx#L630) | 请先取消保护，再删除这个版本 | Remove protection before deleting this version | 請先取消保護，再刪除這個版本 | **控件提示**：历史版本受保护，删除按钮给出先取消保护的提示。<br>[入口1](../src/features/vault/VaultWorkspace.tsx#L2441)；[入口2](../src/components/HistoryPanel.tsx#L125) |
| F07<br>[notice.historyProtectedDeleteBlocked](../src/i18n/index.tsx#L682) | 请先取消保护，再删除这个历史版本。 | Remove protection before deleting this history version. | 請先取消保護，再刪除這個歷史版本。 | **警告**：执行删除前检查发现该历史版本受保护。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1950) |
| F08<br>[notice.historyProtectionSyncRequired](../src/i18n/index.tsx#L683) | 保护状态同步完成后才能清空历史。 | Protection changes must finish synchronizing before history can be cleared. | 保護狀態同步完成後才能清空歷史。 | **警告**：清空历史前，仍有保护状态变更未同步完成。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1980) |
| F09<br>[notice.historyDeleteFailed](../src/i18n/index.tsx#L666) | 无法删除历史版本 | Unable to delete the history version | 無法刪除歷史版本 | **兜底·严重通知**：永久删除一个历史版本失败。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1967) |
| F10<br>[notice.historyClearFailed](../src/i18n/index.tsx#L669) | 无法清空笔记历史 | Unable to clear note history | 無法清空筆記歷史 | **兜底·严重通知**：清空当前笔记或账户全部历史失败。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L2003) |
| F11<br>[history.restoreMissingAttachments](../src/i18n/index.tsx#L644) | 有 {count} 个引用附件不可用，仍然只恢复文本吗？ | {count} referenced attachments are unavailable. Restore the text anyway? | 有 {count} 個引用附件無法使用，仍然只復原文字嗎？ | **确认提示**：恢复覆盖当前笔记前发现引用附件不可用，询问是否只恢复文本。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L2049) |
| F12<br>[notice.historyRestoreFailed](../src/i18n/index.tsx#L671) | 无法恢复这个历史版本 | Unable to restore this history version | 無法復原這個歷史版本 | **兜底·严重通知**：把历史正文恢复为当前笔记失败。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L2076) |
| F13<br>[notice.historyCopyFailed](../src/i18n/index.tsx#L673) | 无法将历史版本恢复为副本 | Unable to restore the history version as a copy | 無法將歷史版本復原為副本 | **兜底·严重通知**：将历史恢复为新笔记副本（含附件复制）失败。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L2105) |
| F14<br>[notice.historyQuotaReached](../src/i18n/index.tsx#L674) | 加密历史配额已用尽；释放空间前将暂停自动历史同步。 | The encrypted history quota is full. Automatic history is paused until space is freed. | 加密歷史配額已用盡；釋放空間前將暫停自動歷史同步。 | **警告**：上传历史收到 413，且错误为 Note history quota exceeded；首次进入配额暂停状态时提示。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L876) |
| F15<br>[notice.historySettingsLoadFailed](../src/i18n/index.tsx#L676) | 无法加载笔记历史设置 | Unable to load note history settings | 無法載入筆記歷史設定 | **兜底·警告**：设置页加载历史配置失败。<br>[入口](../src/features/SettingsPanel.tsx#L165) |
| F16<br>[notice.historySettingsSaveFailed](../src/i18n/index.tsx#L677) | 无法保存笔记历史设置 | Unable to save note history settings | 無法儲存筆記歷史設定 | **兜底·警告**：设置页保存历史配置失败。<br>[入口](../src/features/SettingsPanel.tsx#L203) |
| F17<br>[notice.historyNameRequired](../src/i18n/index.tsx#L678) | 历史版本名称不能为空。 | History names cannot be empty. | 歷史版本名稱不能為空。 | **警告**：手动修改历史名称，去除首尾空白后为空。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1900) |
| F18<br>[notice.historyUpdateFailed](../src/i18n/index.tsx#L679) | 无法更新历史版本 | Unable to update the history version | 無法更新歷史版本 | **兜底·严重通知**：更新历史名称或保护状态失败。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1933) |
| F19<br>[notice.historyProtectedMissingAttachments](../src/i18n/index.tsx#L684) | 历史版本已保护，但其中 {count} 个引用附件此前已经不可用。 | Protected this version, but {count} referenced attachments were already unavailable. | 歷史版本已保護，但其中 {count} 個引用附件先前已無法使用。 | **严重通知**：保护历史时发现部分引用附件已经缺失或无效；保护操作保留，但提示缺失数量。<br>[入口](../src/features/vault/VaultWorkspace.tsx#L1909) |

## G · 管理员操作的兜底提示

| 编号／文案键 | 简体中文 | English | 繁體中文 | 出现情况 |
| --- | --- | --- | --- | --- |
| G01<br>[admin.loadFailed](../src/i18n/index.tsx#L417) | 无法加载管理员设置 | Unable to load administrator settings | 無法載入管理員設定 | **兜底·警告**：加载用户、激活资格及管理员配置失败。<br>[入口](../src/features/AdminPanel.tsx#L46) |
| G02<br>[admin.createFailed](../src/i18n/index.tsx#L419) | 无法创建用户 | Unable to create user | 無法建立使用者 | **兜底·警告**：创建待激活账户／生成激活资格失败。<br>[入口](../src/features/AdminPanel.tsx#L57) |
| G03<br>[admin.updateFailed](../src/i18n/index.tsx#L422) | 无法更新用户状态 | Unable to update user status | 無法更新使用者狀態 | **兜底·警告**：启用或禁用用户失败。<br>[入口](../src/features/AdminPanel.tsx#L68) |
| G04<br>[admin.cancelFailed](../src/i18n/index.tsx#L424) | 无法取消激活资格 | Unable to cancel activation eligibility | 無法取消啟用資格 | **兜底·警告**：取消待使用的激活资格失败。<br>[入口](../src/features/AdminPanel.tsx#L80) |
| G05<br>[admin.deleteFailed](../src/i18n/index.tsx#L426) | 无法删除用户 | Unable to delete user | 無法刪除使用者 | **兜底·警告**：管理员永久删除用户失败。<br>[入口](../src/features/AdminPanel.tsx#L96) |

## H · 服务端返回的具体错误

| 编号／文案键 | 简体中文 | English | 繁體中文 | 出现情况 |
| --- | --- | --- | --- | --- |
| H01<br>[api.crossOrigin](../src/i18n/index.tsx#L699) | 已拒绝跨来源状态变更 | Cross-origin state change rejected | 已拒絕跨來源狀態變更 | **API 错误**：状态变更请求的 Origin 与允许来源不符；缺少 Origin 的错误目前未翻译，见 J。<br>[入口](../server/auth/originProtection.ts#L25) |
| H02<br>[api.authRequired](../src/i18n/index.tsx#L700) | 需要登录 | Authentication required | 需要登入 | **API 错误**：受保护接口没有有效会话 Cookie／会话凭据。<br>[入口](../server/auth/sessionService.ts#L53) |
| H03<br>[api.sessionInvalid](../src/i18n/index.tsx#L701) | 登录会话已失效 | Session is no longer valid | 登入工作階段已失效 | **API 错误**：会话不存在、已过期／撤销，或对应用户／端点不再有效；401 还可能触发清理会话并返回登录页。<br>[入口](../server/auth/sessionService.ts#L83) |
| H04<br>[api.adminRequired](../src/i18n/index.tsx#L702) | 需要管理员权限 | Administrator access required | 需要管理員權限 | **API 错误**：非管理员访问管理员接口。<br>[入口](../server/auth/sessionService.ts#L124) |
| H05<br>[api.invalidRegistration](../src/i18n/index.tsx#L703) | 注册资料无效 | Invalid registration data | 註冊資料無效 | **API 错误**：注册请求字段校验或保险库密钥封装绑定校验不通过。<br>[入口](../server/routes.ts#L160) |
| H06<br>[api.registrationClosed](../src/i18n/index.tsx#L704) | 注册已关闭 | Registration is closed | 註冊已關閉 | **API 错误**：服务器已有账户且关闭公开注册，仍提交普通注册。<br>[入口](../server/routes.ts#L174) |
| H07<br>[api.usernameReserved](../src/i18n/index.tsx#L705) | 该用户名已预留给账户激活 | Username is reserved for account activation | 該使用者名稱已保留給帳戶啟用 | **API 错误**：普通注册的用户名已被有效的待激活账户预留。<br>[入口](../server/routes.ts#L175) |
| H08<br>[api.usernameUnavailable](../src/i18n/index.tsx#L706) | 用户名不可用 | Username is unavailable | 使用者名稱不可用 | **API 错误**：注册、激活、改用户名或创建激活资格时用户名已占用／不可用。<br>[入口1](../server/routes.ts#L176)；[入口2](../server/admin/routes.ts#L84) |
| H09<br>[api.invalidActivation](../src/i18n/index.tsx#L707) | 账户激活资料无效 | Invalid account activation | 帳戶啟用資料無效 | **API 错误**：激活注册请求字段或密钥封装绑定不合法。<br>[入口](../server/routes.ts#L193) |
| H10<br>[api.activationInvalid](../src/i18n/index.tsx#L708) | 激活码无效或已过期 | Activation code is invalid or expired | 啟用碼無效或已過期 | **API 错误**：激活资格未找到、不匹配、已使用／取消或已过期。<br>[入口](../server/routes.ts#L200) |
| H11<br>[api.accountNotFound](../src/i18n/index.tsx#L709) | 未找到账户 | Account not found | 找不到帳戶 | **API 错误**：登录／恢复／解锁获取账户参数时，用户名参数不合法或账户不存在。<br>[入口](../server/routes.ts#L221) |
| H12<br>[api.invalidCredentials](../src/i18n/index.tsx#L710) | 用户名或密码不正确 | Invalid credentials | 使用者名稱或密碼不正確 | **API 错误**：登录或重新验证请求无效，或账号／认证凭据校验失败；主密码解锁也可能显示这一条。<br>[入口](../server/routes.ts#L248) |
| H13<br>[api.invalidRecovery](../src/i18n/index.tsx#L711) | 密码恢复请求无效 | Invalid recovery request | 密碼復原請求無效 | **API 错误**：恢复主密码的请求结构／参数不合法。<br>[入口](../server/routes.ts#L327) |
| H14<br>[api.recoveryFailed](../src/i18n/index.tsx#L712) | 密码恢复失败 | Recovery failed | 密碼復原失敗 | **API 错误**：恢复请求中的账户或恢复认证凭据无法通过校验。<br>[入口](../server/routes.ts#L331) |
| H15<br>[api.invalidPasswordChange](../src/i18n/index.tsx#L713) | 密码修改请求无效 | Invalid password change | 密碼變更請求無效 | **API 错误**：修改主密码请求参数校验失败。<br>[入口](../server/routes.ts#L361) |
| H16<br>[api.currentPasswordIncorrect](../src/i18n/index.tsx#L714) | 当前密码不正确 | Current password is incorrect | 目前密碼不正確 | **API 错误**：修改主密码、重置恢复密钥、改用户名或管理员删除账户时，当前密码认证失败。<br>[入口1](../server/routes.ts#L365)；[入口2](../server/admin/routes.ts#L177) |
| H17<br>[api.invalidRecoveryReset](../src/i18n/index.tsx#L715) | 恢复密钥重置请求无效 | Invalid recovery key reset | 復原金鑰重設請求無效 | **API 错误**：重置恢复密钥的请求参数校验失败。<br>[入口](../server/routes.ts#L399) |
| H18<br>[api.invalidUsernameChange](../src/i18n/index.tsx#L716) | 用户名修改请求无效 | Invalid username change | 使用者名稱變更請求無效 | **API 错误**：用户名变更请求或其密钥绑定、重新封装信息校验失败。<br>[入口](../server/routes.ts#L441) |
| H19<br>[api.recoveryKeyIncorrect](../src/i18n/index.tsx#L717) | 恢复密钥不正确 | Recovery key is incorrect | 復原金鑰不正確 | **API 错误**：改用户名时，恢复密钥认证失败。<br>[入口](../server/routes.ts#L456) |
| H20<br>[api.usernameUnchanged](../src/i18n/index.tsx#L718) | 用户名没有变化 | Username is unchanged | 使用者名稱沒有變更 | **API 错误**：改用户名提交值与当前用户名相同。<br>[入口](../server/routes.ts#L461) |
| H21<br>[api.invalidProfile](../src/i18n/index.tsx#L719) | 个人资料无效 | Invalid profile | 個人資料無效 | **API 错误**：更新显示名称等个人资料请求校验失败。<br>[入口](../server/routes.ts#L508) |
| H22<br>[api.invalidAvatar](../src/i18n/index.tsx#L720) | 加密头像无效 | Invalid encrypted avatar | 加密頭像無效 | **API／本地错误**：服务端头像密文请求校验失败；客户端解密头像后结构／格式非法也使用同一原始错误及翻译。<br>[入口1](../src/crypto/crypto.worker.ts#L339)；[入口2](../server/routes.ts#L538) |
| H23<br>[api.invalidTrashRetention](../src/i18n/index.tsx#L721) | 回收站保留设置无效 | Invalid trash retention | 垃圾桶保留設定無效 | **API 错误**：回收站保留时长请求校验失败。<br>[入口](../server/routes.ts#L565) |
| H24<br>[api.invalidHistorySettings](../src/i18n/index.tsx#L722) | 笔记历史设置无效 | Invalid note history settings | 筆記歷史設定無效 | **API 错误**：历史设置请求校验失败。<br>[入口](../server/history/routes.ts#L136) |
| H25<br>[api.invalidHistoryRequest](../src/i18n/index.tsx#L723) | 笔记历史请求无效 | Invalid note history request | 筆記歷史請求無效 | **API 错误**：请求历史列表时，笔记 ID、查询参数或分页游标无效。<br>[入口](../server/history/routes.ts#L160) |
| H26<br>[api.invalidEncryptedHistory](../src/i18n/index.tsx#L724) | 加密笔记历史无效 | Invalid encrypted note history | 加密筆記歷史無效 | **API 错误**：上传历史时，路径参数或加密历史数据校验失败。<br>[入口](../server/history/routes.ts#L217) |
| H27<br>[api.noteNotFound](../src/i18n/index.tsx#L725) | 未找到笔记 | Note not found | 找不到筆記 | **API 错误**：查询、上传或清除历史时，所属笔记不存在；列表加载入口对 404 不弹错误通知。<br>[入口](../server/history/routes.ts#L168) |
| H28<br>[api.historyNotFound](../src/i18n/index.tsx#L726) | 未找到历史版本 | History snapshot not found | 找不到歷史版本 | **API 错误**：读取、更新或删除历史时，目标历史不存在或路径 ID 不合法。<br>[入口](../server/history/routes.ts#L334) |
| H29<br>[api.historyCleared](../src/i18n/index.tsx#L727) | 历史版本已被清除 | History snapshot was cleared | 歷史版本已被清除 | **API 错误**：上传的历史早于服务端已清空历史的边界；后台历史同步会处理这一状态，不一定弹通知。<br>[入口](../server/history/routes.ts#L263) |
| H30<br>[api.historyExists](../src/i18n/index.tsx#L728) | 历史版本已存在 | History snapshot already exists | 歷史版本已存在 | **API 错误**：历史快照 ID 已存在但不是可接受的幂等重试。<br>[入口](../server/history/routes.ts#L302) |
| H31<br>[api.historyQuota](../src/i18n/index.tsx#L729) | 笔记历史配额已用尽 | Note history quota exceeded | 筆記歷史配額已用盡 | **API 错误**：新增／更新历史后超过历史存储配额；后台上传常转换为 notice.historyQuotaReached。<br>[入口](../server/history/routes.ts#L273) |
| H32<br>[api.protectedHistory](../src/i18n/index.tsx#L730) | 受保护的历史版本阻止了此操作 | Protected history blocks this operation | 受保護的歷史版本阻止了此操作 | **API 错误**：删除受保护历史，或永久清除笔记／附件被受保护历史阻止；两种原始错误共用此翻译。<br>[入口1](../server/history/routes.ts#L416)；[入口2](../server/sync/routes.ts#L271) |
| H33<br>[api.endpointNotFound](../src/i18n/index.tsx#L731) | 未找到设备 | Endpoint not found | 找不到裝置 | **API 错误**：删除／撤销的设备记录不存在、不属于当前用户或 ID 不合法。<br>[入口](../server/account/endpoints.ts#L103) |
| H34<br>[api.endpointTooNew](../src/i18n/index.tsx#L732) | 当前设备登录满 24 小时后才能执行此操作 | Current endpoint must be at least 24 hours old | 目前裝置登入滿 24 小時後才能執行此操作 | **API 错误**：撤销另一台仍有效的设备时，当前端点首次登录未满 24 小时；清理失效设备记录不受此限制。<br>[入口](../server/account/endpoints.ts#L136) |
| H35<br>[api.logoutCurrentEndpoint](../src/i18n/index.tsx#L733) | 请使用登出结束当前设备会话 | Use logout to end the current endpoint | 請使用登出結束目前裝置工作階段 | **API 错误**：试图通过设备管理接口撤销当前设备。<br>[入口](../server/account/endpoints.ts#L107) |
| H36<br>[api.invalidSyncEvent](../src/i18n/index.tsx#L735) | 同步事件请求无效 | Invalid synchronization event request | 同步事件請求無效 | **API 错误**：建立同步事件流时，请求参数校验失败；SSE 错误通常走重连，不保证以通知显示。<br>[入口](../server/sync/routes.ts#L30) |
| H37<br>[api.invalidEncryptedObject](../src/i18n/index.tsx#L736) | 加密对象无效 | Invalid encrypted object | 加密物件無效 | **API 错误**：上传单个同步对象时，ID 或请求内容校验失败。<br>[入口](../server/sync/routes.ts#L130) |
| H38<br>[api.invalidEncryptedObjectBatch](../src/i18n/index.tsx#L737) | 批量加密对象无效 | Invalid encrypted object batch | 批次加密物件無效 | **API 错误**：批量上传同步对象的请求校验失败。<br>[入口](../server/sync/routes.ts#L176) |
| H39<br>[api.invalidPurge](../src/i18n/index.tsx#L738) | 永久删除请求无效 | Invalid purge request | 永久刪除請求無效 | **API 错误**：永久清除请求的对象及基础修订参数校验失败。<br>[入口](../server/sync/routes.ts#L234) |
| H40<br>[api.objectTypeChange](../src/i18n/index.tsx#L739) | 对象类型不能更改 | Object type cannot change | 物件類型不能變更 | **API 错误**：同步写入尝试更改现有对象的类型。<br>[入口](../server/sync/routes.ts#L152) |
| H41<br>[api.revisionConflict](../src/i18n/index.tsx#L740) | 版本冲突 | Revision conflict | 版本衝突 | **API 错误**：同步对象的基础修订与服务器现状冲突；客户端可能转入冲突处理并显示冲突副本通知。<br>[入口](../server/sync/routes.ts#L154) |
| H42<br>[api.purgeConflict](../src/i18n/index.tsx#L741) | 永久删除发生冲突 | Purge conflict | 永久刪除發生衝突 | **API 错误**：永久清除时对象不存在、已不在删除状态或修订已改变。<br>[入口](../server/sync/routes.ts#L263) |
| H43<br>[api.invalidAttachmentChunk](../src/i18n/index.tsx#L742) | 加密附件分块无效 | Invalid encrypted attachment chunk | 加密附件分塊無效 | **API 错误**：上传附件分块时，ID、分块参数或请求头校验失败。<br>[入口](../server/attachments/routes.ts#L34) |
| H44<br>[api.attachmentTooLarge](../src/i18n/index.tsx#L743) | 附件分块过大 | Attachment chunk is too large | 附件分塊過大 | **API 错误**：附件分块请求体为空、不是缓冲区或超出服务端分块大小限制。<br>[入口](../server/attachments/routes.ts#L37) |
| H45<br>[api.attachmentExists](../src/i18n/index.tsx#L744) | 附件分块已存在 | Attachment chunk already exists | 附件分塊已存在 | **API 错误**：上传的附件分块已存在，且未通过幂等重试处理。<br>[入口](../server/attachments/routes.ts#L73) |
| H46<br>[api.attachmentNotFound](../src/i18n/index.tsx#L745) | 未找到附件分块 | Attachment chunk not found | 找不到附件分塊 | **API 错误**：下载分块时路径参数不合法或当前用户没有该分块。<br>[入口](../server/attachments/routes.ts#L111) |
| H47<br>[api.quotaExceeded](../src/i18n/index.tsx#L746) | 用户存储配额已用尽 | User storage quota exceeded | 使用者儲存配額已用盡 | **API 错误**：同步对象或上传附件分块后超过用户存储配额。<br>[入口1](../server/sync/objectStore.ts#L41)；[入口2](../server/attachments/routes.ts#L85) |
| H48<br>[api.invalidUserSetup](../src/i18n/index.tsx#L747) | 用户激活资料无效 | Invalid user setup | 使用者啟用資料無效 | **API 错误**：管理员创建激活资格时，请求参数无效。<br>[入口](../server/admin/routes.ts#L78) |
| H49<br>[api.setupNotFound](../src/i18n/index.tsx#L748) | 未找到账户激活资料 | Account setup not found | 找不到帳戶啟用資料 | **API 错误**：取消激活资格时，该记录不存在或 ID 无效。<br>[入口](../server/admin/routes.ts#L119) |
| H50<br>[api.invalidUserUpdate](../src/i18n/index.tsx#L749) | 用户更新请求无效 | Invalid user update | 使用者更新請求無效 | **API 错误**：管理员启用／禁用账户时，目标 ID 或请求参数无效。<br>[入口](../server/admin/routes.ts#L132) |
| H51<br>[api.cannotDisableSelf](../src/i18n/index.tsx#L750) | 不能禁用自己的账户 | You cannot disable your own account | 不能停用自己的帳戶 | **API 错误**：管理员尝试禁用自己的账户。<br>[入口](../server/admin/routes.ts#L134) |
| H52<br>[api.userNotFound](../src/i18n/index.tsx#L751) | 未找到用户 | User not found | 找不到使用者 | **API 错误**：管理员更新或删除用户时，目标不存在。<br>[入口](../server/admin/routes.ts#L138) |
| H53<br>[api.invalidUserDeletion](../src/i18n/index.tsx#L752) | 用户删除请求无效 | Invalid user deletion | 使用者刪除請求無效 | **API 错误**：管理员删除用户时，目标 ID 或确认参数无效。<br>[入口](../server/admin/routes.ts#L165) |
| H54<br>[api.cannotDeleteSelf](../src/i18n/index.tsx#L753) | 不能删除自己的账户 | You cannot delete your own account | 不能刪除自己的帳戶 | **API 错误**：管理员尝试删除自己的账户。<br>[入口](../server/admin/routes.ts#L168) |
| H55<br>[api.usernameMismatch](../src/i18n/index.tsx#L754) | 确认用户名不匹配 | Username confirmation does not match | 確認使用者名稱不相符 | **API 错误**：管理员删除用户时，输入的确认用户名与目标用户不一致。<br>[入口](../server/admin/routes.ts#L184) |
| H56<br>[api.lastAdmin](../src/i18n/index.tsx#L755) | 不能删除最后一位管理员 | The last administrator cannot be deleted | 不能刪除最後一位管理員 | **API 错误**：管理员删除操作会移除最后一个管理员。<br>[入口](../server/admin/routes.ts#L191) |

## I · 已定义但当前未找到触发入口

| 编号／文案键 | 简体中文 | English | 繁體中文 | 出现情况 |
| --- | --- | --- | --- | --- |
| I01<br>[notice.usernameUnchanged](../src/i18n/index.tsx#L357) | 请输入不同的用户名 | Enter a different username | 請輸入不同的使用者名稱 | **未使用**：翻译表中存在，但业务源码未引用；当前“用户名没有变化”来自 api.usernameUnchanged。 |
| I02<br>[api.endpointAlreadySignedOut](../src/i18n/index.tsx#L734) | 该设备已经登出 | Endpoint is already signed out | 該裝置已經登出 | **未使用**：错误映射存在，但当前服务端未返回 Endpoint is already signed out；失效设备记录走移除逻辑。 |

