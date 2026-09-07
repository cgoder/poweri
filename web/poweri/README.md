# poweri/ — PowerI 产品层

> 产品层的入口导览。全局架构见 [`docs/desktop/architecture-and-scope-boundary.md`](../docs/desktop/architecture-and-scope-boundary.md)，逐文件地图见 [`docs/desktop/file-map.md`](../docs/desktop/file-map.md)。

`poweri/`（配合 `app/poweri/`）是 PowerI 的产品层：所有面向用户的界面与业务增强都住在这里，**对上游 `components/`、`lib/`、`hooks/` 零修改**。上游能力直接 import 复用；上游组件需要改时，复制为 `poweri/components/` 下的替换件（同一 PR 登记 `docs/desktop/replacements.json`），绝不改上游原件。

## 目录导览

```
poweri/
├── bin/                # 独立运行入口：poweri-web bin（默认端口 9989、打开 /poweri）
│                       #   与 launch 决策辅助 poweri-web-options.js；详见
│                       #   docs/desktop/poweri-web-standalone.md
├── layout/
│   └── AppShell.tsx    # PowerI 主布局——替换式接管，上游 components/AppShell.tsx 不动
├── components/         # 上游组件的替换件 + PowerI 专属组件
│   ├── ChatWindow.tsx / MessageView.tsx / MarkdownBody.tsx   # 聊天主链路
│   ├── ChatInput.tsx   # 增强输入框（双模附件胶囊、模型切换）
│   ├── FileExplorer.tsx / FileViewer.tsx / TabBar.tsx        # 工作区文件体系
│   ├── SessionSidebar.tsx                                    # 会话侧栏（替换件）
│   └── SettingsPanel.tsx                                     # 统一设置面板
├── features/
│   ├── StatsPanel.tsx / UsagePanel.tsx / SessionListPanel.tsx # 用量统计三面板
│   ├── plugins/PowerIPluginsConfig.tsx                        # 插件市场（pi.dev/packages 实时）
│   └── skills/SkillsMarketView.tsx                            # 技能市场（skills.sh + 私有 Git 订阅）
├── lib/                # 产品层业务逻辑（附件、统计解析、市场目录、i18n、
│                       #   文件路径链接化、技能安装登记等 25+ 模块）
└── styles/             # 产品层样式
app/poweri/
├── page.tsx            # /poweri 路由入口（上游无此文件，零冲突）
└── api/                # PowerI 专属后端 API（附件、技能市场、用量统计等）
```

## 接线链

`app/poweri/page.tsx` → `poweri/layout/AppShell` → `poweri/components/ChatWindow` → `MessageView` → `MarkdownBody`。

上游 `/` 路由仍挂上游 `AppShell`（浏览器兼容模式），PowerI 永不使用它。

## 开发约定

- **新 UI 一律落这里**：改 `components/` 上游文件属于红线违例，即使功能正确也会被拒收。
- **替换件登记**：新建替换件时同步更新 `docs/desktop/replacements.json`（watermark = 当时上游 HEAD）；上游同步后跑 `node scripts/upstream-replacement-audit.mjs check` 消化差异。
- **测试**：`npm test` 的 glob 覆盖 `poweri/**/*.test.mjs`；本目录测试禁止硬编码本机绝对路径。
- **运行验证**：`npm run dev`（9989）后访问 `/poweri`；`node_modules/.bin/tsc --noEmit` 全量类型检查。
