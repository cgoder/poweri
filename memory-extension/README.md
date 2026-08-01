# User Memory 扩展（ticket 08）

pi 扩展：在工作区（该用户 PVC）维护 User Memory 文件，随 agent 执行循环动态读写/注入，使平台越来越懂用户。

## 文件

- `user-memory.mjs` — 扩展主体（打包进 Worker 镜像 `/poweri/extensions/`，桥以 `-e` 加载；typebox 从 pi 的 node_modules 解析，无需额外依赖）
- `memory-core.mjs` — 纯逻辑：三节结构、remember 增改、注入截断（可单测）
- `test/memory-core.test.mjs` — 单测（`node --test`）

## 机制（设计见 docs/design/08-user-memory.md，含实证修正）

- **记忆文件**：`/workspace/.poweri/memory/memory.md`（三节：画像/事实/偏好）+ `history/` 写前备份（默认 20 版）+ `recovery/` 覆盖恢复记录
- **写**：agent 回合内调用 `remember(section, fact, replace?)` 工具 → 增量写、幂等去重、事实带日期、原子写回（tmp+rename）——**零额外模型调用**（不做回合后 LLM 摘要）。`replace=true` 覆盖旧行时，旧行自动记入 `recovery/<ts>-<section>.json`
- **恢复**：`memory_restore` 工具按 id（或最近一条）恢复被覆盖的行并移除记录（防误覆盖）
- **读（注入）**：`before_agent_start` 修改 `event.systemPrompt` 追加记忆块（生态标准路径，T18 自 `before_provider_request` 迁入；每 agent 回合触发一次，无累积）。预算内全文 / 超预算保留画像+最近；幂等 MARKER 防重复加载。⚠️ 实证：`context` 事件改消息不进入最终负载——故早期版本用 `before_provider_request` 追加首位消息，T18 统一迁到 `before_agent_start`
- **存量初始化**：`scripts/init-memory.mjs --legacy <json> --data-dir <dir>`，幂等（memory.md 已存在跳过），首次运行空记忆兜底

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `POWERI_MEMORY_DIR` | `<cwd>/.poweri/memory` | 记忆目录（容器内 cwd=/workspace） |
| `POWERI_MEMORY_BUDGET` | 3000 | 注入 token 预算（chars≈tokens×4 估算） |
| `POWERI_MEMORY_BACKUPS` | 20 | history/ 保留版本数 |

## 验证

`node scripts/verify-08.mjs`（Part A 容器级 / Part B 全链路隔离+零成本 / Part C 存量初始化幂等）
