# 17 — pi-web 网关客户端化评估（ticket 15 后续项）

**What to build:** 评估并（若可行）实施把 pi-web 的 agent 驱动层从"进程内 SDK"改为 PowerI 网关客户端（SSE `/v1/chat` + WS `/v1/ws` + Bearer token + 会话历史接口），使可视化界面走完整平台链路（认证/路由/串行/计量/记忆）。

**Blocked by:** 15 — pi-web 可视化多用户验证（方案 A 已落地，本 ticket 为方案 B 评估）

**Status:** needs-triage（决策挂起，暂不实施）

**背景:** `docs/research/pi-web-visual-multiuser.md` 的方案 B。ticket 15 用方案 A（每用户实例直连，绕过网关）满足了可视化核心诉求（多用户并发/隔离/续接）；网关行为已由 verify-05/06/09/16 严格覆盖。本 ticket 是"完整链路可视化"的增量，改造量大、需 fork 上游持续跟随升级。

评估要点：
- [ ] 改造面盘点：`lib/rpc-manager.ts` 的 `startRpcSession`/`send`/`onEvent` 换为网关客户端；Session/文件浏览/模型配置等本地概念逐层适配
- [ ] 收益确认：完整链路可视化（认证/路由/串行/计量/记忆全走平台）vs 方案 A 已满足的核心诉求
- [ ] 成本确认：fork 上游、持续跟随升级（pi-web 0.8.x 迭代快）、session JSONL 布局差异（pi-web 嵌套 vs 平台顶层）
- [ ] 决策产出：做（含迁移路径与回滚）/ 不做（以方案 A 为最终形态）

## Comments

- 2026-08-01 由 ticket 15 立档：ticket 15 明确"本 ticket 不做"，故另立本 ticket 跟踪方案 B 决策。
