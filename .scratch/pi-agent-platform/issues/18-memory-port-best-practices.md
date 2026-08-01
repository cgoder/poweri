# 18 — User Memory 移植生态最佳实践（ticket 14 决策落地）

**What to build:** 按 ticket 14 决策"保留自研 + 移植最佳实践"，把 pi-memory / hermes 的成熟细节移植进自研 `memory-extension/`（ticket 08 实现），保持零额外 LLM 承诺与平台形态兼容。

**Blocked by:** 14 — User Memory 生态包深度调研与选型（决策已定案）；08 — 自研基线（verify-08 验证基线）

**Status:** done（注入点迁移 + 删除恢复 + 稳定快照确认 + daily 日志评估不做；验证：单测全过 + verify-08 Part A/C 过，Part B 因宿主模型配置缺失跳过）

**背景:** `docs/research/pi-memory-deep-research.md` 决策。pi-memory 注入机制已实证在 pi 0.83.0 生效（`before_agent_start` systemPrompt 路径，进入最终 provider 负载）；但其 exit summary（会话结束额外 LLM，无开关）与 daily 无锁写与平台"每请求一进程 + 跨会话并行"冲突，故不整体替换，移植其成熟细节。

移植清单（按优先级）：
- [x] **注入点迁移**：`before_provider_request` 手动拼首位消息 → `before_agent_start` 修改 `event.systemPrompt`（生态标准；保留幂等 MARKER 防扩展重复加载；保留 POWERI_MEMORY_BUDGET 预算与截断）
- [x] **稳定快照**：确认平台形态下字节天然稳定（每请求一进程 + before_agent_start 每回合一次 → 注入由 memory.md 内容决定，内容不变则字节不变；前缀缓存友好），无需进程内快照缓存（已记入设计文档 4.3）
- [x] **删除恢复**：remember `replace=true` 覆盖时旧行写入 `memory/recovery/<ts>-<section>.json`；新增 `memory_restore` 工具按 id/最近一条恢复并移除记录
- [x] **daily 日志**：**评估后不做**——平台每请求写 daily + 跨会话并行 → 无锁并发写风险 > 收益；三节记忆 + facts 日期前缀已覆盖"今日上下文"语义（已记入决策）
- [x] 中截断策略对齐：现有"画像全保留 + 事实/偏好最近条目"与 pi-memory 思路一致，无需改动

验证：
- [x] core 单测 11 项全过（新增 replaced 暴露 / applyRecover 恢复 + 防重复 / facts 日期版本覆盖）
- [x] verify-08 回归：Part A（真实模型容器级）注入点迁移后写入/跨进程注入全过；Part C 幂等初始化全过
- [x] verify-08 加环境自检：宿主 models.json 缺 poweri-gw provider 时跳过 Part B 并提示（gen-pi-config），不再静默空响应

## Comments

- 2026-08-01 实现（main 分支，T14 合并后）：注入点迁移 + 删除恢复 + 稳定快照确认 + daily 日志评估（不做）。实证：多轮 mock 验证 before_agent_start 每 agent 回合触发一次（工具续轮不重复）→ 无累积、回合内写入下一请求生效。
- Part B（gateway 全链路）未跑：宿主 ~/.pi/agent/models.json 被 LITTA（claude-cli）配置覆盖，缺 poweri-gw provider（verify-08 已检测并跳过）。补配置后重跑即可。

## Comments

- 2026-08-01 由 ticket 14 决策立档。
