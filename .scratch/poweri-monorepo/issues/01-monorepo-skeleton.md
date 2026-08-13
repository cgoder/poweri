# 01 — Monorepo 骨架（worker 归位）

**What to build:** 以原 poweri 仓库为基底建立 monorepo 骨架：worker 沙箱（bridge、memory-extension、worker 初始化脚本）归位到 `worker/` 子目录，平台文档（CONTEXT.md、docs/adr/）、部署编排与验证脚本留在根目录；根 README 更新为 monorepo 结构说明，供新成员快速理解三模块职责。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] worker 沙箱代码位于 `worker/` 子目录，git 历史可追溯（git log --follow）
- [x] 根级验证脚本/常用命令迁移后仍可运行
- [x] 根 README 描述 monorepo 结构（worker/、gateway/、web/ 及根职责），标注 web 待 subtree 引入
- [x] 边界不确定文件的归类（运行时属 worker 沙箱 vs 平台控制面）判定后记入根文档

## Comments

- 2026-08-13：实现完成。`git mv` 归位：bridge/、memory-extension/、deploy/docker/（worker 镜像构建，随沙箱自包含）→ `worker/`，init-memory.mjs、seed-skills.mjs（worker 初始化脚本）→ `worker/scripts/`；留根：deploy/config/（gen-pi-config 输出，gateway 也消费）、deploy/k8s/、scripts/ 其余（聚合引用 worker/docker）。
  验证：memory-extension 单测 10/10；`node scripts/build-image.mjs` 真实构建通过（镜像内 /bridge + /poweri/extensions 正确）；`npm run gen:pi-config`、`validate:env` 通过；init-memory --dry-run 通过；seed-skills 因本机无 kubectl 未实跑（node --check 通过）；git diff 全部 R（R100/R091，历史可追溯）。
  边界判定原则（记入根 README）：文件运行在 worker 沙箱内、或产物被 worker 沙箱独占消费 → worker/；运行在控制面且被多模块消费 → 留根。
  **决策偏离标注**：spec 字面清单将“部署编排”整体留根，本次将 `deploy/docker/`（Dockerfile.poweri + 镜像文档）移入 `worker/docker/`——理由：Dockerfile 内 COPY bridge/memory-extension，与沙箱强耦合，且 ADR-0010“部署分列”要求各模块独立镜像构建（自描述）；判定记录于根 README 模块边界表。
