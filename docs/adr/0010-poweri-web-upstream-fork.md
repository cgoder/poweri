# PowerI-Web 上游跟踪：monorepo + git subtree，部署分列

> **部分取代说明**：ADR-0010 仍保留“单 monorepo、web/gateway/worker 三模块、独立构建与部署”的决策。关于 web 的终局 AgentClient/AgentHost 边界、PowerI 业务循环，以及 subtree/upstream 是否构成长期运行时约束，已由 ADR-0011 取代。本 ADR 中的 subtree/upstream 内容仅作为迁移期来源和历史记录保留。

PowerI 三模块（worker / gateway / web）合并为单一 monorepo：worker 与 gateway 以 `git subtree add` 并入，web 在迁移期以 `git subtree` 从上游 agegr/pi-web 引入 UI/交互资产；各模块独立镜像与部署。subtree 不是终局 Agent Runtime 或业务控制面的定义。

**背景（问题）：** 原 poweri-web 仓库（gitlab.litta.cn/litta-power/poweri-web）是复制式 fork——以 agegr/pi-web v0.8.6 为基底复制代码后独立演进，git 历史与上游无共同祖先。上游 pi-web 每次发布（v0.8.6 → v0.8.8 已缺 lib/ 48 文件、components/ 21 文件、app/ 3 文件）都只能手动移植，同步成本高且持续累积。已存在的网关适配层（`lib/gateway-client.ts`，开关式双模式）设计正确，问题在仓库关系而非代码。

**决策（decided 2026-08-13，含 monorepo 修订）：**

1. **平台代码库 = 单一 monorepo**（gitlab project `litta-power/poweri`，以原 poweri 仓库为基底）：
   - `worker/` ← 原 poweri 仓库的 worker 沙箱部分（git mv 归入子目录）
   - `gateway/` ← 原 poweri-gateway 仓库（`git subtree add`，squash）
   - `web/` ← 迁移期使用上游 agegr/pi-web 的 UI/交互资产（历史上以 subtree 引入；具体同步方式不构成终局 Agent 架构）
   - 平台文档（CONTEXT.md、docs/adr/）位于 monorepo 根。
2. **迁移期上游来源 = git subtree pull（可停止）**：迁移阶段可以使用 `git subtree pull --prefix=web <agegr/pi-web> main` 获取 UI/交互资产，冲突收敛到适配层。`github/cgoder/poweri` 不再承担独立 web 开发基地角色；归并完成后它承载与 monorepo 同树的外网镜像。上游源仍是 agegr/pi-web 官方仓库。该同步方式不是 PowerI 终局业务循环或 Agent Runtime 的持续约束，达到迁移目标后可以停止 subtree pull。
3. **迁移期适配层收敛**：迁移阶段的 UI 定制集中在适配层，尽量减少上游冲突。终局 web 由 AgentClient 对接 LocalAgentHost 或 Gateway/RemoteAgentClient；AgentClient、AgentHost 和 PowerI 业务模型可以按 ADR-0011 重新设计，不受旧上游文件边界和旧实现约束。subtree 冲突面是迁移成本，而不是终局架构不变量。
4. **仓库迁移与双远端**：原三个 GitLab project（poweri / poweri-gateway / poweri-web）合并为一个 monorepo project；`github/cgoder/poweri` 的旧 web 内容作为一次性迁移输入。归并完成后，内网 GitLab 作为主开发与 CI 远端，外网 GitHub 作为同一 monorepo 镜像；两端按同名分支双推，GitHub 不独立开发、不承载部署控制面。
   - **执行状态（2026-09-07 修订）**：monorepo 承载于 `litta-power/poweri`；本次受控迁移将 `github/cgoder/poweri` 的 web/PowerI 产品层归入 `web/`，保留目标 gateway/worker 与部署边界。旧 GitHub 历史通过合并父提交保留，后续按 [`docs/dual-remote-sync.md`](../dual-remote-sync.md) 同步。
5. **部署分列**：部署编排从 poweri 控制面提取，各模块（worker / gateway / web）在 monorepo 内独立镜像构建、独立部署 manifest，各自分列管理。先 local 验证，后续走内网 gitlab CI + harbor 镜像仓库部署。

**权衡：** 备选方案为独立 fork 仓库 + 双 remote 双推——同步成本最低，但代码库分散、平台文档无统一入口；用户明确目标为 monorepo。因此采用 GitLab 主开发/CI + GitHub 同树镜像，禁止两个远端独立开发。迁移期采用 subtree 能保留上游 UI/交互资产的同步路径，代价是 subtree 操作纪律（禁止 subtree split 反向推送、subtree pull 冲突解决）高于普通 merge，因此迁移期适配层收敛是硬约束。达到迁移目标后可以停止 subtree pull；此历史权衡不限制 ADR-0011 定义的终局 Agent 架构。
