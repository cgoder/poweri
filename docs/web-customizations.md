# Web 适配层定制清单（迁移期上游资产）

> **权威文件**：[`docs/web-customizations.json`](web-customizations.json)（`scripts/validate-customizations.mjs` 唯一读取源）。本页是生成视图，**只读**；修改请改 JSON 后跑 `node scripts/render-customizations-md.mjs`。
>
> **适用范围**：只记录迁移期 web/ UI/交互资产与 agegr/pi-web 上游之间的差异。不定义终局 AgentClient、AgentHost、gateway、worker 或 Agent Runtime 架构；终局以 [ADR-0011](adr/0011-poweri-web-agent-surface.md) 为准。
>
> **纪律**：定制优先新增独立文件（上游不存在的文件 → subtree pull 零冲突）；必须侵入上游文件的改动登记在 `intrusions`。

## 上游基线与落后量

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/agegr/pi-web.git |
| 引入版本 | **v0.8.8**（发布 2026-08-12） |
| subtree squash / split | `0a69b3130e8c…` / `0877bffc0c6d…` |
| 上游最新（观测 2026-10-21） | **0.12.2**（发布 2026-10-15） |
| 落后量 | 0.8.9 → 0.12.2 共 21 个版本（含 4 个 minor：0.9/0.10/0.11/0.12） |
| 已执行升级演练 | 无（ticket 09 待执行） |

> **历史包袱**：2026-09-07 mirror（c852ee7）把一整代自研改动带入 web/ 但未登记：子代理体系、i18n（zh-TW）、设置面板重构、Web Push + PWA、模型选择器拆分、WSL/代理安全修正。本次补齐 88 条侵入登记 + 174 条独立新增登记。

## 侵入上游文件（109 条）

### 网关适配（20）：网关模式适配：让上游本地形态跑在 Gateway → Worker PVC 之上（不改产品行为）

风险分布：高 1 / 中 3 / 低 16

