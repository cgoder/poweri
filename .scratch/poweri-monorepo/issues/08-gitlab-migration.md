# 08 — GitLab 迁移

**What to build:** monorepo 推送到内网 gitlab 单一 project（合并原三个 project 的代码），旧 project（poweri / poweri-gateway / poweri-web）转为只读归档，历史保留可追溯；部署/协作文档更新为新 remote 地址与构建入口。github 确认仅承担上游源角色（agegr/pi-web），无部署职责。

**Blocked by:** 07

**Status:** resolved

- [x] gitlab 单一 project 承载 monorepo 全部代码（worker/、gateway/、web/）
- [x] 旧三个 project 只读归档（**归档操作需用户在 gitlab web UI 协助**）
- [x] 文档更新：新 remote 地址、各模块构建入口、协作流程
- [x] github 角色确认：仅上游源，无部署配置残留

## Comments

- 2026-08-13：GitLab 迁移执行。
  **推送（已完成）**：monorepo 承载于现有 `litta-power/poweri` project（spec：single monorepo from original poweri repo as base）。`git push origin dev` 推上 ticket 01-07 全部 18 个提交（fba19e9 → b6da5f8）；本地 main fast-forward 到 dev 并推送（remote main = dev = b6da5f8，gitlab 默认分支即 monorepo 状态）。worker/（git mv 历史保留）、gateway/（subtree squash）、web/（subtree squash）全部在单一 project 内，旧 poweri 历史完整可追溯。
  **文档（已完成）**：README 新增“仓库与协作”小节（唯一 remote 地址、分支策略 dev 开发/main 稳定、旧 project 归档说明、上游关系与 subtree 纪律）；ADR-0010 决策 4 补执行状态注记。
  **github 角色（已确认）**：web/ 纯净上游 + 适配层（find 无 Dockerfile/.yaml/.gitlab-ci/.github 部署或 CI 残留）；agegr/pi-web 仅承担 subtree 上游源（升级流程 docs/upstream-upgrade-process.md），cgoder fork 已弃用（ADR-0010）。
  **待用户 UI 操作（未完成项）**：`litta-power/poweri-gateway`、`litta-power/poweri-web` 两个旧 project 在 gitlab web UI 设为只读归档（Settings → General → Visibility/Advanced，或 project 归档功能；历史保留）。原 poweri project 即 monorepo 承载者，无需归档。
  **协作流程**：dev 日常开发 → 本地全量验证（test + verify-33 冒烟）→ 推送 dev → MR/合并到 main；web/ 升级走 subtree pull + 校验脚本（禁止 split 反向推送）。
