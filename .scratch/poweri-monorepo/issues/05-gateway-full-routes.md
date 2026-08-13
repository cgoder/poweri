# 05 — 网关模式全功能

**What to build:** 补齐网关模式下其余路由的网关分支（会话改名/删除/导出、模型/能力查询等与网关相关的接口），使 web 网关模式能力与旧 poweri-web 等价；平台单一模型标识在全部相关位置收敛完成，前端状态/历史上下文/网关三方一致。

**Blocked by:** 04

**Status:** resolved

- [x] 网关模式下会话改名/删除/历史导出可用
- [x] 网关模式下模型展示/选择收敛为平台单一模型，无残留多模型逻辑
- [x] 与旧 poweri-web 网关模式能力逐项对照无缺失（对照清单留档）
- [x] 单测回归通过（含新增分支覆盖）
- [x] 定制清单记录更新（新增侵入点入账）

## Comments

- 2026-08-13：网关模式全功能补齐，能力与旧 poweri-web 等价。
  **对照清单**（旧仓库 15 个网关分支文件 → 本票完成 7 个路由 + 新增 4 个 v0.8.8 路由 + 2 个安全拒绝）：
  - 旧能力逐项：file-index（递归列出 + q 过滤）、files/[...path]（read/meta/list）、plugins（GET 空/POST 拒绝）、skills（GET 扫描/PATCH 拒绝）、sessions/[id]/auto-name（首条用户消息派生标题）、export（JSONL 落临时文件导出 + 清理）、sessions/[id] PATCH/DELETE（网关 → bridge 写/删 worker PVC，删除时 registry shutdown）——全部可用 ✅
  - v0.8.8 新增路由补网关分支：sessions/[id]/context（经 gatewayHistoryContext，与主路由 GET 共用映射防漂移）
  - 安全拒绝（宿主面隔离）：cwd/browse + cwd/validate 网关模式 400（工作区固定 /workspace；上游 browse 无授权检查，防宿主目录枚举）
  - 模型收敛复核：models/models-config 已是单一模型（ticket 04）；前端无残留多模型逻辑（网关模式 cwd 固定，DirectoryPicker/自定义路径流程不出现）
  **gateway 配套**（fake 测试缝，源已冻结）：fake 落盘首行补 session header（真实 pi 会话文件格式，SDK 导出/校验路径可用）；localFiles/localFile 路径语义对齐 bridge（/workspace 前缀映射、未初始化目录返回空列表、递归输出对齐 /workspace/... 形状）。
  **验证**（fake 网关 local）：改名 PATCH → 列表 name 更新 ✅；删除 DELETE → 列表消失 ✅；export → 200 text/html（SDK 导出管线）✅；auto-name → 标题派生 ✅；context → 2 消息 + poweri-gw ✅；file-index 递归 + q=main 过滤 ✅；files list/read/meta ✅；skills 播种扫描 ✅；skills PATCH 400 / plugins POST 400 / cwd browse 400 ✅；bob 跨用户隔离（空工作区/空技能）✅。
  **测试**：新增 lib/gateway-routes-gateway.test.mjs 11 例（分支源码断言 + fake fetch 文件/技能接入）；web 全量 572/572（549 上游 + 23 适配层）零回归；gateway 14/14；worker 10/10。
  **定制清单**：docs/web-customizations.md 新增 11 个侵入点入账（8 路由 + cwd×2 + 既有行更新）。
  **遗留**：真实 pi 全链路冒烟（bridge/docker provider + 浏览器）→ ticket 07；定制清单校验脚本 → ticket 08。
