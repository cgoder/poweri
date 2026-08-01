# 08 — User Memory 扩展 + 存量数据初始化

**What to build:** 一个打包进 Worker 镜像的 pi 扩展（`/poweri/extensions/user-memory.mjs`，桥以 `-e` 加载），在工作区 `/workspace/.poweri/memory/`（该用户 PVC）维护三节记忆文件（画像/事实/偏好）；`before_provider_request` 把记忆块按预算上限截断追加到首位 system/developer 消息（实证：context 事件改消息不生效）；agent 在回合内调用 `remember(section, fact, replace?)` 工具增量写入（零额外模型调用，写前备份到 history/，原子写回）；上线时 `scripts/init-memory.mjs` 把存量数据按用户分批、幂等地初始化进 memory.md（已存在则跳过），首次运行空记忆兜底。

**Design:** docs/design/08-user-memory.md（调研+论证+设计三步定稿）

**Blocked by:** 04 — 会话续接 + 每用户 PVC 挂载

**Status:** done（1ed52d7 占位实现 + 2a30eb8 设计；remember 工具零额外调用写入 + before_provider_request 预算注入；选型挂起，生态包深度调研见 ticket 14）

> ⚠️ **选型挂起**：本实现为占位方案。生态包深度调研与替换决策见 ticket 14（`docs/research/pi-memory-extensions.md` 初步对比）。

- [x] 扩展随镜像打包，桥 `-e` 加载，事件在容器内正常触发（spike 已证）
- [ ] memory.md 三节结构，跨会话/Pod 保留且不丢失
- [ ] context 注入：预算内全文 / 超预算保留画像+最近条目，结构完整
- [ ] remember 工具：三节增/改、幂等去重、事实带日期、history/ 备份、原子写回
- [ ] 注入含记忆使用规则；turn_end 事件流无额外 LLM 回合（零成本）
- [ ] 每用户记忆隔离：alice 不出现在 bob 上下文
- [ ] init-memory.mjs：按用户分批、幂等（已存在跳过），首次运行空记忆兜底
