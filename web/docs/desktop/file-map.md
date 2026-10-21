# PowerI-Web 文件地图

> 只覆盖 PowerI 侧的组织方式与入口；上游共享文件按上游语义使用，其改动登记在
> [`../../docs/web-customizations.json`](../../docs/web-customizations.json)。
> 架构边界见 [`architecture-and-scope-boundary.md`](./architecture-and-scope-boundary.md)。

## 1. 入口

```
app/poweri/page.tsx          /poweri 路由（上游无此文件）
app/poweri/layout.tsx        /poweri 布局
poweri/layout/AppShell.tsx   主框架（替换上游 components/AppShell.tsx）
poweri/bin/poweri-web.js     独立启动器（默认端口 9989，打开 /poweri）
poweri/bin/poweri-web-options.js  启动决策纯函数（可单测）
```

## 2. poweri/ 目录

| 目录 | 内容 |
|---|---|
| `poweri/components/` | 上游组件的替换件（ChatWindow / MessageView / MarkdownBody / ChatInput / FileExplorer / FileViewer / SessionSidebar / SettingsPanel / TabBar / MermaidBlock）+ PowerI 专属组件（AppUpdateDot / FileContextMenu / VersionUpdateSection） |
| `poweri/features/` | 用量统计三面板（StatsPanel / UsagePanel / SessionListPanel）、插件市场（plugins/PowerIPluginsConfig）、技能市场与更新条（skills/） |
| `poweri/lib/` | 产品层业务模块 40+：附件（attachment-*）、技能（skill-* / skills-catalog）、包更新（package-*/packages-catalog）、用量（usage-stats）、文件路径链接化与打开策略（file-path-* / file-open-resolver）、会话分组（session-groups / session-files）、i18n 聚合（i18n.ts）、应用更新（app-update-*） |
| `poweri/hooks/` | useAppUpdate / useAppUpdateBadge |
| `poweri/styles/` | file-link.css / usage-panel.css |
| `poweri/README.md` | 产品层自述（纪律 + 目录导览） |

## 3. app/poweri/api/

| 路由 | 用途 |
|---|---|
| `attachments/upload` | 附件上传 |
| `plugins/packages`、`plugins/updates` | 插件市场包目录与更新 |
| `skills/market`、`skills/toggle`、`skills/update` | 技能市场、启停、更新 |
| `session-stats/[id]`、`session-summaries` | 会话统计与摘要 |
| `usage` | 用量聚合 |
| `resolve-file` | 文件路径解析（点击消息里的路径打开文件） |
| `web-update` | 前端版本/更新检查 |

## 4. 与上游共享目录的分工

| 上游目录 | PowerI 在该目录下新增 | PowerI 在该目录下改动 |
|---|---|---|
| `app/api/` | 子代理（`subagents/*`）、推送（`push/*`）、工具设置（`tools/settings`）、工具结果图片（`sessions/[id]/entries/[entryId]/tool-result-image`） | 网关分支 + 产品能力（见清单 `gateway-adapter` / `poweri-product`） |
| `lib/` | 子代理运行时（`subagent-*`）、项目标识与分组（`project-*`）、会话族/树/统计（`session-*`）、设置导航（`settings-navigation`）、搜索树（`search-tree`）、推送（`web-push` / `push-client`）、进程生命周期（`process-lifecycle`） | 事件形状、i18n、模型作用域、路径与请求安全等（见清单） |
| `components/` | 设置面板与子代理组件（`SettingsPanel` / `SettingsUi` / `AgentsConfig` / `AgentSessionPanel` / `SystemPromptPanel` / `ToolDefinitionsPanel`）、`ModelSelector`、`ProviderIcon`、`AnsiText` | Shell / Sidebar / ChatInput / ChatWindow / MessageView / 配置面板（见清单） |
| `bin/` | `process-lifecycle.js` | `pi-web.js`、`pi-web-options.js`（CLI 帮助与端口校验，待决策项） |
| `public/` | `provider-icons.svg` | 应用图标、`sw.js`（push）、`offline.html` 文案 |

## 5. 测试落点

- `web/poweri/**/*.test.mjs`：产品层单测（`npm test` 的匹配规则已包含 `poweri/**`）
- `web/lib/*.test.mjs`、`web/components/*.test.mjs`、`web/app/**/*.test.mjs`：上游测试 + PowerI 追加断言
- 适配层专项：`web/lib/gateway-client.test.mjs`、`gateway-routes-gateway.test.mjs`、`rpc-manager-gateway.test.mjs`
- 清单校验：`scripts/validate-customizations.mjs`（根目录，单测在 `scripts/test/`）