| 文件 | 改动 | 风险 |
|---|---|---|
| `web/app/api/agent/[id]/events/route.ts` | GET fast path 加跨用户隔离校验（事件流订阅同 agent/[id]） | 低 |
| `web/app/api/agent/[id]/route.ts` | POST fast path 加跨用户隔离校验（isGatewaySessionOwner 不匹配 → 404）——单实例 web 共享 registry，防止跨用户访问会话 | 低 |
| `web/app/api/agent/new/route.ts` | 网关分支：cwd 缺省 gatewayConfig.workspace、跳过 existsSync 校验、ensure_session 后 invalidateGatewaySessions——真实工作区在 worker PVC（/workspace），宿主无目录 | 低 |
| `web/app/api/cwd/browse/route.ts` | 网关模式拒绝（400）——工作区固定 /workspace；防宿主目录枚举（上游 browse 无授权检查） | 低 |
| `web/app/api/cwd/validate/route.ts` | 网关模式拒绝（400）——工作区固定 /workspace | 低 |
| `web/app/api/default-cwd/route.ts` | POST 网关分支：返回 gatewayConfig.workspace（/workspace）——真实工作区在 worker PVC | 低 |
| `web/app/api/file-index/route.ts` | GET 网关分支（经网关递归列出 + q 过滤）——文件在 worker PVC | 低 |
| `web/app/api/files/[...path]/route.ts` | GET 网关分支（read/meta/list；download/preview/watch 明确拒绝）——文件在 worker PVC；二进制/流式能力未接 | 低 |
| `web/app/api/models-config/route.ts` | GET 只读展示 worker 模型配置；PUT 网关模式 403——worker 的 models.json 由部署链管理，禁止宿主编辑 | 低 |
| `web/app/api/models/route.ts` | GET 网关分支：返回平台单一模型 poweri-gw/agent——模型由 worker PVC models.json 决定，宿主不初始化 SDK | 低 |
| `web/app/api/plugins/route.ts` | GET 空列表 + POST 拒绝——worker 无插件包体系 | 低 |
| `web/app/api/sessions/[id]/auto-name/route.ts` | POST 网关分支（首条用户消息派生标题，不走模型）——worker 无会话命名 API | 低 |
| `web/app/api/sessions/[id]/context/route.ts` | GET 网关分支（历史经 gatewayHistoryContext）——v0.8.8 新增路由；网关模式无本地 entries | 低 |
| `web/app/api/sessions/[id]/export/route.ts` | GET 网关分支（JSONL 经网关落临时文件再导出，事后清理）——会话 JSONL 在 worker PVC | 低 |
| `web/app/api/sessions/[id]/route.ts` | GET 网关分支（历史来自 /v1/sessions/<id>/messages，gatewayMessageToUi 渲染，上下文含 GW_MODEL）；PATCH/DELETE 网关分支（改名/删除经网关 → worker PVC；删除时 registry shutdown + 列表缓存失效）… | 中 |
| `web/app/api/skills/route.ts` | GET 经网关扫描；PATCH 拒绝（SKILL.md 在 worker PVC）——技能播种走 seed-skills | 低 |
| `web/hooks/useAgentSession.ts` | 网关会话 id 采纳（adoptGatewaySessionId：prompt/session_created 后把临时 id 提升为网关真实 SessionId，事件与历史落到同一 Session）+ 用量统计合并、上下文分页、System/Tools 惰性加载 | 中 |
| `web/lib/rpc-manager.ts` | startRpcSession 开头加网关分支（返回 GatewaySessionClient，registry 注册 + session_created 补注册）；getRpcSessionInfos 网关模式返回 []——网关模式不建进程内 AgentSession，会话由网关管理 | 高 |
| `web/lib/session-reader.ts` | listAllSessions 开头加网关分支（会话列表来自网关 /v1/sessions + cacheSessionPath）——网关模式不扫本地磁盘 | 中 |
| `web/proxy.ts` | 网关模式认证分支：POWERI_WEB_USERS/POWERI_WEB_PASSWORD 启用时 resolveWebUser 校验（多用户），上游 PI_WEB_PASSWORD 逻辑保留为回退——每用户认证（用户名→网关 token 请求级解析的前提） | 低 |

### 上游演进吸收（10）：上游演进吸收：pi/Next 版本升级带来的事件、类型、依赖与 API 形状变化

风险分布：高 0 / 中 4 / 低 6

| 文件 | 改动 | 风险 |
|---|---|---|
| `web/components/ExtensionStatusBar.tsx` | 改用 components/AnsiText.tsx 渲染 ANSI 文本（替代 lib/ansi 内的 React 实现），并支持多行状态栏折行 | 低 |
| `web/components/ExtensionWidgets.tsx` | 改用 components/AnsiText.tsx 渲染 ANSI 文本（替代 lib/ansi 内的 React 实现），并支持多行状态栏折行 | 低 |
| `web/lib/agent-event-wire.ts` | 吸收 pi 0.84.4 事件/类型形状（assistantMessageEvent 的 toolcall_start/delta、rawInput 流式输入、powershell 内建工具名） | 中 |
| `web/lib/ansi.ts` | React 渲染部分迁出到独立新增文件 components/AnsiText.tsx；本文件只保留纯文本处理（stripAnsi/normalizeCustomPanelLines） | 中 |
| `web/lib/normalize.ts` | 吸收 pi 0.84.4 事件/类型形状（assistantMessageEvent 的 toolcall_start/delta、rawInput 流式输入、powershell 内建工具名） | 低 |
| `web/lib/pi-types.ts` | 吸收 pi 0.84.4 事件/类型形状（assistantMessageEvent 的 toolcall_start/delta、rawInput 流式输入、powershell 内建工具名） | 低 |
| `web/lib/streaming-message.ts` | 吸收 pi 0.84.4 事件/类型形状（assistantMessageEvent 的 toolcall_start/delta、rawInput 流式输入、powershell 内建工具名） | 低 |
| `web/lib/tool-presets.ts` | 吸收 pi 0.84.4 事件/类型形状（assistantMessageEvent 的 toolcall_start/delta、rawInput 流式输入、powershell 内建工具名） | 低 |
| `web/package-lock.json` | 与 web/package.json 的 PowerI web 迁移基线同步；锁定 pi/Next/端侧能力及 Gateway SSE 依赖，保证 monorepo/web 的 npm ci 可复现 | 中 |
| `web/package.json` | 吸收 PowerI web 迁移基线的运行时依赖与版本（pi 0.84.4、Next 16.3.1、ansi_up、web-push 等），并保留 eventsource-parser——同时支持端侧产品能力与 Gateway SSE 事件解析 | 中 |

