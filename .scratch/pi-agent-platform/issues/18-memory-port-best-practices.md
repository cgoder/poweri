# 18 — User Memory 移植生态最佳实践（ticket 14 决策落地）

**What to build:** 按 ticket 14 决策"保留自研 + 移植最佳实践"，把 pi-memory / hermes 的成熟细节移植进自研 `memory-extension/`（ticket 08 实现），保持零额外 LLM 承诺与平台形态兼容。

**Blocked by:** 14 — User Memory 生态包深度调研与选型（决策已定案）；08 — 自研基线（verify-08 验证基线）

**Status:** ready-for-agent

**背景:** `docs/research/pi-memory-deep-research.md` 决策。pi-memory 注入机制已实证在 pi 0.83.0 生效（`before_agent_start` systemPrompt 路径，进入最终 provider 负载）；但其 exit summary（会话结束额外 LLM，无开关）与 daily 无锁写与平台"每请求一进程 + 跨会话并行"冲突，故不整体替换，移植其成熟细节。

移植清单（按优先级）：
- [ ] **注入点迁移**：`before_provider_request` 手动拼首位消息 → `before_agent_start` 修改 `event.systemPrompt`（生态标准；保留幂等 MARKER 防重复追加；保留 POWERI_MEMORY_BUDGET 预算与截断）
- [ ] **稳定快照**：记忆文件未变（remember 写入/日切换外）则不重组装注入，字节稳定 → 前缀缓存友好（对齐 pi-memory `stable` 模式 checkpoints 理念）
- [ ] **删除恢复**：`remember` 增加删除/替换的 recovery 记录（pi-memory `recovery/<id>.json` 模式），可恢复误删
- [ ] **daily 日志**（可选，需评估）：按日累积日志 + 今日/昨日注入——**平台形态下写入必须加锁/原子合并**（跨会话并行安全，ADR-0005），否则不做
- [ ] 中截断策略对齐：分节截断细化（画像全保留 + 事实/偏好最近条目，已基本具备，视评估微调）

验证：扩展 verify-08（新增注入点/快照/恢复断言）；隔离与零额外 LLM 断言保持。

## Comments

- 2026-08-01 由 ticket 14 决策立档。
