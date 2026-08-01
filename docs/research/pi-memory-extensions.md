# pi 生态 User Memory 扩展包调研（ticket 08 选型）

> 调研背景：我们已按自研方案实现 ticket 08（memory-extension/，`1ed52d7`）。用户提出应评估 pi.dev 生态成熟扩展包，看能否以 package 加载并替代自研实现。本文对比三包与自研方案，给出选型建议。
> 调研时间：2026-08-01。版本：pi-hermes-memory 0.9.2 / pi-memory 0.4.0 / pi-observational-memory 3.0.3（均 MIT）。

## 三包概览

### 1. pi-hermes-memory（0.9.2，MIT）— 功能最全
- **安装**：`pi install npm:pi-hermes-memory`；依赖 `better-sqlite3`（**原生模块**，需按 Node ABI 编译）+ `@earendil-works/pi-tui`
- **存储**：`~/.pi/agent/pi-hermes-memory/`（MEMORY.md + USER.md 各 5K 字符上限 + failures + skills + sessions.db SQLite FTS5）
- **写**：`memory` 工具（add/replace/remove）+ **后台 review（每 10 轮或 15 次工具调用触发，消耗 LLM）** + 纠错即时保存（LLM）+ 超容量自动整合（子进程 LLM）
- **读**：默认 `policy-only`——**只注入 `<memory-policy>` 小策略，agent 按需调 `memory_search`**；`legacy-inject` 模式恢复全文注入
- **亮点**：密钥扫描（API key 不入库）、failure 记忆、可复用 skills（SKILL.md）、会话 FTS5 全历史搜索、双层级（global + per-project）
- **命令**：`/memory-*` 十余条，部分为 TUI 交互（headless RPC 不可用）

### 2. pi-memory（0.4.0，MIT）— 与自研设计同构且更成熟
- **安装**：`pi install npm:pi-memory`；**单文件扩展**，核心零依赖；可选 `qmd`（外部工具 @tobilu/qmd + embedding 模型）获得语义搜索
- **存储**：`~/.pi/agent/memory/`（MEMORY.md + SCRATCHPAD.md + daily/ 日志 + recovery/ 删除恢复）——**`PI_MEMORY_DIR` 可重定向**
- **写**：`memory_write / memory_forget / memory_restore / scratchpad / memory_read / memory_status / memory_search` 工具，**agent 驱动、零额外 LLM 调用**
- **读**：**每轮注入 system prompt**：scratchpad 2K + 今日日志 3K + MEMORY.md 4K（中截断）+ 昨日日志 3K，总 cap 16K；**默认 KV 缓存稳定快照**（checkpoint 间字节稳定，前缀缓存友好）；`per-turn` 模式可选 qmd 选择性注入
- **亮点**：删除可恢复、每日日志自动累积、压缩时 session handoff 写入日志、`memory_forget` 带 recovery id
- **局限**：无密钥扫描、无 failure 记忆、无自动整合（容量靠注入截断兜底）

### 3. pi-observational-memory（3.0.3，MIT）— 解决的是另一问题
- **定位**：长会话压缩连续性（observations + reflections + recall 溯源），非"平台跨会话懂用户"
- **写**：observer/reflector/dropper **后台 worker 循环，按 token 阈值触发，消耗 LLM**（有独立 model 配置）
- **存储**：折叠记忆写入 **session 条目内**（om.folded），非独立文件——跨会话依赖 session JSONL，与我们的"每用户文件"模型不同构
- **结论**：解决长会话压缩体验，与"每请求短 Pod + 跨会话用户记忆"的平台形态错配

## 与自研方案对比（对齐 4 项已确认决策 + 平台约束）

| 维度 | 自研（ticket 08） | pi-hermes-memory | pi-memory | pi-observational-memory |
|---|---|---|---|---|
| 写路径 | remember 工具，**零额外 LLM** | memory 工具 + 后台 review/纠错/整合（**额外 LLM**） | memory_write 等工具，**零额外 LLM** | 后台 worker（**每阈值额外 LLM**） |
| 读/注入 | before_provider_request 追加，预算 3000t 截断 | 默认 policy-only（按需搜索）；legacy-inject 全文 | **每轮注入**（4K 中截断，16K cap），**KV 缓存稳定** | 压缩时注入折叠记忆 |
| 存储 | `/workspace/.poweri/memory/`（**用户可见**） | `~/.pi/agent/...`（隐藏）+ SQLite | `~/.pi/agent/memory`（**可用 PI_MEMORY_DIR 指向工作区**） | session 条目内 |
| 依赖 | 无（typebox 复用 pi） | **better-sqlite3 原生**（镜像构建/ABI 风险） | 核心无；qmd 可选 | 无原生（pi 子进程） |
| 10k 用户成本 | 注入 ≤3000t/轮 | 后台 review 每用户每 10 轮 +1 次 LLM（可 `reviewEnabled:false` 关） | 注入 ≤16K/轮（4K MEMORY 中截断） | 后台 worker 每用户多轮 LLM，成本最高 |
| headless RPC | ✓（实测） | 工具可 headless；命令多为 TUI | ✓（纯工具+注入） | ✓（但为长交互会话设计） |
| 额外能力 | — | 密钥扫描 / failure / skills / FTS5 搜索 | scratchpad / daily 日志 / 删除恢复 / handoff | recall 溯源 / 压缩加速 |

## 关键风险点（决定选型后必须先实证）

1. **注入机制兼容性**：自研实证发现 `context` 事件改消息**不进入最终 provider 负载**，唯一可靠路径是 `before_provider_request` 追加首位消息。pi-memory 宣称"每轮注入 system prompt"——**若它走 context 事件，在我们的 llsm 网关下会失效**，必须容器实测。
2. **pi 0.83.0 扩展 API 兼容**：三包均为较新版本，需验证在锁定的 pi 0.83.0 + Node 24 下加载无错。
3. **原生依赖**：hermes 的 better-sqlite3 需在镜像内编译（构建时间/体积/ABI 漂移），与"单 Node 运行时、镜像最小化"原则冲突。
4. **后台 LLM 成本**：hermes/observational 的后台机制在 10k 用户下成本不可忽视；hermes 可关（`reviewEnabled:false`、`correctionDetection:false`）但核心注入模型仍与我们不同（policy-only 搜索）。

## 选型建议

> **最终决策（ticket 14，2026-08-01）：保留自研 + 移植最佳实践，不替换。** 深度实证见 `docs/research/pi-memory-deep-research.md`。本文档为初步对比，方向已被实证修正：

- **pi-memory 注入实证生效**（`before_agent_start` systemPrompt 进入最终负载，容器实测），但其会话级 **exit summary**（每次含工具请求结束 +1 次 LLM，无开关）与平台“每请求一进程”形态结构性冲突；daily 无锁写与跨会话并行冲突 → **不整体替换**，移植其成熟细节（KV 快照、中截断、删除恢复、注入点迁移）至自研（ticket 18）。
- **hermes**：policy-only 注入模型与自研“预算内全文注入”不同；better-sqlite3 原生依赖 + 后台 review 成本（可关但改变注入模型）→ 不推荐。
- **observational**：session 内存储，形态错配 → 排除。