### PowerI 产品能力（36）：PowerI 产品能力：在上游共享文件里实现的产品功能（本应在 poweri/ 下，属待收敛项）

风险分布：高 6 / 中 8 / 低 22

| 文件 | 改动 | 风险 |
|---|---|---|
| `web/app/api/agent/running/route.ts` | 会话列表/运行中接口补 completionNotificationSuppressedSessionIds（子代理完成静默） | 低 |
| `web/app/api/app-update/route.ts` | 支持 PI_WEB_SKIP_VERSION_CHECK=1 关闭版本检查（离线/隔离环境） | 低 |
| `web/app/api/auth/providers/route.ts` | provider 列表拆分为 oauthProviders / apiKeyProviders 两个视图（设置面板分组展示） | 低 |
| `web/app/api/sessions/route.ts` | 会话列表/运行中接口补 completionNotificationSuppressedSessionIds（子代理完成静默） | 低 |
| `web/app/api/worktrees/route.ts` | 工作树响应补 projectKey（lib/project-identity 统一项目标识） | 低 |
| `web/bin/pi-web-options.js` | CLI 增强：--help/-h 帮助、--hostname、端口校验、进程生命周期接线（bin/process-lifecycle.js） | 中 |
| `web/bin/pi-web.js` | CLI 增强：--help/-h 帮助、--hostname、端口校验、进程生命周期接线（bin/process-lifecycle.js） | 低 |
| `web/components/AppShell.tsx` | PowerI Shell 接管：设置/系统提示/工具定义/Agent 会话面板接入、窄屏工具栏折叠、子代理会话跳转 | 高 |
| `web/components/BranchNavigator.tsx` | 分支树遍历改显式栈 DFS：线性会话的链深等于条目数，递归会爆调用栈 | 低 |
| `web/components/ChatInput.tsx` | 模型选择器抽取为 ModelSelector（供应商图标/搜索/思考档位）、内置 slash 命令面板、客户端图片压缩（超阈值降分辨率后再上传） | 高 |
| `web/components/ChatWindow.tsx` | 通知抽屉（NoticeShelf）+ 历史向前分页加载 + 自定义面板 ANSI 渲染 | 中 |
| `web/components/DirectoryPicker.tsx` | 支持传入初始路径（记住上次选择的工作目录） | 低 |
| `web/components/FileExplorer.tsx` | 文件搜索树（服务端 file-index + 客户端 buildSearchTree 过滤）与外部刷新令牌 | 中 |
| `web/components/FileViewer.tsx` | 超长源码（>1000 行）降级为轻量渲染，避免高亮卡死 | 低 |
| `web/components/MessageView.tsx` | 子代理工具详情渲染、token 估算文本、工具结果图片配对展示 | 中 |
| `web/components/ModelsConfig.tsx` | 设置面板统一重构：接入 lib/settings-navigation（记住上次选中项）与共享 SettingsUi 组件（ConfigSidebar/ConfigDetail/ConfigButton），模型配置改用 ProviderIcon | 高 |
| `web/components/PluginsConfig.tsx` | 设置面板统一重构：接入 lib/settings-navigation（记住上次选中项）与共享 SettingsUi 组件（ConfigSidebar/ConfigDetail/ConfigButton），模型配置改用 ProviderIcon | 高 |
| `web/components/SessionSidebar.tsx` | 会话侧栏：项目分组与活跃度、会话族/子代理折叠、未读判定（子代理完成静默）、工作区记忆槽 | 高 |
| `web/components/SkillsConfig.tsx` | 设置面板统一重构：接入 lib/settings-navigation（记住上次选中项）与共享 SettingsUi 组件（ConfigSidebar/ConfigDetail/ConfigButton），模型配置改用 ProviderIcon | 高 |
| `web/hooks/useI18n.tsx` | 本地存储语言增加 zh-TW 白名单分支 | 低 |
| `web/hooks/useIsMobile.ts` | 新增窄屏断点 subscribeQuery/useIsNarrowMobile（max-width 480px），次级工具栏动作收进 More | 低 |
| `web/hooks/useTheme.ts` | 主题切换抽出 setThemePreference(preference, origin)，便于按来源区分埋点/行为 | 低 |
| `web/lib/api-types.ts` | 扩充 PowerI 类型：AgentUsage、SubagentSessionStatus/关系、SubagentProfile/Settings、ShellTool 与 Push 配置响应 | 低 |
| `web/lib/file-paths.ts` | WSL UNC 等价处理：\\wsl$ 与 \\wsl.localhost 视为同一共享；URL 中以 __pi_unc__ 标记段保存 // 前缀 | 低 |
| `web/lib/i18n/messages/en.ts` | i18n 扩充：设置面板文案键、zh-TW locale、浏览器语言判定（zh-Hant/zh-TW/zh-HK → zh-TW，zh-Hans/zh-SG → zh-CN） | 中 |
| `web/lib/i18n/messages/zh-CN.ts` | i18n 扩充：设置面板文案键、zh-TW locale、浏览器语言判定（zh-Hant/zh-TW/zh-HK → zh-TW，zh-Hans/zh-SG → zh-CN） | 中 |
| `web/lib/i18n/registry.ts` | i18n 扩充：设置面板文案键、zh-TW locale、浏览器语言判定（zh-Hant/zh-TW/zh-HK → zh-TW，zh-Hans/zh-SG → zh-CN） | 低 |
| `web/lib/i18n/types.ts` | i18n 扩充：设置面板文案键、zh-TW locale、浏览器语言判定（zh-Hant/zh-TW/zh-HK → zh-TW，zh-Hans/zh-SG → zh-CN） | 低 |
| `web/lib/markdown.ts` | 把模型输出的单行裸 [ … ] 公式归一为 $$ display math（避免被当链接渲染） | 低 |
| `web/lib/model-scope.ts` | 模型引用解析增强：glob/精确 provider-qualified 匹配、thinking 后缀剥离、歧义裸 id 显式拒绝 | 中 |
| `web/lib/path-security.ts` | WSL UNC 等价处理：\\wsl$ 与 \\wsl.localhost 视为同一共享；URL 中以 __pi_unc__ 标记段保存 // 前缀 | 低 |
| `web/lib/request-security.ts` | 允许代理改写 Origin/Host 但保留 x-forwarded-proto 的同源判定（Azure Dev Tunnels 等隧道场景） | 低 |
| `web/lib/types.ts` | 扩充 PowerI 类型：AgentUsage、SubagentSessionStatus/关系、SubagentProfile/Settings、ShellTool 与 Push 配置响应 | 中 |
| `web/lib/workspace-memory.ts` | workspaceKeyOf 优先服务端 projectKey（同一仓库的全部 worktree 共用记忆槽） | 低 |
| `web/next.config.ts` | web-push 纳入 serverExternalPackages；dev 源允许 loopback 与 RFC1918 网段（局域网调试） | 低 |
| `web/public/sw.js` | Service Worker 增加 push 事件处理（完成通知不经页面） | 低 |

