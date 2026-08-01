# 14 — User Memory 生态包深度调研与选型（决策挂起项）

**What to build:** 对 pi.dev 生态记忆扩展包做**深度调研**（非代码任务），产出可执行的选型决策与切换方案。当前 ticket 08 的自研实现（`1ed52d7`）是**占位方案**——决策挂起，暂不替换，待本 ticket 定案后迭代。

**背景:** `docs/research/pi-memory-extensions.md`（三包初步对比：pi-memory 0.4.0 与自研同构且更成熟 / hermes 0.9.2 功能最全但有原生依赖与后台 LLM 成本 / observational 3.0.3 形态错配）。

**Blocked by:** 无（独立调研任务；切换动作若被批准则 blocked by 08 验证基线）

**Status:** done（决策定案：保留自研 + 移植最佳实践，实证见 `docs/research/pi-memory-deep-research.md`）

调研清单（deep research 深度）：
- [x] 各包源码精读：注入机制实现在哪一层（context 事件 vs before_provider_request vs system prompt 链）——**必须先实证 pi-memory 在 llsm 网关 + headless RPC 下的注入是否生效**
- [x] pi 0.83.0 + Node 24 容器内加载兼容性实证（安装包 → 真实 RPC 链路验证写入与注入）
- [x] 依赖与镜像影响：hermes 的 better-sqlite3 原生构建成本/ABI 风险；qmd 的 embedding 模型下载与离线可用性
- [x] 后台 LLM 成本量化：hermes review/observational worker 在 10k 用户规模的预估成本 vs 零额外调用方案
- [x] KV 缓存稳定快照的价值量化：注入字节稳定性对前缀缓存/延迟的影响
- [x] 存量数据初始化迁移成本：自研 memory.md 三节格式 ↔ pi-memory 条目格式（§ 分隔?）双向兼容评估
- [x] 决策产出：替换（含切换路径与回滚）/ 保留自研 + 移植最佳实践 / 混合，更新 spec 与 ADR-0008

## 决策定案（2026-08-01）

**保留自研 + 移植最佳实践（不替换）。** 实证：

- pi-memory 注入在 0.83.0 生效（`before_agent_start` systemPrompt 路径，mock provider 抓真实 payload 命中）——生态标准路径，建议自研迁移此注入点
- **平台形态结构性冲突（决定性）**：pi-memory 在 `session_shutdown` 时若消息 ≥4（含工具调用必达）触发 exit summary 额外 LLM——平台"每请求一进程"= 每含工具请求 +1 次 LLM（10k 用户每日 ~12 亿额外 tokens），**无官方开关**；daily 文件无锁并发写风险
- hermes：policy-only 注入模型不同 + better-sqlite3 原生依赖 + 后台 review 成本；observational：session 内存储形态错配
- 移植清单（立 ticket 18）：注入点迁移 before_agent_start / 中截断对齐 / daily 日志（加锁）/ 删除恢复 / 稳定快照

实证证据全文：`docs/research/pi-memory-deep-research.md`

## Comments

- 2026-08-01 调研执行（dev 分支）：源码精读三包 + 容器实证（poweri-worker:local 内 jiti 加载 .ts、mock OpenAI provider 抓真实 payload）+ 成本量化。实证记录见 `docs/research/pi-memory-deep-research.md`。
- 关键实证：pi-memory 注入生效（before_agent_start systemPrompt 进入最终负载）；exit summary 在平台形态下每含工具请求触发 1 次额外 LLM（无开关）。
