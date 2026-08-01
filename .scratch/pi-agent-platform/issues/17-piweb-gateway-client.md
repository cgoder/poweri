# 17 — pi-web 网关客户端化评估（ticket 15 后续项）

**What to build:** 评估并（若可行）实施把 pi-web 的 agent 驱动层从"进程内 SDK"改为 PowerI 网关客户端（SSE `/v1/chat` + WS `/v1/ws` + Bearer token + 会话历史接口），使可视化界面走完整平台链路（认证/路由/串行/计量/记忆）。

**Blocked by:** 15 — pi-web 可视化多用户验证（方案 A 已落地，本 ticket 为方案 B 评估）

**Status:** done（决策：**不实施 fork**，理由见下；方案 A 为最终形态）

**背景:** `docs/research/pi-web-visual-multiuser.md` 的方案 B。ticket 15 用方案 A（每用户实例直连，绕过网关）满足了可视化核心诉求（多用户并发/隔离/续接）；网关行为已由 verify-05/06/09/16 严格覆盖。本 ticket 是"完整链路可视化"的增量评估。

## 评估结论：不做（以方案 A 为最终形态）

**1. 收益已被现有验证覆盖。**
- 可视化的核心诉求（多用户并发 / 数据隔离 / 会话续接 / 配置隔离）方案 A 已满足并通过 verify-15 A–E。
- 网关行为（认证 / 路由 / 会话串行 / 计量 / 记忆注入）由 verify-05（并发串行 fake 时序）、06（流式 + 真实链路 + 断线续接）、09（计量账单）、16（真实 K8s 多用户隔离）覆盖。
- 方案 B 的增量仅是"把这些已有验证可视化"——演示价值 > 验证价值。

**2. 改造面远超"换驱动层"——pi-web 的 UI 大面积耦合本地文件系统。**
源码盘点（`app/api/` 33 条路由）：与本地文件系统/本地进程强耦合的有 `files/[...path]`、`git/status`、`git/diff`、`worktrees`、`file-index`、`cwd/validate`、`cwd/browse`、`default-cwd`、`project-trust`、`models-config`（读写本地 models.json）、`models`、`skills`、`plugins`、`sessions/[id]/export`、`home` 等；只有 `agent/*`（进程内会话）是纯驱动层。
网关当前仅有 `/v1/chat`、`/v1/ws`、`/v1/sessions/<id>/messages`——文件浏览、git、worktrees、模型配置、技能管理均无服务端 API。
→ fork 后要么砍掉大半 UI 功能（退化为纯聊天窗口），要么给网关补一整套文件/配置/技能 API（等于把 pi-web 的文件系统能力整体服务器化，工程量数量级放大）。

**3. 形态错配（架构层）。** pi-web 进程内 SDK 驱动 pi，正是 ADR-0002 明确拒绝的形态（失去进程隔离，pi 崩溃拖垮 UI 进程）。网关客户端化等于把平台核心的"进程隔离"架构在 UI 层逆转；且 gateway 侧为无状态多租户设计，pi-web 的本地单用户概念（worktree、project-trust、skills 开关）没有直接映射。

**4. 维护成本。** fork 上游需持续跟随 pi-web 0.8.x 迭代；session JSONL 布局差异（pi-web 嵌套 `sessions/<slug>/<ts>_<id>.jsonl` vs 平台顶层 `sessions/<id>.jsonl`）需兼容层。

**替代方向（若未来需要完整链路可视化）：** 自研轻量网关客户端前端（直接调 `/v1/chat` SSE + `/v1/ws` + Bearer token + 历史接口），而非 fork pi-web——是全新 UI 工程，当前无产品诉求，不立 ticket，需要时再议。

**已覆盖的潜在缺口：** 真实多用户**同时**打网关（docker provider + 双 token 并发）目前无专门 verify——verify-06 并发用 fake、verify-k8s 多用户串行。若需补，加一个 verify 脚本即可（双 token 同时调真实 docker provider），不依赖 pi-web。

## Comments

- 2026-08-01 由 ticket 15 立档：ticket 15 明确"本 ticket 不做"，故另立本 ticket 跟踪方案 B 决策。
- 2026-08-01 决策（dev 分支）：**不做 fork**。方案 A + 现有 verify 已覆盖收益；改造面为"换驱动层 + 补整套服务端 API"两级放大；形态与 ADR-0002 冲突；维护成本高。替代方向（自研轻量网关客户端前端）无当前诉求，不立 ticket。
