# pi 生态 User Memory 包深度调研（ticket 14 决策实证）

> 调研时间：2026-08-01（dev 分支）。任务：ticket 14——对 pi.dev 生态记忆扩展包做深度调研（源码精读 + 容器实证 + 成本量化），产出选型决策。
> 前置材料：`docs/research/pi-memory-extensions.md`（初步对比）。本文件记录**实证证据**与**最终决策**。
> 版本：pi 0.83.0（平台锁定）/ pi-memory 0.4.0 / pi-hermes-memory 0.9.2 / pi-observational-memory 3.0.3（均 MIT）。

## 一、实证结论（全部真实链路验证）

### E1. 注入机制：三包注入路径确认（清单第 1 条）✅

**生态标准注入路径 = `before_agent_start` 修改 `event.systemPrompt`**：

- pi-memory 0.4.0：`pi.on("before_agent_start", ...)` 返回 `{ systemPrompt: event.systemPrompt + "\n\n## Memory ..." }`
- hermes 0.9.2：同一路径（`src/index.ts:193`，policy-only 模式注入 `<memory-policy>` 小策略）
- 源码链路（pi 0.83.0 `dist/core/agent-session.js` + `pi-agent-core`）：`before_agent_start` 返回值 → `_systemPromptOverride` → `agent.state.systemPrompt` → `createContextSnapshot()` → `llmContext.systemPrompt` → provider payload（作为首条 system 消息）

**实测**（mock OpenAI provider 抓真实 payload）：
- 本地 bun 形态 pi 0.83.0：预置 MEMORY.md → system prompt 9972 字符，含 `## Memory` 与记忆内容 ✅
- 容器 npm 形态（Node 24 + jiti 加载 .ts）：system prompt 3379 字符，注入命中 ✅
- 结论：**pi-memory 注入在 llsm 网关 + headless RPC 下生效**。与自研的 `before_provider_request` 手动拼首位消息是两条独立且都有效的通道；`before_agent_start` 更干净（不用操作消息数组），建议自研迁移。

### E2. 容器加载兼容性（清单第 2 条）✅

| 包 | 命名空间 | 容器实测（poweri-worker:local，Node 24，npm 形态 pi 0.83.0） |
|---|---|---|
| pi-memory 0.4.0 | **旧**（`@mariozechner/pi-*`，运行时 import） | ✅ 加载无错 + 注入命中 + `memory_write` 工具执行 + MEMORY.md 落盘 + `$ENV` key 插值正常。旧命名空间被 pi 0.83.0 扩展加载器**显式 alias**（`VIRTUAL_MODULES` / jiti `getAliases`：`@mariozechner/pi-ai → compat` 等），零适配 |
| hermes 0.9.2 | 新（`@earendil-works/pi-*` ≥0.74） | ✅ 加载无错 + policy-only 注入命中；better-sqlite3@12.9 prebuilt 命中（linux-arm64 无需编译），FTS5 可用 |
| observational 3.0.3 | 新 | 未测（决策排除，见 E5） |

要点：pi-memory 发布**原始 TypeScript**（`main: index.ts`），pi 0.83.0 用 jiti 加载 .ts（bun 二进制用 virtualModules）——平台 npm 形态实测 OK。

### E3. 依赖与镜像影响（清单第 3 条）✅

- **hermes**：`better-sqlite3@12.9`（原生）——本次实测 prebuilt 命中无需编译；**风险残留**：Node 大版本升级后 prebuilt 可能缺位 → 需 build-essential 编译（镜像体积 + 构建时间 + ABI 漂移）。另依赖 `@earendil-works/pi-tui`。
- **qmd**（pi-memory 可选语义搜索）：外部工具 + embedding 模型下载。不装则 `memory_search` 不可用，但**注入与写入完全正常**（实证）。平台无搜索刚需 → 不引入。

### E4. 后台 LLM 成本量化（清单第 4 条）——关键发现 ⚠️

**pi-memory 不是"零额外 LLM"**：

- `session_shutdown` 时若会话消息 ≥ `EXIT_SUMMARY_MIN_MESSAGES`（4）→ 触发 **exit summary**：1 次额外 LLM（`reasoningEffort: "low"`，输入 = 整个会话文本截断 80K 字符），摘要写入 daily 日志，下次会话注入。
- **平台形态（每请求一 Pod、请求结束杀 pi）= 每次含工具调用的请求结束都触发 1 次 summary**（实测：mock provider 捕获到第三个请求 `You are a session recap assistant`）。新会话首轮（2 条消息）跳过；任何含工具调用的回合（messages ≥4）必触发。
- **无官方开关**：env 仅有 `PI_MEMORY_SUMMARIZE_TRANSITIONS`（控制 reload/new/resume/fork 跳过），`session-end` 不可关。
- **10k 用户估算**：假设每人每天 15 个含工具请求 × 平均 8K input tokens/次 ≈ 12 亿 tokens/天纯额外输入（~$2/M 计 ≈ $2400/天），且随会话深度增长。
- **附带风险**：daily 文件无锁 `writeFileSync` 直接写——平台"跨会话并行"（ADR-0005）下同用户多会话并发写同一 daily 文件有损坏风险。

