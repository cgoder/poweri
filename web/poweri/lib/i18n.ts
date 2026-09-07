import type { Locale } from "@/lib/i18n/types";
export type { Locale };

export const poweriMessages: Record<string, Record<Locale, string>> = {
  "appUpdate.upgradeTo": {
    "en": "PowerI v{version} is available. Click to upgrade",
    "zh-CN": "PowerI v{version} 可用，点击升级",
    "zh-TW": "PowerI v{version} 可用，點擊升級",
  },
  "appUpdate.upgrading": {
    "en": "Upgrading…",
    "zh-CN": "正在升级…",
    "zh-TW": "正在升級…",
  },
  "appUpdate.upgradeShort": {
    "en": "Update",
    "zh-CN": "升级",
    "zh-TW": "升級",
  },
  "appUpdate.upgradeFailed": {
    "en": "Update failed — click to retry",
    "zh-CN": "升级失败，可重试",
    "zh-TW": "升級失敗，可重試",
  },
  "appUpdate.installed": {
    "en": "v{version} installed (next start)",
    "zh-CN": "已安装 v{version}，下次启动生效",
    "zh-TW": "已安裝 v{version}，下次啟動生效",
  },
  // ---- 设置 → 通用 → 版本与更新（VersionUpdateSection） ----
  "appUpdate.sectionTitle": {
    "en": "Version & Updates",
    "zh-CN": "版本与更新",
    "zh-TW": "版本與更新",
  },
  "appUpdate.upToDate": {
    "en": "Up to date",
    "zh-CN": "已是最新版本",
    "zh-TW": "已是最新版本",
  },
  "appUpdate.checking": {
    "en": "Checking for updates…",
    "zh-CN": "正在检查更新…",
    "zh-TW": "正在檢查更新…",
  },
  "appUpdate.newVersion": {
    "en": "New version {version} available",
    "zh-CN": "发现新版本 {version}",
    "zh-TW": "發現新版本 {version}",
  },
  "appUpdate.checkNow": {
    "en": "Check for updates",
    "zh-CN": "检查更新",
    "zh-TW": "檢查更新",
  },
  "appUpdate.upgradeToVersion": {
    "en": "Upgrade to v{version}",
    "zh-CN": "升级到 {version}",
    "zh-TW": "升級到 {version}",
  },
  "appUpdate.downloading": {
    "en": "Downloading and installing…",
    "zh-CN": "正在下载安装…",
    "zh-TW": "正在下載安裝…",
  },
  "appUpdate.restarting": {
    "en": "Restarting service…",
    "zh-CN": "正在重启服务…",
    "zh-TW": "正在重啟服務…",
  },
  "appUpdate.reloading": {
    "en": "Service ready — reloading page…",
    "zh-CN": "服务已就绪，正在刷新页面…",
    "zh-TW": "服務已就緒，正在刷新頁面…",
  },
  "appUpdate.autoRestartNote": {
    "en": "The service restarts and the page reloads automatically",
    "zh-CN": "升级完成后自动重启服务并刷新页面",
    "zh-TW": "升級完成後自動重啟服務並刷新頁面",
  },
  "appUpdate.browserNoInApp": {
    "en": "In-app upgrade is unavailable in browser mode. To upgrade manually:",
    "zh-CN": "浏览器模式不支持应用内升级。手动升级：",
    "zh-TW": "瀏覽器模式不支援應用內升級。手動升級：",
  },
  "appUpdate.browserTakesEffect": {
    "en": "Takes effect after restarting the service",
    "zh-CN": "升级后重启服务生效",
    "zh-TW": "升級後重啟服務生效",
  },
  "appUpdate.devModeNote": {
    "en": "Dev mode — update checks are disabled",
    "zh-CN": "开发模式，不检查更新",
    "zh-TW": "開發模式，不檢查更新",
  },
  "appUpdate.cannotUpgrade": {
    "en": "This installation cannot be upgraded in-app",
    "zh-CN": "当前安装方式不支持应用内升级",
    "zh-TW": "當前安裝方式不支援應用內升級",
  },
  "appUpdate.lastChecked": {
    "en": "{time} checked",
    "zh-CN": "{time}检查",
    "zh-TW": "{time}檢查",
  },
  "appUpdate.upgradeFailedShort": {
    "en": "Upgrade failed",
    "zh-CN": "升级失败",
    "zh-TW": "升級失敗",
  },
  "appUpdate.copyCommand": {
    "en": "Copy",
    "zh-CN": "复制",
    "zh-TW": "複製",
  },
  "appUpdate.reloadTimeout": {
    "en": "Service restart timed out — reload the page manually",
    "zh-CN": "重启服务超时，请稍后手动刷新页面",
    "zh-TW": "重啟服務超時，請稍後手動刷新頁面",
  },
  "appUpdate.checkFailed": {
    "en": "Update check failed",
    "zh-CN": "检查更新失败",
    "zh-TW": "檢查更新失敗",
  },
  "fileOpen.missing": {
    "en": "File not found: {name}",
    "zh-CN": "文件不存在：{name}",
    "zh-TW": "檔案不存在：{name}",
  },
  "fileOpen.denied": {
    "en": "File is outside the workspace and cannot be opened: {name}",
    "zh-CN": "文件在工作区外，无法打开：{name}",
    "zh-TW": "檔案在工作區外，無法開啟：{name}",
  },
  "fileOpen.ambiguous": {
    "en": "Multiple files with the same name, not opened automatically:\n{candidates}",
    "zh-CN": "找到多个同名文件，未自动打开：\n{candidates}",
    "zh-TW": "找到多個同名檔案，未自動開啟：\n{candidates}",
  },
  "common.data": {
    "en": "Data",
    "zh-CN": "数据",
    "zh-TW": "數據",
  },
  "common.settings": {
    "en": "Settings",
    "zh-CN": "设置",
    "zh-TW": "設定",
  },
  "usage.openDetails": {
    "en": "Open Data Details",
    "zh-CN": "打开数据详情",
    "zh-TW": "打開數據詳情",
  },
  "stats.currentSession": {
    "en": "Current Session",
    "zh-CN": "当前会话",
    "zh-TW": "當前會話",
  },
  "stats.historySessions": {
    "en": "History",
    "zh-CN": "历史会话",
    "zh-TW": "歷史會話",
  },
  "stats.globalStats": {
    "en": "Global Stats",
    "zh-CN": "全局统计",
    "zh-TW": "全局統計",
  },
  "stats.byDay": {
    "en": "By Day",
    "zh-CN": "按天",
    "zh-TW": "按天",
  },
  "stats.byWorkspace": {
    "en": "By Workspace",
    "zh-CN": "按工作区",
    "zh-TW": "按工作區",
  },
  "stats.allSessions": {
    "en": "All Sessions ({count}) · Click row to view details",
    "zh-CN": "全部会话（{count} 个）· 点击行查看详情",
    "zh-TW": "全部會話（{count} 個）· 點擊行查看詳情",
  },
  "stats.sessionsCount": {
    "en": "{count} sessions",
    "zh-CN": "{count} 个会话",
    "zh-TW": "{count} 個會話",
  },
  "stats.cacheHit": {
    "en": "Cache hit {rate}%",
    "zh-CN": "缓存命中 {rate}%",
    "zh-TW": "緩存命中 {rate}%",
  },
  "stats.user": {
    "en": "User",
    "zh-CN": "用户",
    "zh-TW": "使用者",
  },
  "stats.assistant": {
    "en": "Assistant",
    "zh-CN": "助手",
    "zh-TW": "助手",
  },
  "stats.toolCalls": {
    "en": "Tool Calls",
    "zh-CN": "工具调用",
    "zh-TW": "工具調用",
  },
  "stats.toolResults": {
    "en": "Tool Results",
    "zh-CN": "工具结果",
    "zh-TW": "工具結果",
  },
  "stats.input": {
    "en": "Input",
    "zh-CN": "输入",
    "zh-TW": "輸入",
  },
  "stats.output": {
    "en": "Output",
    "zh-CN": "输出",
    "zh-TW": "輸出",
  },
  "stats.cacheRead": {
    "en": "Cache Read",
    "zh-CN": "缓存读取",
    "zh-TW": "緩存讀取",
  },
  "stats.cacheWrite": {
    "en": "Cache Write",
    "zh-CN": "缓存写入",
    "zh-TW": "緩存寫入",
  },
  "stats.total": {
    "en": "Total",
    "zh-CN": "总计",
    "zh-TW": "總計",
  },
  "stats.sessionInfo": {
    "en": "Session Info",
    "zh-CN": "会话信息",
    "zh-TW": "會話資訊",
  },
  "stats.name": {
    "en": "Name",
    "zh-CN": "名称",
    "zh-TW": "名稱",
  },
  "stats.file": {
    "en": "File",
    "zh-CN": "文件",
    "zh-TW": "檔案",
  },
  "stats.inMemory": {
    "en": "(In-memory)",
    "zh-CN": "（内存中）",
    "zh-TW": "（記憶體中）" },
  "stats.activeTime": {
    "en": "Active Time",
    "zh-CN": "活跃时长",
    "zh-TW": "活躍時長",
  },
  "stats.messages": {
    "en": "Messages",
    "zh-CN": "消息",
    "zh-TW": "訊息",
  },
  "stats.tokens": {
    "en": "Tokens",
    "zh-CN": "Token",
    "zh-TW": "Token",
  },
  "stats.cost": {
    "en": "Cost",
    "zh-CN": "费用",
    "zh-TW": "費用",
  },
  "stats.context": {
    "en": "Context",
    "zh-CN": "上下文",
    "zh-TW": "上下文",
  },
  "stats.avgHitRate": {
    "en": "Avg cache hit rate",
    "zh-CN": "平均缓存命中率",
    "zh-TW": "平均緩存命中率",
  },
  "stats.loadingInfo": {
    "en": "Loading session info...",
    "zh-CN": "加载会话信息…",
    "zh-TW": "載入會話資訊…",
  },
  "stats.loadFailed": {
    "en": "Failed to load",
    "zh-CN": "加载失败",
    "zh-TW": "載入失敗",
  },
  "skills.title": {
    "en": "Skills",
    "zh-CN": "技能",
    "zh-TW": "技能",
  },
  "skills.subtitle": {
    "en": "Configure and manage available skills across business and public sources.",
    "zh-CN": "配置与管理可用技能，支持业务私有源与公共精选源。",
    "zh-TW": "配置與管理可用技能，支援業務私有源與公共精選源。",
  },
  "skills.tabBusiness": {
    "en": "Business Skills",
    "zh-CN": "业务技能",
    "zh-TW": "業務技能",
  },
  "skills.tabPublic": {
    "en": "Public Skills",
    "zh-CN": "公共技能",
    "zh-TW": "公共技能",
  },
  "skills.tabAll": {
    "en": "All",
    "zh-CN": "全部",
    "zh-TW": "全部",
  },
  "skills.manageSubscriptions": {
    "en": "Manage Sources ({count})",
    "zh-CN": "管理订阅源 ({count})",
    "zh-TW": "管理訂閱源 ({count})",
  },
  "skills.collapseSubscriptions": {
    "en": "Collapse Sources",
    "zh-CN": "收起订阅源",
    "zh-TW": "收起訂閱源",
  },
  "skills.inputPlaceholder": {
    "en": "Git repo URL or Manifest JSON URL...",
    "zh-CN": "粘贴 Git 仓库 (如 https://.../skills.git) 或 Manifest URL",
    "zh-TW": "貼上 Git 倉庫或 Manifest URL",
  },
  "skills.namePlaceholder": {
    "en": "Source display name (optional)",
    "zh-CN": "源名称备注（可选）",
    "zh-TW": "源名稱備註（可選）",
  },
  "skills.tokenPlaceholder": {
    "en": "Token (optional for private repo)",
    "zh-CN": "私有仓库 Token（可选）",
    "zh-TW": "私有倉庫 Token（可選）",
  },
  "skills.sourceCategory": {
    "en": "Category",
    "zh-CN": "分类",
    "zh-TW": "分類",
  },
  "skills.categoryBusiness": {
    "en": "Business Source",
    "zh-CN": "业务源",
    "zh-TW": "業務源",
  },
  "skills.categoryPublic": {
    "en": "Public Source",
    "zh-CN": "公共源",
    "zh-TW": "公共源",
  },
  "skills.addSource": {
    "en": "Add Source",
    "zh-CN": "添加订阅",
    "zh-TW": "新增訂閱",
  },
  "skills.syncing": {
    "en": "Syncing...",
    "zh-CN": "同步中...",
    "zh-TW": "同步中...",
  },
  "skills.subscribedSources": {
    "en": "Subscribed Sources:",
    "zh-CN": "已订阅的技能源：",
    "zh-TW": "已訂閱的技能源：",
  },
  "skills.remove": {
    "en": "Remove",
    "zh-CN": "移除",
    "zh-TW": "移除",
  },
  "skills.searchPlaceholder": {
    "en": "Search skills, descriptions, or tags...",
    "zh-CN": "搜索技能名称、场景说明或标签...",
    "zh-TW": "搜尋技能名稱、場景說明或標籤...",
  },
  "skills.loading": {
    "en": "Loading and syncing skills...",
    "zh-CN": "正在加载并同步技能源...",
    "zh-TW": "正在加載並同步技能源...",
  },
  "skills.loadFailed": {
    "en": "Load failed: {error}",
    "zh-CN": "加载失败: {error}",
    "zh-TW": "加載失敗: {error}",
  },
  "skills.noMatch": {
    "en": "No matching skills found",
    "zh-CN": "没有匹配的技能",
    "zh-TW": "沒有匹配的技能",
  },
  "skills.empty": {
    "en": "No skills available. Click 'Manage Sources' to add a source.",
    "zh-CN": "暂无可用技能，请点击右上角「管理订阅源」添加技能仓库链接",
    "zh-TW": "暫無可用技能，請點擊右上角「管理訂閱源」新增倉庫連結",
  },
  "skills.badgeBusiness": {
    "en": "Business",
    "zh-CN": "业务",
    "zh-TW": "業務",
  },
  "skills.badgePublic": {
    "en": "Public",
    "zh-CN": "公共",
    "zh-TW": "公共",
  },
  "skills.sourceGit": {
    "en": "Git Source",
    "zh-CN": "Git 仓库",
    "zh-TW": "Git 倉庫",
  },
  "skills.sourceManifest": {
    "en": "Manifest Source",
    "zh-CN": "清单配置",
    "zh-TW": "清單配置",
  },
  "skills.sourceLocal": {
    "en": "Local Extension",
    "zh-CN": "本地扩展",
    "zh-TW": "本地擴展",
  },
  "skills.noDescription": {
    "en": "No description available",
    "zh-CN": "暂无场景描述",
    "zh-TW": "暫無場景描述",
  },
  "skills.allCapsule": {
    "en": "All",
    "zh-CN": "全部",
    "zh-TW": "全部",
  },
  "skills.addSourceTitle": {
    "en": "Add Repository Source",
    "zh-CN": "添加技能仓库源",
    "zh-TW": "新增技能倉庫源",
  },
  "skills.editSourceTitle": {
    "en": "Configure Repository Source",
    "zh-CN": "配置技能仓库源",
    "zh-TW": "設定技能倉庫源",
  },
  "skills.deleteSource": {
    "en": "Delete Source",
    "zh-CN": "删除该源",
    "zh-TW": "刪除該源",
  },
  "skills.sourceUrlLabel": {
    "en": "Repository / Manifest URL",
    "zh-CN": "仓库地址 / 清单 URL",
    "zh-TW": "倉庫位址 / 清單 URL",
  },
  "skills.sourceAliasLabel": {
    "en": "Source Alias Name (Optional)",
    "zh-CN": "仓库别名（可选）",
    "zh-TW": "倉庫別名（選填）",
  },
  "skills.sourceTokenLabel": {
    "en": "Access Token (GitLab PAT / Private token)",
    "zh-CN": "访问令牌（GitLab PAT / 私有源 Token）",
    "zh-TW": "存取權杖（GitLab PAT / 私有源 Token）",
  },
  "skills.sourceTokenPlaceholder": {
    "en": "glpat-... / ghp-...",
    "zh-CN": "glpat-... / ghp-...",
    "zh-TW": "glpat-... / ghp-...",
  },
  "skills.sourceTokenLeaveBlank": {
    "en": "Configured — leave blank to keep",
    "zh-CN": "已配置，留空则不修改",
    "zh-TW": "已設定，留空則不修改",
  },
  "skills.updateAvailable": {
    "en": "Update available",
    "zh-CN": "可更新",
    "zh-TW": "可更新",
  },
  "skills.conflictBadge": {
    "en": "Conflict",
    "zh-CN": "冲突",
    "zh-TW": "衝突",
  },
  "skills.conflictTitle": {
    "en": "Local changes detected — resolve before updating",
    "zh-CN": "本地有改动，更新需先处理冲突",
    "zh-TW": "本地有改動，更新需先處理衝突",
  },
  "skills.conflictNotice": {
    "en": "Local changes detected (drifted from baseline). Choose how to proceed:",
    "zh-CN": "本地有改动（偏离基线），请选择处理方式：",
    "zh-TW": "本地有改動（偏離基線），請選擇處理方式：",
  },
  "skills.forceOverwrite": {
    "en": "Overwrite with remote",
    "zh-CN": "覆盖更新",
    "zh-TW": "覆蓋更新",
  },
  "skills.keepLocal": {
    "en": "Keep local",
    "zh-CN": "保留本地",
    "zh-TW": "保留本地",
  },
  "skills.updateThisSkill": {
    "en": "Update",
    "zh-CN": "更新此技能",
    "zh-TW": "更新此技能",
  },
  "skills.updating": {
    "en": "Updating…",
    "zh-CN": "更新中…",
    "zh-TW": "更新中…",
  },
  "skills.viewDiff": {
    "en": "View diff",
    "zh-CN": "查看差异",
    "zh-TW": "查看差異",
  },
  "skills.hideDiff": {
    "en": "Hide diff",
    "zh-CN": "收起差异",
    "zh-TW": "收起差異",
  },
  "skills.diffAdded": {
    "en": "Added",
    "zh-CN": "新增",
    "zh-TW": "新增",
  },
  "skills.diffRemoved": {
    "en": "Removed",
    "zh-CN": "删除",
    "zh-TW": "刪除",
  },
  "skills.diffModified": {
    "en": "Modified",
    "zh-CN": "修改",
    "zh-TW": "修改",
  },
  "skills.updateAll": {
    "en": "Update all",
    "zh-CN": "更新全部",
    "zh-TW": "更新全部",
  },
  "skills.skillUpdates": {
    "en": "Skill updates",
    "zh-CN": "技能更新",
    "zh-TW": "技能更新",
  },
  "skills.skillCount": {
    "en": "{n} skills",
    "zh-CN": "{n} 技能",
    "zh-TW": "{n} 技能",
  },
  "skills.outdatedCount": {
    "en": "{n} updates",
    "zh-CN": "{n} 可更新",
    "zh-TW": "{n} 可更新",
  },
  "skills.conflictCount": {
    "en": "{n} conflicts",
    "zh-CN": "{n} 冲突",
    "zh-TW": "{n} 衝突",
  },
  "skills.syncFailed": {
    "en": "sync failed",
    "zh-CN": "同步失败",
    "zh-TW": "同步失敗",
  },
  "skills.statusEnabled": {
    "en": "Enabled",
    "zh-CN": "已开启",
    "zh-TW": "已開啟",
  },
  "skills.statusDisabled": {
    "en": "Disabled",
    "zh-CN": "未开启",
    "zh-TW": "未開啟",
  },
  "skills.save": {
    "en": "Save",
    "zh-CN": "保存",
    "zh-TW": "儲存",
  },
  "skills.saving": {
    "en": "Saving...",
    "zh-CN": "保存中...",
    "zh-TW": "儲存中...",
  },
  "skills.cancel": {
    "en": "Cancel",
    "zh-CN": "取消",
    "zh-TW": "取消",
  },
  "skills.enabled": {
    "en": "Active",
    "zh-CN": "已开启生效",
    "zh-TW": "已開啟生效",
  },
  "skills.disabled": {
    "en": "Inactive",
    "zh-CN": "未开启",
    "zh-TW": "未開啟",
  },
  "skills.viewDocs": {
    "en": "View details →",
    "zh-CN": "查看说明 →",
    "zh-TW": "查看說明 →",
  },
  "skills.modalScenario": {
    "en": "Purpose & Scenarios:",
    "zh-CN": "功能定位与应用场景：",
    "zh-TW": "功能定位與應用場景：",
  },
  "skills.modalPath": {
    "en": "Source Path / URL:",
    "zh-CN": "来源路径 / 订阅 URL：",
    "zh-TW": "來源路徑 / 訂閱 URL：",
  },
  "plugins.installedTab": {
    "en": "Installed",
    "zh-CN": "已安装",
    "zh-TW": "已安裝",
  },
  "plugins.discoverTab": {
    "en": "Discover",
    "zh-CN": "发现",
    "zh-TW": "發現",
  },
  "plugins.categoryAll": {
    "en": "All",
    "zh-CN": "全部",
    "zh-TW": "全部",
  },
  "plugins.categoryExtension": {
    "en": "Extensions",
    "zh-CN": "扩展",
    "zh-TW": "擴充",
  },
  "plugins.categorySkill": {
    "en": "Skills",
    "zh-CN": "技能",
    "zh-TW": "技能",
  },
  "plugins.categoryPrompt": {
    "en": "Prompts",
    "zh-CN": "提示词",
    "zh-TW": "提示詞",
  },
  "plugins.categoryTheme": {
    "en": "Themes",
    "zh-CN": "主题",
    "zh-TW": "主題",
  },
  "plugins.categoryPackage": {
    "en": "Packages",
    "zh-CN": "安装包",
    "zh-TW": "安裝包",
  },
  "plugins.searchPlaceholder": {
    "en": "Search packages (e.g. pi-mcp-adapter, npm:pkg, git:repo)...",
    "zh-CN": "搜索或输入 package 名称 (如 pi-mcp-adapter, npm:pkg, git:repo)...",
    "zh-TW": "搜尋或輸入 package 名稱 (如 pi-mcp-adapter, npm:pkg, git:repo)...",
  },
  "plugins.reloadSession": {
    "en": "Reload Session",
    "zh-CN": "重载会话",
    "zh-TW": "重載會話",
  },
  "plugins.reloading": {
    "en": "Reloading...",
    "zh-CN": "正在重载...",
    "zh-TW": "正在重載...",
  },
  "plugins.enabled": {
    "en": "Enabled",
    "zh-CN": "已启用",
    "zh-TW": "已啟用",
  },
  "plugins.disabled": {
    "en": "Disabled",
    "zh-CN": "已禁用",
    "zh-TW": "已禁用",
  },
  "plugins.enable": {
    "en": "Enable",
    "zh-CN": "启用",
    "zh-TW": "啟用",
  },
  "plugins.disable": {
    "en": "Disable",
    "zh-CN": "禁用",
    "zh-TW": "禁用",
  },
  "plugins.update": {
    "en": "Update",
    "zh-CN": "更新",
    "zh-TW": "更新",
  },
  "plugins.updating": {
    "en": "Updating...",
    "zh-CN": "更新中...",
    "zh-TW": "更新中...",
  },
  "plugins.remove": {
    "en": "Uninstall",
    "zh-CN": "卸载",
    "zh-TW": "卸載",
  },
  "plugins.removing": {
    "en": "Removing...",
    "zh-CN": "移除中...",
    "zh-TW": "移除中...",
  },
  "plugins.installGlobal": {
    "en": "+ Global Install",
    "zh-CN": "+ 全局安装",
    "zh-TW": "+ 全域安裝",
  },
  "plugins.installProject": {
    "en": "+ Project Install",
    "zh-CN": "+ 项目专属",
    "zh-TW": "+ 專案專屬",
  },
  "plugins.installing": {
    "en": "Installing...",
    "zh-CN": "安装中...",
    "zh-TW": "安裝中...",
  },
  "plugins.installed": {
    "en": "Installed",
    "zh-CN": "已安装",
    "zh-TW": "已安裝",
  },
  "plugins.hasUpdate": {
    "en": "Update available",
    "zh-CN": "有新版本",
    "zh-TW": "有新版本",
  },
  "plugins.isLatest": {
    "en": "Latest",
    "zh-CN": "最新",
    "zh-TW": "最新",
  },
  "plugins.newVersionBadge": {
    "en": "NEW",
    "zh-CN": "新版本",
    "zh-TW": "新版本",
  },
  "plugins.updatesAvailableSummary": {
    "en": "{n} package(s) have updates available",
    "zh-CN": "{n} 个插件有可用更新",
    "zh-TW": "{n} 個插件有可用更新",
  },
  "plugins.updateAll": {
    "en": "Update all",
    "zh-CN": "全部更新",
    "zh-TW": "全部更新",
  },
  "plugins.updatingAll": {
    "en": "Updating all…",
    "zh-CN": "正在全部更新…",
    "zh-TW": "正在全部更新…",
  },
  "plugins.updatesCheckFailed": {
    "en": "Update check failed",
    "zh-CN": "更新检查失败",
    "zh-TW": "更新檢查失敗",
  },
  "settings.updatesBadgeTitle": {
    "en": "{p} plugin(s), {s} skill(s) have updates available",
    "zh-CN": "{p} 个插件 · {s} 个技能有可用更新",
    "zh-TW": "{p} 個插件 · {s} 個技能有可用更新",
  },
  "skills.packageUpdateBadge": {
    "en": "Pkg update",
    "zh-CN": "包有更新",
    "zh-TW": "包有更新",
  },
  "skills.packageUpdateTitle": {
    "en": "Update package {pkg} to get the new skill version",
    "zh-CN": "点击更新所属插件包 {pkg}，同步技能新版本",
    "zh-TW": "點擊更新所屬插件包 {pkg}，同步技能新版本",
  },
  "skills.goToPlugins": {
    "en": "Open Plugins",
    "zh-CN": "去插件面板更新",
    "zh-TW": "去插件面板更新",
  },
  "plugins.noInstalled": {
    "en": "No packages installed yet",
    "zh-CN": "暂无已安装的 Package",
    "zh-TW": "暫無已安裝的 Package",
  },
  "plugins.noDiscover": {
    "en": "No matching packages found",
    "zh-CN": "未找到匹配的 Package",
    "zh-TW": "未找到匹配的 Package",
  },
  "plugins.scopeGlobal": {
    "en": "Global",
    "zh-CN": "全局",
    "zh-TW": "全域",
  },
  "plugins.scopeProject": {
    "en": "Project",
    "zh-CN": "项目专属",
    "zh-TW": "專案專屬",
  },
  "plugins.resources": {
    "en": "Resources",
    "zh-CN": "包含资源",
    "zh-TW": "包含資源",
  },
  "plugins.resourcesCount": {
    "en": "Resources ({count}) ▼",
    "zh-CN": "资源 ({count}) ▼",
    "zh-TW": "資源 ({count}) ▼",
  },
  "plugins.collapseResources": {
    "en": "Collapse ▲",
    "zh-CN": "收起明细 ▲",
    "zh-TW": "收起明細 ▲",
  },
  "plugins.confirmUninstallTitle": {
    "en": "Confirm Uninstall",
    "zh-CN": "确认卸载 Package",
    "zh-TW": "確認卸載 Package",
  },
  "plugins.confirmUninstallDesc": {
    "en": "Are you sure you want to uninstall {source}? All extensions and skills from this package will be removed.",
    "zh-CN": "您确定要卸载 {source} 吗？卸载后该包提供的所有扩展、技能和命令将被移除。",
    "zh-TW": "您確定要卸載 {source} 嗎？卸載後該套件提供的所有擴充、技能與指令將被移除。",
  },
  "plugins.confirmUninstallBtn": {
    "en": "Uninstall",
    "zh-CN": "卸载",
    "zh-TW": "卸載",
  },
  "plugins.cancel": {
    "en": "Cancel",
    "zh-CN": "取消",
    "zh-TW": "取消",
  },
  "plugins.viewOnWeb": {
    "en": "View on pi.dev",
    "zh-CN": "在 pi.dev 上查看",
    "zh-TW": "在 pi.dev 上檢視",
  },
  "plugins.sortBy": {
    "en": "Sort by",
    "zh-CN": "排序",
    "zh-TW": "排序",
  },
  "plugins.sortDownloads": {
    "en": "Most Downloads",
    "zh-CN": "最多下载",
    "zh-TW": "最多下載",
  },
  "plugins.sortRecent": {
    "en": "Recently Published",
    "zh-CN": "最新发布",
    "zh-TW": "最新發布",
  },
  "plugins.sortName": {
    "en": "Name (A-Z)",
    "zh-CN": "名称 (A-Z)",
    "zh-TW": "名稱 (A-Z)",
  },
  "plugins.pendingReloadNotice": {
    "en": "Package configuration changed. Click Reload to apply.",
    "zh-CN": "扩展配置已更改，点击右上角「重载生效」让底层 Agent 进程热生效。",
    "zh-TW": "擴充設定已變更，點擊右上角「重載生效」讓底層 Agent 程序熱生效。",
  },
  "plugins.pendingReloadNoSession": {
    "en": "Package configuration changed. It will take effect in new sessions.",
    "zh-CN": "扩展配置已更改，将在新会话中自动生效。",
    "zh-TW": "擴充設定已變更，將在新工作階段中自動生效。",
  },
  "plugins.reloadNow": {
    "en": "Reload Now →",
    "zh-CN": "立即重载 →",
    "zh-TW": "立即重載 →",
  },
  "plugins.keyboardHint": {
    "en": "Press Enter to confirm, Esc to cancel",
    "zh-CN": "按 Enter 确认卸载，按 Esc 取消",
    "zh-TW": "按 Enter 確認卸載，按 Esc 取消",
  },
  "plugins.loadMore": {
    "en": "Load More Packages",
    "zh-CN": "加载更多 Package",
    "zh-TW": "載入更多 Package",
  },
  "plugins.loadingMore": {
    "en": "Loading more...",
    "zh-CN": "正在加载更多...",
    "zh-TW": "正在載入更多...",
  },
  "plugins.allLoaded": {
    "en": "All packages loaded",
    "zh-CN": "已加载全部 Package",
    "zh-TW": "已載入全部 Package",
  },
  "plugins.loadingPackages": {
    "en": "Loading packages...",
    "zh-CN": "正在加载扩展包...",
    "zh-TW": "正在載入擴充包...",
  },
  "plugins.reloadToApply": {
    "en": "Reload to Apply",
    "zh-CN": "重载生效",
    "zh-TW": "重載生效",
  },
  "plugins.goToDiscover": {
    "en": "Go to Discover Market →",
    "zh-CN": "去发现扩展市场 →",
    "zh-TW": "前往探索市場 →",
  },
  "plugins.packageRemoved": {
    "en": "Package removed successfully",
    "zh-CN": "扩展包已成功移除",
    "zh-TW": "擴充包已成功移除",
  },
  "plugins.packageUpdated": {
    "en": "Package updated successfully",
    "zh-CN": "扩展包已成功更新",
    "zh-TW": "擴充包已成功更新",
  },
  "plugins.packageEnabled": {
    "en": "Package enabled",
    "zh-CN": "扩展包已启用",
    "zh-TW": "擴充包已啟用",
  },
  "plugins.packageDisabled": {
    "en": "Package disabled",
    "zh-CN": "扩展包已禁用",
    "zh-TW": "擴充包已停用",
  },
  "plugins.packageInstalled": {
    "en": "Package installed successfully",
    "zh-CN": "扩展包已成功安装",
    "zh-TW": "擴充包已成功安裝",
  },
  "plugins.sessionReloadSuccess": {
    "en": "Session reloaded successfully",
    "zh-CN": "会话已成功重载生效",
    "zh-TW": "工作階段已成功重載生效",
  },
  "plugins.updateToLatestTitle": {
    "en": "Update to latest version",
    "zh-CN": "更新至最新版本",
    "zh-TW": "更新至最新版本",
  },
  "plugins.alreadyLatestTitle": {
    "en": "Already latest version",
    "zh-CN": "已是最新版本",
    "zh-TW": "已是最新版本",
  },
  "plugins.uninstallTitle": {
    "en": "Uninstall package",
    "zh-CN": "卸载扩展包",
    "zh-TW": "解除安裝擴充包",
  },
  "skills.optional": {
    "en": "Optional",
    "zh-CN": "可选",
    "zh-TW": "可選",
  },
  "skills.sourceUrlRequired": {
    "en": "Repository URL is required",
    "zh-CN": "请输入仓库源地址",
    "zh-TW": "請輸入倉庫來源網址",
  },
  "skills.sourceNameRequired": {
    "en": "Repository alias is required",
    "zh-CN": "请输入仓库源别名",
    "zh-TW": "請輸入倉庫來源別名",
  },
  "skills.installedTab": {
    "en": "Installed",
    "zh-CN": "已安装",
    "zh-TW": "已安裝",
  },
  "skills.discoverTab": {
    "en": "Discover",
    "zh-CN": "发现市场",
    "zh-TW": "探索市場",
  },
  "skills.localCategory": {
    "en": "Local",
    "zh-CN": "本地技能",
    "zh-TW": "本機技能",
  },
  "skills.noInstalled": {
    "en": "No skills installed yet",
    "zh-CN": "暂无已安装的技能",
    "zh-TW": "尚無已安裝的技能",
  },
  "skills.noDiscover": {
    "en": "No matching skills found in market",
    "zh-CN": "市场中未找到匹配的技能",
    "zh-TW": "市場中未找到符合的技能",
  },
  "skills.goToDiscover": {
    "en": "Go to Discover Market →",
    "zh-CN": "前往技能市场探索 →",
    "zh-TW": "前往技能市場探索 →",
  },
  "skills.installSkill": {
    "en": "Install",
    "zh-CN": "安装启用",
    "zh-TW": "安裝啟用",
  },
  "skills.installedBadge": {
    "en": "Installed",
    "zh-CN": "已安装",
    "zh-TW": "已安裝",
  },
  "skills.pendingReloadNotice": {
    "en": "Skill configurations changed. Click 'Reload Session' in the top right to take effect.",
    "zh-CN": "技能配置已更改，点击右上角「重载生效」让底层 Agent 进程热生效。",
    "zh-TW": "技能設定已變更，點擊右上角「重載生效」讓底層 Agent 程序熱生效。",
  },
  "skills.pendingReloadNoSession": {
    "en": "Skill configuration changed. It will take effect in new sessions.",
    "zh-CN": "技能配置已更改，将在新会话中自动生效。",
    "zh-TW": "技能設定已變更，將在新工作階段中自動生效。",
  },
  "skills.updatingPackage": {
    "en": "Updating pkg…",
    "zh-CN": "更新包中…",
    "zh-TW": "更新包中…",
  },
  "skills.packageUpdated": {
    "en": "Package updated — skill synced to new version",
    "zh-CN": "包已更新，技能已同步新版本",
    "zh-TW": "包已更新，技能已同步新版本",
  },
  "skills.reloadSession": {
    "en": "Reload Session",
    "zh-CN": "重载会话",
    "zh-TW": "重載工作階段",
  },
  "skills.reloadToApply": {
    "en": "Reload to Apply",
    "zh-CN": "重载生效",
    "zh-TW": "重載生效",
  },
  "skills.urlSourceUnsupported": {
    "en": "Unsupported source: only Git repositories (.git / github / gitlab URLs) or JSON manifest links are supported.",
    "zh-CN": "暂不支持该地址：仅支持 Git 仓库（.git / github / gitlab 链接）或 JSON manifest 地址。",
    "zh-TW": "暫不支援該地址：僅支援 Git 儲存庫（.git / github / gitlab 連結）或 JSON manifest 地址。",
  },
  "skills.syncingNewSource": {
    "en": "Syncing new source… first pull may take up to a minute.",
    "zh-CN": "正在同步新源…首次拉取可能需要数十秒，请稍候。",
    "zh-TW": "正在同步新源…首次拉取可能需要數十秒，請稍候。",
  },
  "skills.sourceSyncFailed": {
    "en": "Source '{name}' sync failed",
    "zh-CN": "源 “{name}” 同步失败",
    "zh-TW": "源 「{name}」 同步失敗",
  },
  "skills.deleteSourceConfirmBtn": {
    "en": "Click again to delete",
    "zh-CN": "再次点击确认删除",
    "zh-TW": "再次點擊確認刪除",
  },
  "skills.reloading": {
    "en": "Reloading...",
    "zh-CN": "正在重载...",
    "zh-TW": "正在重載...",
  },
  "skills.sessionReloadSuccess": {
    "en": "Session reloaded successfully",
    "zh-CN": "会话已成功重载生效",
    "zh-TW": "工作階段已成功重載生效",
  },
  "skills.noInstalledSearch": {
    "en": "No installed skills matching '{query}'",
    "zh-CN": "已安装技能中未找到匹配 “{query}” 的项",
    "zh-TW": "已安裝技能中未找到符合「{query}」的項目",
  },
  "skills.searchInMarket": {
    "en": "Search in Market for '{query}' →",
    "zh-CN": "去技能市场搜索 “{query}” →",
    "zh-TW": "前往技能市場搜尋「{query}」→",
  },
  "skills.detailTitle": {
    "en": "Skill Details",
    "zh-CN": "技能详情预览",
    "zh-TW": "技能詳情預覽",
  },
  "skills.skillPreview": {
    "en": "Skill Specification (SKILL.md)",
    "zh-CN": "技能指令与规范 (SKILL.md)",
    "zh-TW": "技能指令與規範 (SKILL.md)",
  },
  "skills.authorLabel": {
    "en": "Author",
    "zh-CN": "作者",
    "zh-TW": "作者",
  },
  "skills.sourceLabel": {
    "en": "Source Origin",
    "zh-CN": "来源仓库",
    "zh-TW": "來源倉庫",
  },
  "skills.locationLabel": {
    "en": "File Location",
    "zh-CN": "本地路径",
    "zh-TW": "本機路徑",
  },
  "skills.noContent": {
    "en": "No SKILL.md specification content available for this skill.",
    "zh-CN": "暂无该技能的 SKILL.md 详细规范内容。",
    "zh-TW": "尚無該技能的 SKILL.md 詳細規範內容。",
  },
  "skills.close": {
    "en": "Close",
    "zh-CN": "关闭",
    "zh-TW": "關閉",
  },
  "chat.attach": {
    "en": "Add",
    "zh-CN": "添加",
    "zh-TW": "新增",
  },
  "chat.attachTooltip": {
    "en": "Add attachment (image, document, code)",
    "zh-CN": "添加附件 (图片、文档、代码)",
    "zh-TW": "新增附件 (圖片、文件、程式碼)",
  },
  "chat.attachImage": {
    "en": "Attach images",
    "zh-CN": "添加图片",
    "zh-TW": "添加圖片",
  },
  "chat.attachFile": {
    "en": "Attach text or code file",
    "zh-CN": "添加文本或代码文件",
    "zh-TW": "添加文字或程式碼檔案",
  },
  "chat.fileLines": {
    "en": "{count} lines",
    "zh-CN": "{count} 行",
    "zh-TW": "{count} 行",
  },
  "chat.fileTooLarge": {
    "en": "File is too large (maximum 2MB for text attachments)",
    "zh-CN": "文件过大（文本附件最大支持 2MB）",
    "zh-TW": "檔案過大（文字附件最大支援 2MB）",
  },
  "chat.fileReadError": {
    "en": "Failed to read file as text",
    "zh-CN": "读取文件文本失败",
    "zh-TW": "讀取檔案文字失敗",
  },
  "chat.previewAttachment": {
    "en": "Preview Attachment",
    "zh-CN": "预览附件内容",
    "zh-TW": "預覽附件內容",
  },
};

/**
 * PowerI 多语言翻译辅助函数
 */
export function tp(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const dict = poweriMessages[key];
  if (!dict) return key;
  let text = dict[locale] || dict["en"] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return text;
}