### 品牌/PWA（7）：品牌与 PWA 形态：图标、离线页、视口变量

风险分布：高 0 / 中 0 / 低 7

| 文件 | 改动 | 风险 |
|---|---|---|
| `web/app/favicon.ico` | PowerI 品牌与 PWA 形态：应用图标、离线页文案、standalone 视口高度变量、settings.css 引入 | 低 |
| `web/app/globals.css` | PowerI 品牌与 PWA 形态：应用图标、离线页文案、standalone 视口高度变量、settings.css 引入 | 低 |
| `web/app/layout.tsx` | PowerI 品牌与 PWA 形态：应用图标、离线页文案、standalone 视口高度变量、settings.css 引入 | 低 |
| `web/public/icons/apple-touch-icon.png` | PowerI 品牌与 PWA 形态：应用图标、离线页文案、standalone 视口高度变量、settings.css 引入 | 低 |
| `web/public/icons/icon-192.png` | PowerI 品牌与 PWA 形态：应用图标、离线页文案、standalone 视口高度变量、settings.css 引入 | 低 |
| `web/public/icons/icon-512.png` | PowerI 品牌与 PWA 形态：应用图标、离线页文案、standalone 视口高度变量、settings.css 引入 | 低 |
| `web/public/offline.html` | PowerI 品牌与 PWA 形态：应用图标、离线页文案、standalone 视口高度变量、settings.css 引入 | 低 |

