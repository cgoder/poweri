# PowerI web/ 上游升级流程

> 适用：web/（git subtree 跟踪 https://github.com/agegr/pi-web）。gateway/ 源仓库已冻结归档，不参与升级。
> 硬约束（spec）：**适配层收敛** —— 定制优先独立文件（零冲突）；侵入上游文件的改动必须登记在 [docs/web-customizations.json](web-customizations.json)，每次升级前跑校验脚本。

## 原则

- **冲突面可预期、可控制**：升级前 dry-run 预测必检文件集（上游改动 ∩ 清单侵入），升级后对照核验。
- **dry-run 是保守上界**：预测文件 = 必须人工检查的文件（即使三方合并自动成功，侵入分支与上游改动相邻时语义可能损坏，必须验证）。预测集合应 ⊇ 实际硬冲突集合；若实际冲突出现在预测之外 → 清单登记遗漏，先补清单再升级。
- 每次升级后：更新清单（subtreeSquash/subtreeSplit/version）→ 全量测试 → 提交。

## 标准流程

```bash
# 0. 前置：工作区必须干净（校验脚本会警告未提交改动）
git status --porcelain   # 应为空（或先提交）

# 1. 升级前校验：结构 + 清单（侵入 ⊆ 清单、无过期条目）
node scripts/validate-customizations.mjs
#   → 必须 PASS。FAIL 时先处理违规（登记新侵入 / 移除过期条目 / 修复结构），禁止带病升级。

# 2. 拉取上游新版本
git fetch https://github.com/agegr/pi-web.git <tag-or-branch>   # 如 v0.9.0

# 3. dry-run 预测必检文件
node scripts/validate-customizations.mjs --dry-run <FETCH_HEAD 或新 commit>
#   → 输出三类：
#     [conflict]          上游改动 ∩ 清单侵入 → 预期三方冲突或需人工合并
#     [upstream-deleted]  上游删除 + 本地侵入过 → 决策：跟随删除或保留定制
#     [collision]         上游新增文件与独立文件同名 → pull 覆盖本地，需合并内容
#   记录输出作为升级对照基准。

# 4. 执行 subtree pull（squash 保持历史整洁；合并不成功时 git merge --abort 退出）
git subtree pull --prefix=web <上游 clone 或 URL> <同一 ref> --squash

# 5. 冲突处理（对照步骤 3 的预测）
#    [conflict]：逐文件人工合并；侵入分支（if (gatewayConfig.enabled) 块）保持在前，
#                上游演进部分保留，改动后 node --test web/lib 相关单测。
#    [upstream-deleted]：跟随删除（从清单移除条目）或保留定制（git add 恢复文件并保持清单）。
#    [collision]：把本地独立文件内容与上游同名文件合并（独立文件改名或内容并入上游文件后从 independent 移除）。
#    实际冲突出现在预测之外 → 停止，检查清单遗漏，登记后重跑校验。

# 6. 更新清单（docs/web-customizations.json）：web.upstream 的 version/subtreeSquash/subtreeSplit
#    （新 squash = pull 产生的 squash commit，新 split = 上游 commit）；侵入条目按实际变化增删改。

# 7. 回归
node scripts/validate-customizations.mjs          # 应 PASS（含新元数据）
cd web && npm install --include=dev && npm test    # 全量（当前基线 572 例）
cd ../gateway && node --test "test/*.test.mjs"     # 14 例
cd .. && npm run test:unit                         # worker 10 例

# 8. 提交（显式路径，feat/fix 前缀 + why 段落）
```

## 冲突处理细则

- 侵入分支模式统一为函数开头 `if (gatewayConfig.enabled) { ... return; }`，上游演进后仍适用；若上游重构该函数签名/结构，先看清单 reason 再决定分支放置。
- `lib/rpc-manager.ts`（risk: high）与 `lib/session-reader.ts`（risk: medium）是升级热点：上游频繁演进，冲突块短、易解，但 auto-merge 后必须跑 `web/lib/rpc-manager-gateway.test.mjs`、`web/lib/gateway-routes-gateway.test.mjs`（源码断言，分支缺失即红）。
- 上游新增同名文件与独立文件冲突（collision）：优先保留两者语义——独立文件是适配层，上游文件是产品功能；无法共存时独立文件改名并更新引用（引用面 = gateway-client 导出 + 路由 import）。
- 升级后新功能默认**不接网关分支**（除非 ticket 明确要求）；v0.8.8 新增路由如 context/state 已在 ticket 05 覆盖，后续新增路由以"网关模式可用性"为准逐项评估。

## 跨版本教训（v0.8.6 → v0.8.8，2026-08 首迁）

1. **上游源切换**：旧基线是 cgoder/pi-web fork（已停更），官方 agegr/pi-web 与 fork 差异巨大（缺 70+ 文件、路由/组件重构）——**不可用 fork 做 diff 预测**；换源即全新基线（ADR-0010），dry-run 只在同一上游仓库的版本区间内有效。
2. **npm 环境**：本机全局 npm config `omit=dev` → 裸 `npm install` 不装 devDependencies（jiti 等缺失致测试失败）。升级后必须 `npm install --include=dev`。
3. **工具自动改动**：`npm install` 会重写 package-lock.json（npm 版本差异加 `peer: true`）、`next dev` 会改 tsconfig.json（`.next/dev` include）——**都是自动生成物，升级后还原**（`git checkout -- web/package-lock.json web/tsconfig.json`），只保留 package.json 的依赖声明改动并登记清单。
4. **subtree 元数据**：squash commit 树 = 上游树副本（**无 web/ 前缀**），对比用 `git ls-tree` blob sha（校验脚本已封装），不要用 `git diff <squash> HEAD -- web/`（路径过滤对无前缀侧失效，全显示 A）。
5. **升级节奏**：小步跟进（上游 minor 版本），避免跨大版本一次迁移；每次升级前确认上游 release notes 中 API 路由变更（context/entries/state 这类新增子路由影响前端数据流）。
6. **回退预案**：pull 合并失败 → `git merge --abort`（工作区回到升级前）；已提交发现回归 → `git revert` 该 merge commit（subtree pull 的 merge commit 可整体 revert，对象残留无害）；升级前建议 `git tag pre-upgrade-<版本>` 锚点。

## 相关文件

- 清单（机器可读唯一源）：`docs/web-customizations.json`；人读视图：`docs/web-customizations.md`
- 校验脚本：`scripts/validate-customizations.mjs`（单测 `scripts/test/validate-customizations.test.mjs`）
- 决策记录：`docs/adr/0010-poweri-web-upstream-fork.md`
