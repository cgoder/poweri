# 06 — 定制清单机制

**What to build:** 把"适配层收敛 = 硬约束"变成可执行机制：定制清单文件（记录侵入上游文件的改动集合：路径 + 理由 + 预期冲突风险）+ 校验脚本（subtree 结构校验、侵入集合 ⊆ 清单校验、清单过期条目检测、subtree pull dry-run 冲突预期输出）+ 上游升级流程文档（pull 前校验 → pull → 冲突处理 → 更新清单 → 测试）。04/05 的全部侵入改动录入清单作为初始基线。

**Blocked by:** 05

**Status:** resolved

- [x] 校验脚本可检出三类违规：侵入集合超出清单、清单过期条目、subtree 结构异常
- [x] dry-run 输出预期冲突文件列表（对照实际 pull 结果验证准确性）
- [x] 上游升级流程文档固化（含跨版本累积教训：v0.8.6 → v0.8.8 缺 70+ 文件）
- [x] 04/05 的侵入改动已全部录入清单（初始基线）

## Comments

- 2026-08-13：定制清单机制落地。
  **机器可读清单**（唯一源）：docs/web-customizations.json —— web 模块 upstream 元数据（repo/version/subtreeSquash/subtreeSplit）+ independent 4 文件 + intrusions 20 条目（file/reason/risk，risk 分级 high/medium/low）+ gateway 冻结源改动记录。docs/web-customizations.md 标注为 JSON 的人读视图（并补全了此前遗漏登记的 2 个独立测试文件）。
  **校验脚本**：scripts/validate-customizations.mjs（单测 scripts/test/validate-customizations.test.mjs 9 例，注入 fake runGit）。
  - 侵入/独立集判定：`git ls-tree` blob sha 比较 squash commit 树（=上游树副本，无模块前缀）vs HEAD 树（带 web/ 前缀）——不用 git diff（路径过滤对无前缀侧失效）；改/删=侵入，新增=独立。
  - 三类违规：未登记侵入（error）、清单过期条目（error，注明“若为刻意回退请从清单移除”）、subtree 结构异常（模块目录缺失 / split 对象缺失 / squash 树与 split 树不一致）。独立文件未登记为 warning（零冲突，仅文档化提示）。工作区未提交改动 warning（校验基于 HEAD 树）。
  - dry-run：`--dry-run <ref>` 用 split→ref 树差 ∩ 侵入集输出三类预期：conflict（上游改动∩侵入）、upstream-deleted（上游删除+本地侵入过，需决策）、collision（上游新增文件与独立文件同名，pull 覆盖需合并）。
  **dry-run 准确性对照**（真实验证闭环）：在 /tmp/pi-web-agegr 构造模拟上游提交（改侵入文件 rpc-manager.ts + 改非侵入 ansi.ts + 删侵入 cwd/browse + 新增与独立文件同名的 gateway-client.ts），fetch 后 dry-run 预测 3 文件；真实 `git subtree pull --squash` 结果：cwd/browse modify/delete 硬冲突 ✅、gateway-client add/add 硬冲突 ✅、rpc-manager auto-merge 成功（预测为必检上界，验证 auto-merge 后侵入分支语义完好：gatewayConfig.enabled 分支与上游改动共存）；非侵入 ansi.ts 正确排除。验证后 merge --abort + reset 回滚，无残留。
  **升级流程文档**：docs/upstream-upgrade-process.md —— 8 步标准流程（前置校验 → fetch → dry-run → pull → 冲突处理 → 清单更新 → 回归 → 提交）、三类冲突处理细则、跨版本教训（fork 切换缺 70+ 文件不可 diff 预测、npm omit=dev 需 --include=dev、npm/next 自动改 lock/tsconfig 需还原、squash 树无前缀对比法、回退预案 tag/merge --abort/revert）。
  **测试**：新增单测 9/9 通过；真实仓库全量校验 PASS（web + gateway）；负向验证：临时登记假侵入条目 → 检出过期条目 error，恢复后 PASS。
  **遗留**：真实上游新版本发布后的首次升级演练 → ticket 09（upstream-upgrade-drill）；校验脚本接入 CI 与升级前 hook → 后续（gitlab CI 迭代，spec 非本次阻塞）。
