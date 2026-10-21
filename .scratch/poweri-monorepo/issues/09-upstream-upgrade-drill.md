# 09 — 上游升级演练

**What to build:** 按固化流程执行一次真实上游升级演练（subtree pull 一个小版本或真实上游提交），验证校验脚本与流程文档的可用性，记录冲突处理样本与耗时，回写流程文档；验证"跨版本累积"教训已被流程消化（升级节奏 = 跟随上游发版）。

**Blocked by:** 06, 07

**Status:** ready-for-agent

- [x] 升级前置：定制清单从 FAIL 修到 PASS（补登 88 条侵入 + 174 条独立新增；2026-10-21）
- [x] 升级前置：补齐 `web/docs/desktop/`（架构边界、文件地图、独立启动器、替换件登记表）
- [x] 升级前置：流程文档补类别策略、替换件遮蔽、登记滞后与落后量教训
- [x] 摸清落后量：本地 v0.8.8（2026-08-12）→ 上游 0.12.2（2026-10-15），21 个版本 / 4 个 minor
- [ ] 按文档执行一次真实 subtree pull（上游实际 tag），先对 v0.8.9 做小步演练
- [ ] 校验脚本 dry-run 预测 = 实际冲突（含 `[conflict]` / `[upstream-deleted]` / `[collision]` 三类）
- [ ] 升级记录（冲突样本、耗时、意外项）追加到流程文档
- [ ] 流程文档结论可指导后续常规升级（升级节奏、回退预案）

## 阻塞与前置（2026-10-21 记录）

- **网络**：`github.com/agegr/pi-web` 直连 40s 超时，`git ls-remote` 空返回；npm registry 可达。上游 tag fetch 需要在可达环境执行（或临时 remote 走代理）。
- **决策待定**：`poweri-product` 类 36 个侵入（6 个 high）是"逐块合并"还是"先收敛进 `poweri/` 替换件"，决定本 ticket 的工作量量级。
- **另一条待决策项**：`bin/pi-web.js`、`bin/pi-web-options.js` 已被产品能力侵入，与「不改上游 bin/」约定冲突。

## Comments

### 2026-10-21：前置收口（清单补全）

校验脚本从 `FAIL（88 error / 174 warning）` 修到 `PASS`，改动：

- `docs/web-customizations.json`：intrusions 21 → **109**（新增 `category` 字段，6 类）；independent 4 → **178**（全量登记，按类别排序）；新增 `categories` 图例与 `migration` 记录（基线/观测/落后量/历史包袱/已知缺口）。
- `docs/web-customizations.md`：改为**生成视图**（`node scripts/render-customizations-md.mjs`），按类别列侵入 + 风险分布 + 上游落后量表。
- `web/docs/desktop/`：新增 `architecture-and-scope-boundary.md`、`file-map.md`、`poweri-web-standalone.md`、`replacements.json`（10 个替换件遮蔽关系，含 2 high）。
- `docs/upstream-upgrade-process.md`：新增 3b（fetch + dry-run 通用做法）、清单类别处理策略、替换件遮蔽、两条跨版本教训（登记滞后、落后量）。
- 校验：`node scripts/validate-customizations.mjs` → PASS；`npm run test:customizations` → 11/11。