### 测试夹具（34）：测试夹具：跟随实现同步，或为本地 TS 直跑改用 jiti 动态 import

风险分布：高 0 / 中 0 / 低 34

| 文件 | 改动 | 风险 |
|---|---|---|
| `web/app/api/agent/events-route.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/app/api/sessions/runtime-route.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/components/AppShell.mobile-toolbar.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/components/BranchNavigator.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/components/ChatInput.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/components/ExtensionStatusBar.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/components/ExtensionWidgets.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/components/FileViewer.state.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/components/MarkdownBody.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/components/MermaidBlock.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/components/MessageView.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/components/MobilePwaLayout.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/components/ModelsConfig.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/components/SessionSidebar.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/components/TurnWrittenFiles.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/hooks/useAgentSession.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/agent-event-wire.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/ansi.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/file-access.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/http-dispatcher.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/i18n/format.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/i18n/registry.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/markdown.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/model-scope.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/pi-web-options.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/request-security.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/rpc-manager-shutdown.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/rpc-manager-widgets.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/rpc-manager.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/session-reader.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/streaming-message.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/tool-presets.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/lib/workspace-memory.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |
| `web/public/sw.test.mjs` | 测试随实现同步：为本地 TS 直跑改用 jiti 动态 import（沿用上游 rpc-manager.test.mjs 模式），并补充对应改动的断言 | 低 |

### 构建配置（2）：构建/检查配置：eslint、tsconfig

风险分布：高 0 / 中 0 / 低 2

| 文件 | 改动 | 风险 |
|---|---|---|
| `web/eslint.config.mjs` | 忽略 temp/（gitignore 的临时目录可能含解包源副本，不应参与 lint） | 低 |
| `web/tsconfig.json` | 排除 node_modules 与 src-tauri（桌面端残留目录） | 低 |

## 独立新增文件（178 条，零冲突）

- **poweri/ 产品层**（73）：`poweri/bin/poweri-web-options.js`、`poweri/bin/poweri-web-options.test.mjs`、`poweri/bin/poweri-web.js`、`poweri/components/AppUpdateDot.tsx`、`poweri/components/ChatInput.tsx`、`poweri/components/ChatWindow.tsx`、`poweri/components/FileContextMenu.tsx`、`poweri/components/FileExplorer.tsx` …（完整列表见 JSON）
- **app/poweri/ 路由与 API**（13）：`app/poweri/api/attachments/upload/route.ts`、`app/poweri/api/plugins/packages/route.ts`、`app/poweri/api/plugins/updates/route.ts`、`app/poweri/api/resolve-file/route.ts`、`app/poweri/api/session-stats/[id]/route.ts`、`app/poweri/api/session-summaries/route.ts`、`app/poweri/api/skills/market/route.ts`、`app/poweri/api/skills/toggle/route.ts` …（完整列表见 JSON）
- **app/api/ 新增 API**（7）：`app/api/push/config/route.ts`、`app/api/push/subscribe/route.ts`、`app/api/sessions/[id]/entries/[entryId]/tool-result-image/route.ts`、`app/api/subagents/[id]/route.ts`、`app/api/subagents/profiles/route.ts`、`app/api/subagents/settings/route.ts`、`app/api/tools/settings/route.ts`
- **lib/ 新增模块**（25）：`lib/chat-only.ts`、`lib/gateway-client.ts`、`lib/i18n/messages/zh-TW.ts`、`lib/powershell-settings.ts`、`lib/project-command-env.ts`、`lib/project-groups.ts`、`lib/project-identity.ts`、`lib/push-client.ts` …（完整列表见 JSON）
- **components/ 新增组件**（9）：`components/AgentsConfig.tsx`、`components/AgentSessionPanel.tsx`、`components/AnsiText.tsx`、`components/ModelSelector.tsx`、`components/ProviderIcon.tsx`、`components/SettingsPanel.tsx`、`components/SettingsUi.tsx`、`components/SystemPromptPanel.tsx` …（完整列表见 JSON）
- **新增测试**（45）：`app/api/cwd/validate/route.test.mjs`、`app/api/files/stream-route.test.mjs`、`app/api/sessions/context-route.test.mjs`、`app/api/sessions/detail-route.test.mjs`、`app/api/subagents/profiles/route.test.mjs`、`app/api/subagents/runtime-route.test.mjs`、`app/api/subagents/settings/route.test.mjs`、`components/AgentsConfig.test.mjs` …（完整列表见 JSON）
- **其它**（6）：`.dockerignore`、`app/settings.css`、`bin/process-lifecycle.js`、`Dockerfile`、`public/provider-icons.svg`、`deploy/k8s/poweri-web.yaml`

## 已知缺口（升级前必须先处理）

- intrusions 中 poweri-product 类（36 个文件，含 6 个 high）尚未收敛进 poweri/ 替换件机制，subtree pull 时仍需逐个人工合并
- bin/pi-web.js、bin/pi-web-options.js 属上游文件却已被产品能力侵入，与『不改上游 bin/』的约定冲突，待决策（迁移进 poweri/bin/ 或纳入可控侵入面）
- 上游 0.8.9→0.12.2 从未 pull，dry-run 预测尚未对真实上游 ref 运行过（需 fetch 上游对象）

## gateway/ 内改动（源仓库已冻结归档，无 pull 冲突面；仅记录）

上游：`https://gitlab.litta.cn/litta-power/poweri-gateway.git` dev f3a9406

| 文件 | 改动理由 |
|---|---|
| `gateway/pods.mjs` | fake provider 的 message_update 事件补 assistantMessageEvent（对齐真实 pi 事件形状）——v0.8.8 web 端 toClientAgentEvent 依赖该字段（本地 fake 验证链路） |
| `gateway/server.mjs` | fake 模式 /v1/chat 落盘会话 JSONL（sessionFileHost，首行 session header，SDK 导出/校验路径可用）；修复 localSessions 缺 import sessionListEntry 的隐藏 bug；localFiles/localFile 路径语义对齐 bridge（/workspace 前缀映射、未初始化目录返回空、递归输出对齐 /workspace/... 形状）——fake 是主测试缝 |

<!-- 生成命令：node scripts/render-customizations-md.mjs（源：docs/web-customizations.json） -->