**hermes**：后台 review 每 10 轮 / 15 次工具调用 +1 次 LLM（`nudgeInterval=10`、`nudgeToolCalls=15`，且 userTurnCount≥3、parts≥4）；纠错、自动整合亦有额外 LLM。可经 `hermes_config` 关闭（`reviewEnabled:false`、`correctionDetection:false`），但 policy-only 注入模型（agent 按需 memory_search）与自研的"预算内全文注入"不同。

**observational**：observer/reflector/dropper 后台 worker 按 token 阈值触发（`observeAfterTokens` 等），长会话成本最高。

**自研（ticket 08）**：remember 工具回合内写入，零额外 LLM（agent_settled 后不做摘要）——实证零额外模型调用（verify-08 Part B）。

### E5. 形态确认（observational）

折叠记忆写入 **session 条目内**（folded ledger），非每用户独立文件；定位长会话压缩连续性，与平台"每请求短 Pod + 跨会话用户记忆"不同构 → **排除**。

### E6. KV 缓存稳定快照（清单第 5 条）

- pi-memory `stable` 模式（默认）：checkpoints（session_start / session_before_compact / long_term 写 / 日切换）间注入**字节稳定** → 前缀缓存友好；`per-turn` 模式用 qmd 选择性注入。
- 自研：注入内容完全由 memory.md 决定，文件不变则字节天然稳定；可移植"显式快照刷新时机"理念。
- 平台走 llsm 网关（OpenAI 兼容），前缀缓存价值取决于网关实现——加分项，非决定性。

### E7. 存量数据迁移（清单第 6 条）

- 自研：`/workspace/.poweri/memory/memory.md` 三节（`## 画像 / ## 事实 / ## 偏好`）。
- pi-memory：`MEMORY.md` 自由 markdown（#tags/[[links]]）+ `SCRATCHPAD.md` + `daily/YYYY-MM-DD.md` + `recovery/`。
- 迁移：自研→pi-memory 语义保留可直接拷贝；pi-memory→自研需按节归并（规则/LLM）。**保留自研则存量零迁移**。

## 二、选型决策：保留自研 + 移植最佳实践（不替换）

**结论：pi-memory 不替换自研实现。** 自研作为平台形态下的记忆内核，移植 pi-memory 的成熟细节。

### 理由

1. **结构性成本冲突（决定性）**：平台"每请求一进程"形态与 pi-memory 的会话级 exit summary 冲突——每含工具请求 +1 次 LLM（10k 用户每日 ~12 亿额外 tokens），且无官方开关；平台硬约束"10k 用户成本可控"（spec Implementation Decisions + 自研设计 4.4）不满足。
2. **并发写风险**：pi-memory daily 文件无锁写，与平台跨会话并行语义冲突。
3. **自研已满足核心需求**：预算内注入、remember 零额外写入、物理隔离、跨会话持久、存量幂等初始化——verify-08 A/B/C 全部通过；注入路径已实证（E1）。
4. **生态经验可移植，成本低**：均为小模块，不引入新依赖。

### 移植清单（后续迭代，新 ticket）

- [ ] **注入点迁移**：`before_provider_request` → `before_agent_start` systemPrompt（生态标准，实证可用，代码更干净）
- [ ] **中截断策略对齐**：分节截断（画像全保留 + 事实/偏好最近条目），对齐 pi-memory 的 `formatContextSection` 思路
- [ ] **daily 日志**：按日累积 + 今日/昨日注入——**平台形态必须加锁/合并写**（跨会话并行安全）
- [ ] **删除恢复**：`memory_forget` 写 recovery 记录（pi-memory `recovery/<id>.json` 模式）
- [ ] **稳定快照**：记忆文件未变则不重组装注入（字节稳定，前缀缓存友好）
- [ ] **KV 快照刷新时机**：对齐 pi-memory checkpoints 理念

### 不推荐项（复述）

- hermes：原生依赖 + 后台 review 成本与 10k 平台冲突（除非全关后台机制并接受 policy-only 搜索模型——与已确认的"预算内全文注入"决策不符）。
- observational：形态错配（session 内存储）。
- pi-memory 替换：exit summary 成本 + daily 并发写 + 无开关。

## 三、实证环境复现

```bash
# 环境：poweri-worker:local（pi 0.83.0 + Node 24 容器）/ mock OpenAI provider（抓 payload）
# mock-provider.mjs / probe.mjs / mock-tools.mjs 存于调研临时目录（非仓库）
# 关键复现：预置 MEMORY.md → pi --mode rpc -e <pi-memory>/index.ts -p "你好"
#   → 宿主 mock 捕获 payload：system prompt 含 "## Memory"（注入生效）
#   → 工具调用流（memory_write）：MEMORY.md 落盘 + 第三请求 session recap（exit summary 触发）
```
