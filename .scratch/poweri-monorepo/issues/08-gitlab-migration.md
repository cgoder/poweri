# 08 — GitLab 迁移

**What to build:** monorepo 推送到内网 gitlab 单一 project（合并原三个 project 的代码），旧 project（poweri / poweri-gateway / poweri-web）转为只读归档，历史保留可追溯；部署/协作文档更新为新 remote 地址与构建入口。github 确认仅承担上游源角色（agegr/pi-web），无部署职责。

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] gitlab 单一 project 承载 monorepo 全部代码（worker/、gateway/、web/）
- [ ] 旧三个 project 只读归档（**归档操作需用户在 gitlab web UI 协助**）
- [ ] 文档更新：新 remote 地址、各模块构建入口、协作流程
- [ ] github 角色确认：仅上游源，无部署配置残留
