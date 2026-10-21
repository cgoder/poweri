# PowerI-Web 架构与范围边界

> 本文描述 `web/` 的**现状**（上游 v0.8.8 基线 + 迁移期定制），不是终局架构。
> 终局 Agent 边界以 [`../../docs/adr/0011-poweri-web-agent-surface.md`](../../docs/adr/0011-poweri-web-agent-surface.md) 为准；
> 上游差异的唯一机器可读来源是 [`../../docs/web-customizations.json`](../../docs/web-customizations.json)。

## 1. 双入口

| 路由 | 渲染链 | 谁在用 |
|---|---|---|
| `/` | `app/page.tsx` → `components/AppShell`（上游）→ `components/ChatWindow` → … | 上游 UI 的兼容入口，PowerI 产品不使用 |
| `/poweri` | `app/poweri/page.tsx`（新增）→ `poweri/layout/AppShell`（替换件）→ `poweri/components/ChatWindow` → `poweri/components/MessageView` → `poweri/components/MarkdownBody` | PowerI 产品入口 |

`proxy.ts` 的 matcher 已包含 `/poweri` 与 `/poweri/:path*`（该改动登记在清单的 `gateway-adapter` 类）。

## 2. 三类代码来源

| 来源 | 判据 | 数量 | subtree pull 冲突面 |
|---|---|---|---|
| **上游共享文件**（`components/`、`lib/`、`hooks/`、`app/api/` …） | 与上游 `v0.8.8` 同名同路径 | 109 个被侵入 | 有：上游改动 ∩ 本方改动 = 必检集 |
| **poweri/ 产品层**（新增文件） | 上游无同名文件 | 73 个文件 | 无（零冲突） |
| **其它新增**（测试、k8s 清单、图标） | 上游无同名文件 | 105 个文件 | 无 |

侵入的 109 个文件按性质分 6 类（见清单 `categories`）：

| 类别 | 数量 | 含义 |
|---|---|---|
| `gateway-adapter` | 20 | 让上游本地形态跑在 Gateway → Worker PVC 之上 |
| `upstream-sync` | 10 | 吸收 pi/Next 版本演进（事件形状、依赖升级） |
| `poweri-product` | 36 | **在产品层之外实现的产品能力**（待收敛） |
| `test-harness` | 34 | 测试随实现同步 / 改 jiti 动态 import |
| `branding` | 7 | 图标、离线页、视口变量 |
| `build-config` | 2 | eslint / tsconfig |

## 3. 范围边界（纪律）

1. **新能力优先落在 `poweri/`**：上游不存在的路径 → subtree pull 零冲突。
2. **必须改上游文件时**，两件事同时做：
   - 登记 `docs/web-customizations.json` 的 `intrusions`（文件 + 理由 + 风险）；
   - 若 `poweri/` 下已有同名替换件，`/poweri` 入口走替换件，`/` 入口走上游文件，两者不得互相 import。
3. **替换件登记**：`poweri/` 下与上游同名同路径的文件必须登记在 [`replacements.json`](./replacements.json)（遮蔽关系 + 风险等级）。
4. **不改上游 `bin/`**：PowerI 自己的启动器是 `poweri/bin/poweri-web.js`，通过 `require` 委托上游启动器。
5. **上游升级**按 [`../../docs/upstream-upgrade-process.md`](../../docs/upstream-upgrade-process.md) 执行；校验脚本 FAIL 时禁止带病升级。

## 4. 已知偏离（升级前必须知道）

- `poweri-product` 类 36 个侵入中有 **6 个 high**：`components/AppShell.tsx`、`components/ChatInput.tsx`、`components/ModelsConfig.tsx`、`components/PluginsConfig.tsx`、`components/SessionSidebar.tsx`、`components/SkillsConfig.tsx`。这些文件同时存在上游版本与 `poweri/` 替换件，两条实现路径并存，未收敛。
- `bin/pi-web.js`、`bin/pi-web-options.js` 被 `poweri-product` 类侵入（CLI 帮助/端口校验），与"不改上游 bin/"的约定冲突，属待决策项。
- 上游已发布到 **0.12.2**（2026-10-15），本地基线仍是 **0.8.8**；落后 21 个版本（含 4 个 minor），**从未做过一次 subtree pull**。

## 5. 与其它文档的关系

- 术语与业务模型：仓库根 `CONTEXT.md`
- 上游差异清单：`../../docs/web-customizations.json`（机器）/ `../../docs/web-customizations.md`（人读）
- 目录级文件地图：[`file-map.md`](./file-map.md)
- 独立启动器：[`poweri-web-standalone.md`](./poweri-web-standalone.md)
