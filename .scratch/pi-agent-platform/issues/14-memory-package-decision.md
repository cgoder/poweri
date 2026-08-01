# 14 — User Memory 生态包深度调研与选型（决策挂起项）

**What to build:** 对 pi.dev 生态记忆扩展包做**深度调研**（非代码任务），产出可执行的选型决策与切换方案。当前 ticket 08 的自研实现（`1ed52d7`）是**占位方案**——决策挂起，暂不替换，待本 ticket 定案后迭代。

**背景:** `docs/research/pi-memory-extensions.md`（三包初步对比：pi-memory 0.4.0 与自研同构且更成熟 / hermes 0.9.2 功能最全但有原生依赖与后台 LLM 成本 / observational 3.0.3 形态错配）。

**Blocked by:** 无（独立调研任务；切换动作若被批准则 blocked by 08 验证基线）

**Status:** ready-for-agent

调研清单（deep research 深度）：
- [ ] 各包源码精读：注入机制实现在哪一层（context 事件 vs before_provider_request vs system prompt 链）——**必须先实证 pi-memory 在 llsm 网关 + headless RPC 下的注入是否生效**
- [ ] pi 0.83.0 + Node 24 容器内加载兼容性实证（安装包 → 真实 RPC 链路验证写入与注入）
- [ ] 依赖与镜像影响：hermes 的 better-sqlite3 原生构建成本/ABI 风险；qmd 的 embedding 模型下载与离线可用性
- [ ] 后台 LLM 成本量化：hermes review/observational worker 在 10k 用户规模的预估成本 vs 零额外调用方案
- [ ] KV 缓存稳定快照的价值量化：注入字节稳定性对前缀缓存/延迟的影响
- [ ] 存量数据初始化迁移成本：自研 memory.md 三节格式 ↔ pi-memory 条目格式（§ 分隔?）双向兼容评估
- [ ] 决策产出：替换（含切换路径与回滚）/ 保留自研 + 移植最佳实践 / 混合，更新 spec 与 ADR-0008
